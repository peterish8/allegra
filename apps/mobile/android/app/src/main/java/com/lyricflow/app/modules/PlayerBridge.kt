package com.lyricflow.app.modules

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.lyricflow.app.playback.QueueEngine
import java.lang.ref.WeakReference
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel

object PlayerBridge {
    private var activePlayerRef = WeakReference<ExoPlayer>(null)
    private var activeServiceRef = WeakReference<Context>(null)
    private var activeEngineRef = WeakReference<QueueEngine>(null)

    var onStatusUpdate: ((
        position: Double,
        duration: Double,
        isPlaying: Boolean,
        playWhenReady: Boolean,
        isBuffering: Boolean,
        didJustFinish: Boolean,
        suppressed: Boolean
    ) -> Unit)? = null
    var onRemoteCommand: ((command: String) -> Unit)? = null
    /** The song now playing changed: [index] is its place in the queue in play order, [reason] is auto / seek / playlist. */
    var onTrackAdvanced: ((mediaId: String, index: Int, reason: String) -> Unit)? = null
    /** The queue, its order, shuffle or repeat changed (one message per tick). */
    var onQueueChanged: ((state: Map<String, Any?>) -> Unit)? = null
    /** The playing song and those after it are running out: JavaScript may add more. */
    var onQueueLow: ((size: Int, mediaId: String, tag: String?) -> Unit)? = null
    /**
     * Playback stopped for good and the player can't fix it in place:
     * "expired" (the link was refused), "network" (retries ran out), "stall"
     * (bytes stopped coming), "error", or "released" (the service is gone).
     */
    var onPlaybackError: ((reason: String, position: Double) -> Unit)? = null
    private var lastPositionSeconds = 0.0

    /**
     * Whether a screen is on to watch the position. Position reports (four a second) only go out while it is;
     * every change of state still does. Nothing ticks when nothing is watching.
     */
    @Volatile
    private var uiVisible = true

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            emitStatus()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            emitStatus()
            // The poller sleeps while nothing plays; this is what wakes it.
            if (isPlaying) playingSignal.trySend(Unit)
        }

        // Fires the moment play()/pause() is applied, before buffering resolves.
        // This is what lets JS render the transport state without guessing.
        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            emitStatus()
        }

        // Another app took audio focus for a moment (a call, a voice note, a
        // video). playWhenReady stays true but nothing plays until it gives
        // focus back — tell JS so the button stops claiming "playing".
        override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) {
            emitStatus()
        }

        // Which song is playing is [QueueEngine]'s to announce (it knows the place in the queue).
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            emitStatus()
        }
    }

    private val pollerScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private var pollerJob: Job? = null

    /** Conflated, so a "started playing" that lands mid-iteration is never lost. */
    private val playingSignal = Channel<Unit>(Channel.CONFLATED)

    fun setPlayer(player: ExoPlayer, context: Context, engine: QueueEngine) {
        activePlayerRef = WeakReference(player)
        activeServiceRef = WeakReference(context)
        activeEngineRef = WeakReference(engine)
        player.addListener(playerListener)
        startProgressPoller()
        // A player that is already playing (service restarted mid-song) has no
        // "started" event coming.
        playingSignal.trySend(Unit)
    }

    fun clearPlayer() {
        stopProgressPoller()
        activePlayerRef.get()?.removeListener(playerListener)
        activePlayerRef.clear()
        activeServiceRef.clear()
        activeEngineRef.clear()
    }

    fun getPlayer(): ExoPlayer? = activePlayerRef.get()

    fun getEngine(): QueueEngine? = activeEngineRef.get()

    /** The app came to the front (true) or left it (false). Returning wakes the position reports. */
    fun setUiVisible(visible: Boolean) {
        uiVisible = visible
        if (visible) playingSignal.trySend(Unit)
    }

    fun emitStatus(didJustFinish: Boolean = false) {
        val player = activePlayerRef.get() ?: return
        val isPlaying = player.isPlaying
        val isBuffering = player.playbackState == Player.STATE_BUFFERING
        // The end of the queue is [QueueEngine]'s: it starts over or rests on the first song, so the screen
        // never has to move on by itself.
        val finished = false

        val position = player.currentPosition.toDouble() / 1000.0
        val duration = player.duration.toDouble() / 1000.0
        lastPositionSeconds = position

        onStatusUpdate?.invoke(
            position,
            if (duration < 0) 0.0 else duration,
            isPlaying,
            player.playWhenReady,
            isBuffering,
            finished,
            player.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE
        )
    }

    fun emitTrackAdvanced(mediaId: String, index: Int, reason: String) {
        onTrackAdvanced?.invoke(mediaId, index, reason)
    }

    fun emitQueueChanged(state: Map<String, Any?>) {
        onQueueChanged?.invoke(state)
    }

    fun emitQueueLow(size: Int, mediaId: String, tag: String?) {
        onQueueLow?.invoke(size, mediaId, tag)
    }

    fun emitError(reason: String) {
        val player = activePlayerRef.get()
        val position = player?.currentPosition?.let { it.toDouble() / 1000.0 } ?: lastPositionSeconds
        emitStatus()
        onPlaybackError?.invoke(reason, position)
    }

    /** The service is going away: a last "stopped" status, then the reason. */
    fun emitReleased() {
        val player = activePlayerRef.get()
        val position = player?.currentPosition?.let { it.toDouble() / 1000.0 } ?: lastPositionSeconds
        val duration = player?.duration?.takeIf { it > 0 }?.let { it.toDouble() / 1000.0 } ?: 0.0
        onStatusUpdate?.invoke(position, duration, false, false, false, false, false)
        onPlaybackError?.invoke("released", position)
    }

    /**
     * Position ticks, four a second, but only while the player is playing and a screen is showing.
     * Paused, buffering, ended, backgrounded or idle, the loop is suspended on the channel and costs no
     * wake-ups; every state change JS needs still arrives through the listener events above, and coming
     * back to the front wakes the loop again ([setUiVisible]).
     */
    private fun startProgressPoller() {
        pollerJob?.cancel()
        pollerJob = pollerScope.launch {
            while (isActive) {
                playingSignal.receive()
                while (isActive) {
                    val stillPlaying = withContext(Dispatchers.Main) {
                        val player = activePlayerRef.get()
                        if (player != null && player.isPlaying && uiVisible) {
                            emitStatus()
                            true
                        } else {
                            false
                        }
                    }
                    if (!stillPlaying) break
                    delay(250)
                }
            }
        }
    }

    private fun stopProgressPoller() {
        pollerJob?.cancel()
        pollerJob = null
    }
}
