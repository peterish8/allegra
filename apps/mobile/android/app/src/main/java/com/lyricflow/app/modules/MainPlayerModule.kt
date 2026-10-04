package com.lyricflow.app.modules

import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.media.MediaRouter2
import android.media.RingtoneManager
import android.media.audiofx.AudioEffect
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.C
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import com.lyricflow.app.playback.QueueEngine
import com.lyricflow.app.playback.QueueItemSpec
import com.lyricflow.app.playback.QueueMath.RepeatKind
import com.lyricflow.app.services.PlaybackService
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

private const val TAG = "LyrFlow"
private const val META_MAX = 500

class MainPlayerModule : Module() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var volumeReceiver: BroadcastReceiver? = null

    private fun audioManager(): AudioManager? =
        appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

    /** Media volume as 0..1. */
    private fun mediaVolume(): Double {
        val am = audioManager() ?: return 0.0
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        return am.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max
    }

    override fun definition() = ModuleDefinition {
        Name("MainPlayer")

        Events("onPlaybackStatus", "onRemoteCommand", "onTrackAdvanced", "onVolumeChanged", "onPlaybackError", "onQueueChanged", "onQueueLow")

        OnCreate {
            Log.d(TAG, "MainPlayerModule.OnCreate — registering callbacks")
            PlayerBridge.onStatusUpdate = { position, duration, isPlaying, playWhenReady, isBuffering, didJustFinish, suppressed ->
                sendEvent("onPlaybackStatus", mapOf(
                    "position" to position,
                    "duration" to duration,
                    "isPlaying" to isPlaying,
                    "playWhenReady" to playWhenReady,
                    "isBuffering" to isBuffering,
                    "didJustFinish" to didJustFinish,
                    "suppressed" to suppressed
                ))
            }
            PlayerBridge.onRemoteCommand = { command ->
                sendEvent("onRemoteCommand", mapOf("command" to command))
            }
            PlayerBridge.onTrackAdvanced = { mediaId, index, reason ->
                sendEvent("onTrackAdvanced", mapOf("mediaId" to mediaId, "index" to index, "reason" to reason))
            }
            PlayerBridge.onQueueChanged = { state ->
                sendEvent("onQueueChanged", state)
            }
            PlayerBridge.onQueueLow = { size, mediaId, tag ->
                sendEvent("onQueueLow", mapOf("size" to size, "mediaId" to mediaId, "tag" to tag))
            }
            PlayerBridge.onPlaybackError = { reason, position ->
                sendEvent("onPlaybackError", mapOf("reason" to reason, "position" to position))
            }
        }

        // Position reports (four a second) only go to JavaScript while the app is in front; on the way back it
        // gets the real state at once.
        OnActivityEntersForeground {
            PlayerBridge.setUiVisible(true)
            mainHandler.post { PlayerBridge.emitStatus() }
        }
        OnActivityEntersBackground {
            PlayerBridge.setUiVisible(false)
        }

        // Hardware volume keys move the Now Playing volume slider too.
        OnStartObserving {
            val context = appContext.reactContext ?: return@OnStartObserving
            if (volumeReceiver != null) return@OnStartObserving
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(c: Context?, intent: Intent?) {
                    if (intent?.getIntExtra("android.media.EXTRA_VOLUME_STREAM_TYPE", -1) != AudioManager.STREAM_MUSIC) return
                    sendEvent("onVolumeChanged", mapOf("volume" to mediaVolume()))
                }
            }
            val filter = IntentFilter("android.media.VOLUME_CHANGED_ACTION")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                context.registerReceiver(receiver, filter)
            }
            volumeReceiver = receiver
        }

        OnStopObserving {
            volumeReceiver?.let { r -> runCatching { appContext.reactContext?.unregisterReceiver(r) } }
            volumeReceiver = null
        }

        Function("getVolume") { mediaVolume() }

        Function("setVolume") { level: Double ->
            val am = audioManager() ?: return@Function null
            val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            val index = (level.coerceIn(0.0, 1.0) * max).toInt()
            am.setStreamVolume(AudioManager.STREAM_MUSIC, index, 0)
            null
        }

        /**
         * The system's "play on" picker (speaker, Bluetooth, cast). Android 14+
         * has a public API; 11–13 open the Settings media-output panel; older
         * versions fall back to Bluetooth settings.
         */
        Function("openOutputSwitcher") {
            val context = appContext.reactContext ?: return@Function false
            try {
                if (Build.VERSION.SDK_INT >= 34) {
                    MediaRouter2.getInstance(context).showSystemOutputSwitcher()
                } else {
                    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        Intent("com.android.settings.panel.action.MEDIA_OUTPUT")
                            .putExtra("com.android.settings.panel.extra.PACKAGE_NAME", context.packageName)
                    } else {
                        Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
                    }
                    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                true
            } catch (_: Exception) {
                runCatching {
                    context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }.isSuccess
            }
        }

        /** Player menu → Advanced: tempo and pitch (Echo's tempo & pitch dialog). */
        Function("setPlaybackParameters") { speed: Double, pitch: Double ->
            val player = PlayerBridge.getPlayer() ?: return@Function false
            val params = PlaybackParameters(
                speed.toFloat().coerceIn(0.25f, 3f),
                pitch.toFloat().coerceIn(0.25f, 3f)
            )
            mainHandler.post { player.playbackParameters = params }
            true
        }

        /** Player menu → Repeat: loop the current song. Media3 then never ends
         *  the item, so the staged "next" is not advanced into. */
        Function("setRepeatOne") { on: Boolean ->
            val engine = PlayerBridge.getEngine() ?: return@Function false
            mainHandler.post { engine.setRepeat(if (on) RepeatKind.ONE else RepeatKind.ALL) }
            true
        }

        /** Player menu → Equalizer: the phone's own audio-effect panel, bound to our session. */
        Function("openEqualizer") {
            val context = appContext.reactContext ?: return@Function false
            val player = PlayerBridge.getPlayer()
            val session = AtomicInteger(C.AUDIO_SESSION_ID_UNSET)
            if (player != null) {
                // ExoPlayer is single-threaded: read it on its own looper.
                val latch = CountDownLatch(1)
                mainHandler.post {
                    session.set(player.audioSessionId)
                    latch.countDown()
                }
                latch.await(1, TimeUnit.SECONDS)
            }
            val extras = { i: Intent ->
                i.putExtra(AudioEffect.EXTRA_AUDIO_SESSION, session.get())
                    .putExtra(AudioEffect.EXTRA_PACKAGE_NAME, context.packageName)
                    .putExtra(AudioEffect.EXTRA_CONTENT_TYPE, AudioEffect.CONTENT_TYPE_MUSIC)
            }
            runCatching { context.sendBroadcast(extras(Intent(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION))) }
            runCatching {
                context.startActivity(
                    extras(Intent(AudioEffect.ACTION_DISPLAY_AUDIO_EFFECT_CONTROL_PANEL))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }.isSuccess
        }

        /**
         * Player menu → Set as ringtone, for a song saved on the phone.
         * Returns "ok", "permission" (the system's "modify settings" page was
         * opened — try again after allowing), "unsupported", "missing" or "error".
         */
        AsyncFunction("setRingtone") { path: String, title: String ->
            val context = appContext.reactContext ?: return@AsyncFunction "error"
            if (!Settings.System.canWrite(context)) {
                runCatching {
                    context.startActivity(
                        Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:${context.packageName}"))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }
                return@AsyncFunction "permission"
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@AsyncFunction "unsupported"
            val src = File(Uri.parse(path).path ?: path)
            if (!src.isFile) return@AsyncFunction "missing"
            val ext = src.extension.lowercase().ifEmpty { "mp3" }
            val mime = when (ext) {
                "m4a", "mp4", "aac" -> "audio/mp4"
                "ogg", "opus" -> "audio/ogg"
                "flac" -> "audio/flac"
                "wav" -> "audio/wav"
                else -> "audio/mpeg"
            }
            val safeTitle = title.replace(Regex("[\\\\/:*?\"<>|]"), " ").trim().take(60).ifEmpty { "LuvLyrics" }
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, "$safeTitle.$ext")
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_RINGTONES)
                put(MediaStore.Audio.Media.IS_RINGTONE, true)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)
                ?: return@AsyncFunction "error"
            try {
                resolver.openOutputStream(uri)?.use { out -> src.inputStream().use { it.copyTo(out) } }
                    ?: throw IllegalStateException("no output stream")
                resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                RingtoneManager.setActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE, uri)
                "ok"
            } catch (e: Exception) {
                Log.w(TAG, "setRingtone failed: ${e.message}")
                runCatching { resolver.delete(uri, null, null) }
                "error"
            }
        }

        OnDestroy {
            volumeReceiver?.let { r -> runCatching { appContext.reactContext?.unregisterReceiver(r) } }
            volumeReceiver = null
            PlayerBridge.onStatusUpdate = null
            PlayerBridge.onRemoteCommand = null
            PlayerBridge.onTrackAdvanced = null
            PlayerBridge.onQueueChanged = null
            PlayerBridge.onQueueLow = null
            PlayerBridge.onPlaybackError = null
        }

        /**
         * Make this song the playing item. The rest of the queue stays: a song the queue already holds is
         * replaced in place (a fresh link for an expired one); any other becomes a queue of one. The caller
         * decides whether to play.
         */
        AsyncFunction("load") { uri: String, metadata: Map<String, String> ->
            val id = metadata["mediaId"].takeUnless { it.isNullOrBlank() } ?: uri
            val spec = QueueItemSpec.fromMap(metadata + mapOf("id" to id, "uri" to uri))
            if (spec == null) {
                Log.w(TAG, "load() rejected uri scheme")
                return@AsyncFunction
            }
            val engine = awaitEngine() ?: run {
                Log.e(TAG, "load() TIMEOUT — engine still null")
                return@AsyncFunction
            }
            onMain { engine.loadItem(spec); true }
            Unit
        }

        // -- The queue (Echo Music's engine, in Kotlin; JavaScript is its remote control) --------------------

        /** A new queue. `startIndex` is the place in `items`; items with no allowed address are left out. */
        AsyncFunction("setQueue") { items: List<Map<String, String>>, startIndex: Int, positionSec: Double, play: Boolean, tag: String? ->
            val specs = items.mapNotNull { QueueItemSpec.fromMap(it) }
            val startId = items.getOrNull(startIndex)?.get("id")
            val engine = awaitEngine() ?: return@AsyncFunction false
            val start = specs.indexOfFirst { it.id == startId }.coerceAtLeast(0)
            // The screen speaks seconds; Media3 speaks milliseconds. Converted here, once.
            onMain { engine.setQueue(specs, start, (positionSec * 1000.0).toLong(), play, tag); true } == true
        }

        // Edits carry `expectTag`, the tag of the queue they were made for: if a newer queue has replaced it
        // the engine refuses them (a late radio top-up must not land in the wrong queue). Every call answers
        // true only once the change has been applied on the player's own thread.

        /** Reorder, remove or top up without interrupting the song that is playing. */
        AsyncFunction("replaceQueue") { items: List<Map<String, String>>, expectTag: String?, newTag: String? ->
            val engine = PlayerBridge.getEngine() ?: return@AsyncFunction false
            val specs = items.mapNotNull { QueueItemSpec.fromMap(it) }
            onMain { engine.replaceQueue(specs, expectTag, newTag) } == true
        }

        AsyncFunction("playNextItems") { items: List<Map<String, String>>, dropDuplicates: Boolean, expectTag: String? ->
            val specs = items.mapNotNull { QueueItemSpec.fromMap(it) }
            val engine = awaitEngine() ?: return@AsyncFunction false
            onMain { engine.playNext(specs, dropDuplicates, expectTag) } == true
        }

        AsyncFunction("addToQueueItems") { items: List<Map<String, String>>, dropDuplicates: Boolean, expectTag: String? ->
            val specs = items.mapNotNull { QueueItemSpec.fromMap(it) }
            val engine = awaitEngine() ?: return@AsyncFunction false
            onMain { engine.addToQueue(specs, dropDuplicates, expectTag) } == true
        }

        AsyncFunction("removeQueueItem") { mediaId: String, expectTag: String? ->
            val engine = PlayerBridge.getEngine() ?: return@AsyncFunction false
            onMain { engine.removeById(mediaId, expectTag) } == true
        }

        AsyncFunction("clearQueue") {
            val engine = PlayerBridge.getEngine() ?: return@AsyncFunction false
            onMain { engine.clear(); true } == true
        }

        AsyncFunction("skipToNext") {
            val engine = PlayerBridge.getEngine() ?: return@AsyncFunction false
            onMain { engine.skipToNext(); true } == true
        }

        AsyncFunction("skipToPrevious") {
            val engine = PlayerBridge.getEngine() ?: return@AsyncFunction false
            onMain { engine.skipToPrevious(); true } == true
        }

        /** A tap on a row of "Up next": `position` counts in play order. */
        AsyncFunction("skipToIndex") { position: Int ->
            val engine = PlayerBridge.getEngine() ?: return@AsyncFunction false
            onMain { engine.skipToIndex(position); true } == true
        }

        AsyncFunction("setShuffle") { on: Boolean ->
            val engine = awaitEngine() ?: return@AsyncFunction false
            onMain { engine.setShuffle(on); true } == true
        }

        /** "off", "all" or "one". */
        AsyncFunction("setRepeatMode") { mode: String ->
            val engine = awaitEngine() ?: return@AsyncFunction false
            onMain { engine.setRepeat(RepeatKind.fromWire(mode)); true } == true
        }

        /** The queue as the engine holds it, with every song's details when asked (null when it is empty). */
        AsyncFunction("getQueueState") { withItems: Boolean ->
            val engine = PlayerBridge.getEngine() ?: return@AsyncFunction null
            onMain { engine.state(withItems) }?.takeIf { (it["ids"] as? List<*>)?.isNotEmpty() == true }
        }

        /** Whether an earlier run saved a queue. Looks at the file only; does not start the service. */
        Function("hasSavedQueue") {
            val context = appContext.reactContext ?: return@Function false
            File(context.filesDir, "native-queue.json").isFile
        }

        /** Puts the saved queue back, paused where it was (null when nothing was saved). */
        AsyncFunction("restoreQueue") {
            val engine = awaitEngine() ?: return@AsyncFunction null
            onMain { engine.restore() ?: emptyMap() }?.takeIf { it.isNotEmpty() }
        }

        /** False when there is no player (the service is gone): JS reloads the song. */
        Function("play") {
            val player = PlayerBridge.getPlayer() ?: return@Function false
            mainHandler.post {
                // After a stream error the player sits idle; play() alone
                // would do nothing, so re-prepare at the same position.
                if (player.playbackState == Player.STATE_IDLE && player.mediaItemCount > 0) player.prepare()
                // Suppressed by another app's audio focus: playWhenReady is
                // already true, so play() would be a no-op. Toggle it so
                // ExoPlayer asks for focus again and actually resumes.
                if (player.playWhenReady && player.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE) {
                    player.pause()
                }
                player.play()
            }
            true
        }

        /** Re-sends the current status (the app came back to the foreground). */
        Function("refreshStatus") {
            mainHandler.post { PlayerBridge.emitStatus() }
            null
        }

        Function("pause") {
            PlayerBridge.getPlayer()?.let { player -> mainHandler.post { player.pause() } }
        }

        Function("seekTo") { seconds: Double ->
            PlayerBridge.getPlayer()?.let { player ->
                val ms = (seconds * 1000.0).toLong()
                mainHandler.post { player.seekTo(ms) }
            }
        }

        Function("updateMetadata") { metadata: Map<String, String> ->
            PlayerBridge.getPlayer()?.let { player ->
                mainHandler.post {
                    val currentItem = player.currentMediaItem ?: return@post
                    val updatedMetadata = mediaMetadataOf(metadata)
                    val newItem = currentItem.buildUpon().setMediaMetadata(updatedMetadata).build()
                    player.replaceMediaItem(player.currentMediaItemIndex, newItem)
                }
            }
        }

        Function("destroy") {
            val context = appContext.reactContext ?: return@Function null
            val intent = Intent(context, PlaybackService::class.java)
            context.stopService(intent)
        }
    }

    /** Starts the playback service if it is not running and waits (up to 2 s) for its queue engine. */
    private fun awaitEngine(): QueueEngine? {
        val context = appContext.reactContext ?: return null
        // startService, not startForegroundService: MediaSessionService posts the media notification and
        // promotes itself to foreground when playback begins. Starting it as a foreground service here would
        // demand a startForeground() call within ~5s that never comes while the user is merely loading a
        // track, which Android kills the process for.
        context.startService(Intent(context, PlaybackService::class.java))
        var waited = 0
        while (PlayerBridge.getEngine() == null && waited < 100) {
            Thread.sleep(20)
            waited++
        }
        return PlayerBridge.getEngine()
    }

    /** Runs [block] on the main thread (ExoPlayer's looper) and waits for it. Null if it failed or took too long. */
    private fun <T : Any> onMain(timeoutSeconds: Long = 5, block: () -> T): T? {
        val result = AtomicReference<T?>(null)
        val latch = CountDownLatch(1)
        mainHandler.post {
            try {
                result.set(block())
            } catch (e: Exception) {
                Log.w(TAG, "player call failed: ${e.message}")
            } finally {
                latch.countDown()
            }
        }
        latch.await(timeoutSeconds, TimeUnit.SECONDS)
        return result.get()
    }

    private fun mediaMetadataOf(metadata: Map<String, String>): MediaMetadata =
        MediaMetadata.Builder()
            .setTitle(clip(metadata["title"]))
            .setArtist(clip(metadata["artist"]))
            .setAlbumTitle(clip(metadata["album"]))
            .apply {
                metadata["artworkUri"]?.let {
                    if (it.isNotEmpty() && isAllowedUri(it)) setArtworkUri(Uri.parse(it))
                }
            }
            .build()

    private fun clip(value: String?): String =
        (value ?: "").take(META_MAX)

    /**
     * Trust boundary for anything that becomes a MediaItem URI.
     * Local library + downloads use file/content; streaming covers use https.
     */
    private fun isAllowedUri(uri: String): Boolean {
        if (uri.isBlank() || uri.length > 4096) return false
        val scheme = Uri.parse(uri).scheme?.lowercase() ?: return false
        return scheme == "file" || scheme == "content" || scheme == "https"
    }
}
