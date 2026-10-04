package com.lyricflow.app.playback

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ShuffleOrder.DefaultShuffleOrder
import com.lyricflow.app.modules.PlayerBridge
import com.lyricflow.app.playback.QueueMath.EndAction
import com.lyricflow.app.playback.QueueMath.PreviousAction
import com.lyricflow.app.playback.QueueMath.RepeatKind
import java.io.File
import java.util.concurrent.Executors

private const val TAG = "QueueEngine"
private const val SAVE_DELAY_MS = 1_500L
private const val META_MAX = 500

/**
 * The whole queue lives here, inside the player service — not in JavaScript. This is Echo Music's design
 * (MusicService.kt owns the playlist, PlayerConnection.kt is a remote control for it): next, previous, shuffle,
 * repeat, play next, add to queue, reordering, topping the queue up and saving it across restarts all happen on
 * the playlist ExoPlayer already holds, so the lock screen, a Bluetooth button or a skip with the screen off never
 * waits for JavaScript.
 *
 * Every public method runs on the main thread (ExoPlayer's application looper); the React Native module hops
 * there first. JavaScript is told what changed through [PlayerBridge]: the queue (coalesced to one message per
 * tick), the song that is now playing, and "running low" so it can add more.
 */
class QueueEngine(
    private val player: ExoPlayer,
    private val storeFile: File,
) : Player.Listener {

    private val main = Handler(Looper.getMainLooper())
    private val writer = Executors.newSingleThreadExecutor()

    /** An opaque label from JavaScript (which list this queue came from), kept with the queue and saved with it. */
    var tag: String? = null
        private set

    private var changePosted = false
    private var askedForSize = -1
    private var released = false

    private val flushChange = Runnable {
        changePosted = false
        if (released) return@Runnable
        PlayerBridge.emitQueueChanged(state(withItems = false))
        maybeAskForMore()
    }
    private val saveRun = Runnable { saveNow() }

    // -- Building the playlist ---------------------------------------------------------------------------------

    private fun clip(value: String): String = value.take(META_MAX)

    private fun mediaItemOf(spec: QueueItemSpec): MediaItem =
        MediaItem.Builder()
            .setUri(spec.uri)
            .setMediaId(spec.id)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(clip(spec.title))
                    .setArtist(clip(spec.artist))
                    .setAlbumTitle(clip(spec.album))
                    .apply { if (spec.artworkUri.isNotEmpty() && QueueItemSpec.isAllowedUri(spec.artworkUri)) setArtworkUri(Uri.parse(spec.artworkUri)) }
                    .build()
            )
            .build()

    private fun specOf(item: MediaItem): QueueItemSpec = QueueItemSpec(
        id = item.mediaId,
        uri = item.localConfiguration?.uri?.toString().orEmpty(),
        title = item.mediaMetadata.title?.toString().orEmpty(),
        artist = item.mediaMetadata.artist?.toString().orEmpty(),
        album = item.mediaMetadata.albumTitle?.toString().orEmpty(),
        artworkUri = item.mediaMetadata.artworkUri?.toString().orEmpty(),
    )

    // -- Reading the playlist ----------------------------------------------------------------------------------

    /** Playlist indices in the order they will play (shuffle-aware): what "Up next" shows. */
    fun playOrder(): IntArray {
        val timeline = player.currentTimeline
        if (timeline.isEmpty) return IntArray(0)
        val shuffle = player.shuffleModeEnabled
        val out = ArrayList<Int>(timeline.windowCount)
        var i = timeline.getFirstWindowIndex(shuffle)
        while (i != C.INDEX_UNSET && out.size < timeline.windowCount) {
            out.add(i)
            i = timeline.getNextWindowIndex(i, Player.REPEAT_MODE_OFF, shuffle)
        }
        return out.toIntArray()
    }

    private fun firstInOrder(): Int = player.currentTimeline.getFirstWindowIndex(player.shuffleModeEnabled)

    private fun repeatKind(): RepeatKind = when (player.repeatMode) {
        Player.REPEAT_MODE_ONE -> RepeatKind.ONE
        Player.REPEAT_MODE_ALL -> RepeatKind.ALL
        else -> RepeatKind.OFF
    }

    private fun mediaIds(): List<String> = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }

    /** What JavaScript mirrors: the songs in play order and where the playing one is. [withItems] adds each song's details. */
    fun state(withItems: Boolean): Map<String, Any?> {
        val order = playOrder()
        val current = player.currentMediaItemIndex
        val out = HashMap<String, Any?>()
        out["ids"] = order.map { player.getMediaItemAt(it).mediaId }
        out["index"] = order.indexOf(current)
        out["shuffle"] = player.shuffleModeEnabled
        out["repeat"] = repeatKind().wire
        out["tag"] = tag
        out["positionSec"] = player.currentPosition.toDouble() / 1000.0
        if (withItems) out["items"] = order.map { specOf(player.getMediaItemAt(it)).toMap() }
        return out
    }

    // -- Replacing and editing the queue -----------------------------------------------------------------------

    /**
     * Edits that come from a screen that read the queue earlier (a radio top-up, a reorder) carry the tag of the
     * queue they were made for. If a newer queue has replaced it since, the edit is refused: a late answer must
     * never change a queue it was not made for. A null [expectTag] skips the check.
     */
    private fun holds(expectTag: String?): Boolean = !released && (expectTag == null || expectTag == tag)

    /** A brand-new queue, starting at [startIndex] (Echo: playQueue). */
    fun setQueue(specs: List<QueueItemSpec>, startIndex: Int, positionMs: Long, play: Boolean, newTag: String?) {
        if (specs.isEmpty()) {
            clear()
            return
        }
        tag = newTag
        val start = startIndex.coerceIn(0, specs.lastIndex)
        player.setMediaItems(specs.map(::mediaItemOf), start, positionMs.coerceAtLeast(0L))
        if (player.shuffleModeEnabled) applyFreshShuffle()
        player.prepare()
        player.playWhenReady = play
        afterEdit()
    }

    /**
     * Swap the queue for [specs] without interrupting the song that is playing: everything else is taken out and
     * put back around it in the order given. Used for reordering, removing and topping up from the screen. The
     * order given is the order on screen, so with shuffle on it becomes the play order.
     */
    fun replaceQueue(specs: List<QueueItemSpec>, expectTag: String?, newTag: String?): Boolean {
        if (!holds(expectTag)) return false
        if (player.mediaItemCount == 0) {
            setQueue(specs, 0, 0L, false, newTag ?: tag)
            return true
        }
        // The queue may become another list while the song plays on (Radio swaps what follows the playing song).
        if (newTag != null) tag = newTag
        val current = player.currentMediaItemIndex
        val at = QueueMath.locateCurrent(specs.map { it.id }, player.currentMediaItem?.mediaId)
        // A queue that leaves the playing song out keeps it at the front, and the new songs follow.
        val before = if (at >= 0) specs.subList(0, at) else emptyList()
        val after = if (at >= 0) specs.subList(at + 1, specs.size) else specs
        val count = player.mediaItemCount
        if (current + 1 < count) player.removeMediaItems(current + 1, count)
        if (current > 0) player.removeMediaItems(0, current)
        if (before.isNotEmpty()) player.addMediaItems(0, before.map(::mediaItemOf))
        if (after.isNotEmpty()) player.addMediaItems(player.mediaItemCount, after.map(::mediaItemOf))
        if (player.shuffleModeEnabled) player.setShuffleOrder(DefaultShuffleOrder(IntArray(player.mediaItemCount) { it }, System.currentTimeMillis()))
        afterEdit()
        return true
    }

    /** Echo: playNext. The songs go right after the playing one; with shuffle on they keep that place. */
    fun playNext(specs: List<QueueItemSpec>, dropDuplicates: Boolean, expectTag: String?): Boolean {
        if (!holds(expectTag) || specs.isEmpty()) return false
        if (player.mediaItemCount == 0) {
            setQueue(specs, 0, 0L, true, tag)
            return true
        }
        if (dropDuplicates) removeDuplicates(specs.map { it.id }.toSet())
        val insertAt = player.currentMediaItemIndex + 1
        player.addMediaItems(insertAt, specs.map(::mediaItemOf))
        if (player.shuffleModeEnabled) {
            val inserted = (insertAt until insertAt + specs.size).toList()
            val order = QueueMath.orderWithNextBlock(playOrder().toList(), player.currentMediaItemIndex, inserted)
            player.setShuffleOrder(DefaultShuffleOrder(order, System.currentTimeMillis()))
        }
        player.prepare()
        afterEdit()
        return true
    }

    /** Echo: addToQueue. The songs join the end. */
    fun addToQueue(specs: List<QueueItemSpec>, dropDuplicates: Boolean, expectTag: String?): Boolean {
        if (!holds(expectTag) || specs.isEmpty()) return false
        if (player.mediaItemCount == 0) {
            setQueue(specs, 0, 0L, false, tag)
            return true
        }
        if (dropDuplicates) removeDuplicates(specs.map { it.id }.toSet())
        val first = player.mediaItemCount
        player.addMediaItems(specs.map(::mediaItemOf))
        if (player.shuffleModeEnabled) {
            val appended = (first until first + specs.size).toList()
            player.setShuffleOrder(DefaultShuffleOrder(QueueMath.orderWithAppended(playOrder().toList(), appended), System.currentTimeMillis()))
        }
        player.prepare()
        afterEdit()
        return true
    }

    /** Take every copy of a song out of the queue. If it is the one playing, the player moves on to the next. */
    fun removeById(mediaId: String, expectTag: String?): Boolean {
        if (!holds(expectTag)) return false
        for (i in (0 until player.mediaItemCount).reversed()) {
            if (player.getMediaItemAt(i).mediaId == mediaId) player.removeMediaItem(i)
        }
        afterEdit()
        return true
    }

    fun clear() {
        tag = null
        player.stop()
        player.clearMediaItems()
        storeFile.delete()
        afterEdit()
    }

    private fun removeDuplicates(incoming: Set<String>) {
        for (i in QueueMath.duplicateIndices(mediaIds(), incoming, keep = player.currentMediaItemIndex)) player.removeMediaItem(i)
    }

    /**
     * Make [spec] the playing item with this address, leaving the rest of the queue alone. The address of a song
     * can change (a streamed link that expired is replaced by a fresh one); a song the queue does not hold becomes
     * a queue of one. The caller decides whether to play.
     */
    fun loadItem(spec: QueueItemSpec) {
        val count = player.mediaItemCount
        var index = -1
        for (i in 0 until count) {
            if (player.getMediaItemAt(i).mediaId != spec.id) continue
            if (index < 0 || i == player.currentMediaItemIndex) index = i
        }
        if (index < 0) {
            setQueue(listOf(spec), 0, 0L, false, null)
            return
        }
        val sameAddress = player.getMediaItemAt(index).localConfiguration?.uri?.toString() == spec.uri
        if (!sameAddress) player.replaceMediaItem(index, mediaItemOf(spec))
        if (index != player.currentMediaItemIndex || !sameAddress) player.seekTo(index, 0L)
        player.prepare()
        afterEdit()
    }

    // -- Moving through the queue ------------------------------------------------------------------------------

    private fun resume() {
        if (player.playbackState == Player.STATE_IDLE || player.playbackState == Player.STATE_ENDED) player.prepare()
        player.playWhenReady = true
    }

    /** Next. At the end of the queue it wraps to the first song, as the button always has. */
    fun skipToNext() {
        if (player.mediaItemCount == 0) return
        if (player.hasNextMediaItem()) player.seekToNextMediaItem() else player.seekTo(firstInOrder(), 0L)
        resume()
    }

    /** Previous (Echo: PlayerConnection.seekToPrevious): past 3 s it starts the song over, otherwise goes back one. */
    fun skipToPrevious() {
        if (player.mediaItemCount == 0) return
        when (QueueMath.previousAction(player.currentPosition, player.hasPreviousMediaItem())) {
            PreviousAction.RESTART -> player.seekTo(0L)
            PreviousAction.GO_BACK -> player.seekToPreviousMediaItem()
        }
        resume()
    }

    /** A tap on a row of the queue on screen: [position] counts in play order. */
    fun skipToIndex(position: Int) {
        val window = playOrder().getOrNull(position) ?: return
        player.seekTo(window, 0L)
        resume()
    }

    fun setShuffle(on: Boolean) {
        player.shuffleModeEnabled = on
    }

    fun setRepeat(kind: RepeatKind) {
        player.repeatMode = when (kind) {
            RepeatKind.ONE -> Player.REPEAT_MODE_ONE
            RepeatKind.ALL -> Player.REPEAT_MODE_ALL
            RepeatKind.OFF -> Player.REPEAT_MODE_OFF
        }
    }

    /** True when the next/previous buttons have somewhere to go. */
    fun canSkip(): Boolean = player.mediaItemCount > 0

    private fun applyFreshShuffle() {
        val count = player.mediaItemCount
        if (count == 0) return
        player.setShuffleOrder(DefaultShuffleOrder(QueueMath.shuffledOrder(count, player.currentMediaItemIndex), System.currentTimeMillis()))
    }

    // -- Player events -----------------------------------------------------------------------------------------

    override fun onTimelineChanged(timeline: Timeline, reason: Int) {
        queueChanged()
        scheduleSave()
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        val id = mediaItem?.mediaId
        if (!id.isNullOrEmpty() && reason != Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT) {
            val reasonName = when (reason) {
                Player.MEDIA_ITEM_TRANSITION_REASON_AUTO -> "auto"
                Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> "seek"
                else -> "playlist"
            }
            PlayerBridge.emitTrackAdvanced(id, playOrder().indexOf(player.currentMediaItemIndex), reasonName)
        }
        queueChanged()
        scheduleSave()
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        if (playbackState == Player.STATE_ENDED) {
            when (QueueMath.endAction(repeatKind(), player.mediaItemCount)) {
                EndAction.RESTART_AND_PLAY -> {
                    player.seekTo(firstInOrder(), 0L)
                    player.prepare()
                    player.play()
                }
                EndAction.RESET_AND_PAUSE -> {
                    player.seekTo(firstInOrder(), 0L)
                    player.pause()
                }
                EndAction.NONE -> Unit
            }
        }
        scheduleSave()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        if (!isPlaying) scheduleSave()
    }

    /** Echo: onShuffleModeEnabledChanged. Turning shuffle on mixes the queue with the playing song kept first. */
    override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) {
        if (shuffleModeEnabled) applyFreshShuffle()
        queueChanged()
        scheduleSave()
    }

    override fun onRepeatModeChanged(repeatMode: Int) {
        queueChanged()
        scheduleSave()
    }

    private fun afterEdit() {
        queueChanged()
        scheduleSave()
    }

    private fun queueChanged() {
        if (changePosted || released) return
        changePosted = true
        main.post(flushChange)
    }

    /** Echo's "auto load more": ask JavaScript for songs when the playing song and those after it are running out. */
    private fun maybeAskForMore() {
        val order = playOrder()
        val at = order.indexOf(player.currentMediaItemIndex)
        if (at < 0) return
        if (!QueueMath.runningLow(order.size - at - 1)) {
            askedForSize = -1
            return
        }
        // One question per queue size: an answer that adds nothing must not be asked again in a loop.
        if (askedForSize == order.size) return
        askedForSize = order.size
        PlayerBridge.emitQueueLow(order.size, player.currentMediaItem?.mediaId.orEmpty(), tag)
    }

    // -- Saving and restoring (Echo: the persistent queue) -----------------------------------------------------

    private fun scheduleSave() {
        if (released) return
        main.removeCallbacks(saveRun)
        main.postDelayed(saveRun, SAVE_DELAY_MS)
    }

    /**
     * Writes the queue, where it is and how it is set, so it can come back after the service or the app is
     * killed. The file is written whole next to the real one and renamed over it (an atomic replace on Android),
     * so a kill mid-write leaves the last good file, never half of a new one.
     */
    fun saveNow() {
        main.removeCallbacks(saveRun)
        if (player.mediaItemCount == 0) return
        val text = try {
            val order = playOrder()
            QueueSnapshot(
                tag = tag,
                index = order.indexOf(player.currentMediaItemIndex).coerceAtLeast(0),
                positionMs = player.currentPosition,
                shuffle = player.shuffleModeEnabled,
                repeat = repeatKind(),
                items = order.map { specOf(player.getMediaItemAt(it)) },
            ).encode()
        } catch (e: Exception) {
            Log.w(TAG, "queue not saved: ${e.message}")
            return
        }
        try {
            writer.execute {
                try {
                    val temp = File(storeFile.parentFile, storeFile.name + ".tmp")
                    temp.writeText(text)
                    if (!temp.renameTo(storeFile)) {
                        temp.delete()
                        Log.w(TAG, "queue not saved: could not replace the saved file")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "queue not saved: ${e.message}")
                }
            }
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            // The service is going away and the writer is already shut down: the last save went out.
        }
    }

    /**
     * Puts the saved queue back, paused where it was. Null when there is none, or it is unreadable. If the
     * service already holds a queue (only the app was killed) it is reported as it is.
     */
    fun restore(): Map<String, Any?>? {
        if (player.mediaItemCount > 0) return state(withItems = true)
        val saved = try {
            if (storeFile.isFile) QueueSnapshot.decode(storeFile.readText()) else null
        } catch (e: Exception) {
            Log.w(TAG, "saved queue unreadable: ${e.message}")
            null
        } ?: return null
        tag = saved.tag
        // Shuffle first, while there is nothing to shuffle: the order saved (play order) is restored as it was.
        player.shuffleModeEnabled = saved.shuffle
        setRepeat(saved.repeat)
        player.setMediaItems(saved.items.map(::mediaItemOf), saved.index, saved.positionMs)
        if (player.shuffleModeEnabled) player.setShuffleOrder(DefaultShuffleOrder(IntArray(saved.items.size) { it }, System.currentTimeMillis()))
        player.prepare()
        player.playWhenReady = false
        afterEdit()
        return state(withItems = true)
    }

    fun release() {
        saveNow()
        released = true
        main.removeCallbacksAndMessages(null)
        writer.shutdown()
    }
}
