package com.lyricflow.app.playback

/**
 * Decides whether a track that just ended really ended, or its stream stopped early. Pure: no Media3 types, so the
 * rules are JVM-tested. Main thread only (the queue engine's listener thread).
 *
 * A track that ends more than [thresholdMs] before its length goes back to where it stopped, at most
 * [maxRecoveries] times per track. The container's own duration is trusted first (a truncated MP4 still reports its
 * full length from its header); the catalog's duration, in seconds, only when the container does not know.
 */
class CutoffGuard(
    private val thresholdMs: Long = THRESHOLD_MS,
    private val maxRecoveries: Int = MAX_RECOVERIES,
) {
    sealed interface Verdict {
        data object Accept : Verdict
        data class Resume(val positionMs: Long, val attempt: Int) : Verdict
    }

    private var trackId: String? = null
    private var used = 0

    /** A different track is now the one being judged. The same id again (repeat-one) keeps its count. */
    fun onTrack(mediaId: String?) {
        if (mediaId != trackId) {
            trackId = mediaId
            used = 0
        }
    }

    /**
     * [containerDurationMs] is the decoder's duration, or any value <= 0 when unknown; [catalogDurationSec] is the
     * catalog's length in seconds, 0 when unknown. Seconds become milliseconds only here.
     */
    fun judge(mediaId: String, positionMs: Long, containerDurationMs: Long, catalogDurationSec: Int): Verdict {
        onTrack(mediaId)
        val position = positionMs.coerceAtLeast(0)
        if (position < MIN_POSITION_MS) return Verdict.Accept
        if (containerDurationMs > 0 && containerDurationMs - position <= thresholdMs) return Verdict.Accept
        val expectedMs = when {
            containerDurationMs > 0 -> containerDurationMs
            catalogDurationSec > 0 -> catalogDurationSec * 1000L
            else -> return Verdict.Accept
        }
        if (expectedMs - position <= thresholdMs || used >= maxRecoveries) return Verdict.Accept
        used += 1
        return Verdict.Resume(position, used)
    }

    companion object {
        const val THRESHOLD_MS = 3_000L
        const val MAX_RECOVERIES = 2
        const val MIN_POSITION_MS = 1_000L
    }
}
