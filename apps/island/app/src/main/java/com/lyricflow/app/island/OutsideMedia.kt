package com.lyricflow.app.island

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.Rating
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationManagerCompat

/**
 * Android's way to see which song another app plays is `MediaSessionManager.getActiveSessions`, and it hands that
 * list only to an app that is an enabled notification listener. This service is that listener and nothing more:
 * it is switched on in Settings → Notification access, it reads no notification, and its callbacks do nothing.
 * Binding it is what unlocks [OutsideMedia].
 */
class OutsideListener : NotificationListenerService() {
    override fun onListenerConnected() = OutsideMedia.recheck()

    override fun onListenerDisconnected() = OutsideMedia.recheck()

    override fun onNotificationPosted(sbn: StatusBarNotification?) = Unit

    override fun onNotificationRemoved(sbn: StatusBarNotification?) = Unit
}

/**
 * What other apps are playing, for the island's "Play here". While the island is up, the listener turned the switch
 * on (IslandPrefs.takeOver) and Android lets us (the listener above is enabled), it follows every other app's media
 * session and offers the one that is playing a song (OutsideMath.choose). Otherwise it holds nothing.
 *
 * Like [IslandPlayback] it is watched: the island's view gets the offered song now and whenever it changes. All of
 * it runs on the main thread, where the sessions call back; only [now] and [pause], which JavaScript asks for, are
 * safe from any thread. Nothing here may take the process down: Android refuses with a SecurityException the moment
 * the listener is switched off, and every call that can is guarded and logged.
 */
object OutsideMedia {
    /** The song another app plays: what the island shows. [art] is the cover the app published, if it gave a bitmap. */
    class Song(
        val packageName: String,
        val appLabel: String,
        val title: String,
        val artist: String,
        val album: String,
        val durationMs: Long,
        val mediaId: String,
        val art: Bitmap?,
    )

    /**
     * A tap on "Continue here": the song, where it was when the button was tapped (seconds, as JavaScript sees
     * them), and whether the other app shows it as liked.
     */
    class TakeOver(val song: Song, val positionS: Double, val playing: Boolean, val liked: Boolean)

    private const val TAG = "LyrFlowIsland"

    private val main = Handler(Looper.getMainLooper())
    private val watchers = LinkedHashSet<(Song?) -> Unit>()

    /** The song on offer; null when nothing is. */
    @Volatile
    var offer: Song? = null
        private set

    /** Set while JavaScript listens (DynamicIslandModule); null when it does not, and the island opens the app instead. */
    @Volatile
    var onTakeOver: ((TakeOver) -> Unit)? = null

    /** Told, on the main thread, when JavaScript says the take-over ended (`takeOverDone`): ok and the message to show. */
    @Volatile
    var onDone: ((Boolean, String) -> Unit)? = null

    /** Told, on the main thread, to open the search drawer with a query typed in (`showTakeOverSearch`). */
    @Volatile
    var onShowSearch: ((String) -> Unit)? = null

    private var context: Context? = null
    private var wanted = false
    private var manager: MediaSessionManager? = null
    private var connected = false
    private var tracked = emptyList<Tracked>()

    @Volatile
    private var controllers = emptyList<MediaController>()

    private class Tracked(val controller: MediaController, val callback: MediaController.Callback)

    private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { list -> adopt(list.orEmpty()) }

    /** Calls [onChange] now and whenever the offered song changes; the returned function stops watching. */
    fun watch(onChange: (Song?) -> Unit): () -> Unit {
        watchers += onChange
        onChange(offer)
        return { watchers -= onChange }
    }

    /** The island is up (and the listener asked for "Play here") or it is not: start following sessions, or let go of them. */
    fun configure(context: Context, wanted: Boolean) {
        runOnMain {
            this.context = context.applicationContext
            this.wanted = wanted
            update()
        }
    }

    /** The listener switch changed in Android's settings (the service connected or disconnected), or the screen came on. */
    fun recheck() = runOnMain { update() }

    /**
     * Whether the listener turned this app on in Android's Notification access. Asked through the documented API:
     * reading the hidden `enabled_notification_listeners` setting directly is not guaranteed on newer Android.
     */
    fun isListenerEnabled(context: Context): Boolean = try {
        NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    } catch (e: Exception) {
        Log.w(TAG, "could not read notification access", e)
        false
    }

    fun component(context: Context) = ComponentName(context.applicationContext, OutsideListener::class.java)

    /**
     * "Play here" was tapped: hands the song, with its position right now, to JavaScript. False when nothing listens;
     * the island then opens the app, as it does for a pick.
     */
    fun takeOver(song: Song): Boolean {
        val listener = onTakeOver ?: return false
        // Its session gone since the offer: the song is still worth playing, from the start.
        val at = now(song.packageName)
        listener(TakeOver(song, at?.first ?: 0.0, at?.second ?: false, liked(song.packageName)))
        return true
    }

    /** Whether [packageName] shows its song as liked (OutsideMath.isLiked); false if its session is gone. */
    private fun liked(packageName: String): Boolean {
        val controller = controllers.firstOrNull { it.packageName == packageName } ?: return false
        return try {
            val rating = controller.metadata?.getRating(MediaMetadata.METADATA_KEY_USER_RATING)
            val heart = rating?.takeIf { it.ratingStyle == Rating.RATING_HEART && it.isRated }?.hasHeart()
            val actions = controller.playbackState?.customActions.orEmpty().map { it.name.toString() }
            OutsideMath.isLiked(heart, actions)
        } catch (e: Exception) {
            Log.w(TAG, "could not read whether $packageName likes its song", e)
            false
        }
    }

    /** [packageName]'s live position in seconds and whether it plays, right now; null if its session is gone. */
    fun now(packageName: String): Pair<Double, Boolean>? {
        val controller = controllers.firstOrNull { it.packageName == packageName } ?: return null
        return try {
            val state = controller.playbackState ?: return null
            val playing = state.state == PlaybackState.STATE_PLAYING
            val duration = controller.metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L
            val seconds = OutsideMath.liveSeconds(state.position, state.lastPositionUpdateTime, state.playbackSpeed, playing,
                SystemClock.elapsedRealtime(), duration)
            seconds to playing
        } catch (e: Exception) {
            Log.w(TAG, "could not read $packageName's position", e)
            null
        }
    }

    /** Pauses that app. False when its session is gone or refuses. */
    fun pause(packageName: String): Boolean {
        val controller = controllers.firstOrNull { it.packageName == packageName } ?: return false
        return try {
            controller.transportControls.pause()
            true
        } catch (e: Exception) {
            Log.w(TAG, "could not pause $packageName", e)
            false
        }
    }

    /** JavaScript finished (or gave up on) the take-over: the island leaves its "Finding…" state. */
    fun finish(ok: Boolean, message: String) {
        main.post { onDone?.invoke(ok, message) }
    }

    /** JavaScript did not find the song: the island opens its search drawer with [query] typed in. False if no island listens. */
    fun showSearch(query: String): Boolean {
        if (onShowSearch == null) return false
        main.post { onShowSearch?.invoke(query) }
        return true
    }

    // ── Following the sessions ──────────────────────────────────────────────────────────────────────────────

    private fun update() {
        val ctx = context
        if (ctx == null || !wanted || !isListenerEnabled(ctx)) {
            disconnect()
            return
        }
        if (connected) return
        try {
            val sessions = ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as? MediaSessionManager ?: return
            manager = sessions
            // The list is handed to a notification listener only; this is where Android refuses an app that is not.
            sessions.addOnActiveSessionsChangedListener(sessionsChanged, component(ctx), main)
            connected = true
            adopt(sessions.getActiveSessions(component(ctx)))
        } catch (e: SecurityException) {
            Log.w(TAG, "media sessions refused: ${e.message}")
            disconnect()
        } catch (e: Exception) {
            Log.w(TAG, "could not follow media sessions", e)
            disconnect()
        }
    }

    private fun disconnect() {
        try {
            manager?.removeOnActiveSessionsChangedListener(sessionsChanged)
        } catch (e: Exception) {
            Log.w(TAG, "could not stop following media sessions", e)
        }
        connected = false
        manager = null
        release(tracked)
        tracked = emptyList()
        controllers = emptyList()
        setOffer(null)
    }

    /** Follows exactly [list] (other apps' sessions): new ones get a callback, gone ones lose theirs. */
    private fun adopt(list: List<MediaController>) {
        val own = context?.packageName
        val next = ArrayList<Tracked>(list.size)
        for (controller in list) {
            if (controller.packageName == own) continue
            val known = tracked.firstOrNull { it.controller.sessionToken == controller.sessionToken }
            if (known != null) {
                next += known
                continue
            }
            val callback = object : MediaController.Callback() {
                override fun onPlaybackStateChanged(state: PlaybackState?) = recompute()
                override fun onMetadataChanged(metadata: MediaMetadata?) = recompute()
                override fun onSessionDestroyed() = recompute()
            }
            try {
                controller.registerCallback(callback, main)
                next += Tracked(controller, callback)
            } catch (e: Exception) {
                Log.w(TAG, "could not follow ${controller.packageName}", e)
            }
        }
        release(tracked.filter { old -> next.none { it.controller.sessionToken == old.controller.sessionToken } })
        tracked = next
        controllers = next.map { it.controller }
        recompute()
    }

    private fun release(old: List<Tracked>) {
        for (t in old) {
            try {
                t.controller.unregisterCallback(t.callback)
            } catch (_: Exception) {
                // Already gone with its session.
            }
        }
    }

    /** Offers the first playing song among the followed sessions (OutsideMath.choose), or nothing. */
    private fun recompute() {
        val ctx = context ?: return
        val pairs = tracked.mapNotNull { t ->
            try {
                val c = t.controller
                val meta = c.metadata
                val title = meta?.getString(MediaMetadata.METADATA_KEY_TITLE).orEmpty()
                val artist = (meta?.getString(MediaMetadata.METADATA_KEY_ARTIST)
                    ?: meta?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST)).orEmpty()
                val session = OutsideMath.Session(
                    c.packageName, title, artist,
                    meta?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L,
                    meta?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID).orEmpty(),
                    c.playbackState?.state == PlaybackState.STATE_PLAYING,
                )
                session to meta
            } catch (e: Exception) {
                Log.w(TAG, "could not read a media session", e)
                null
            }
        }
        val chosen = OutsideMath.choose(pairs.map { it.first }, ctx.packageName)
        val hit = pairs.firstOrNull { it.first === chosen }
        if (chosen == null || hit == null) {
            setOffer(null)
            return
        }
        val meta = hit.second
        val art = meta?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: meta?.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: meta?.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
        setOffer(Song(chosen.packageName, OutsideMath.appLabel(chosen.packageName, labelOf(ctx, chosen.packageName)),
            chosen.title, chosen.artist, meta?.getString(MediaMetadata.METADATA_KEY_ALBUM).orEmpty(),
            chosen.durationMs, chosen.mediaId, art?.takeUnless { it.isRecycled }))
    }

    /** Android's name for the app, where it lets us see the app (package visibility); null otherwise. */
    private fun labelOf(ctx: Context, packageName: String): String? = try {
        val pm = ctx.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
    } catch (_: Exception) {
        null
    }

    private fun setOffer(next: Song?) {
        val now = offer
        if (now === next || (now != null && next != null && same(now, next))) return
        offer = next
        watchers.toList().forEach { it(next) }
    }

    /** The same song as far as the island shows it; a cover arriving late counts as a change. */
    private fun same(a: Song, b: Song) = a.packageName == b.packageName && a.title == b.title && a.artist == b.artist &&
        a.album == b.album && a.durationMs == b.durationMs && a.mediaId == b.mediaId && (a.art == null) == (b.art == null)

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
    }
}
