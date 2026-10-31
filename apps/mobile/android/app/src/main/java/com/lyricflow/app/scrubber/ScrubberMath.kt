package com.lyricflow.app.scrubber

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * The song scrubber's rules, ported from `AppleSlider.tsx` (the value shown, the swell, the gesture thresholds) and
 * `positionBus.formatTimeSV` (the time labels). Pure, so it is tested on the JVM.
 */
object ScrubberMath {
    /** The touch strip the track sits in, in dp (`styles.hit`). */
    const val HIT_DP = 28f

    /** Space between the strip and the time labels, and the labels' side padding (`styles.timeRow`), in dp. */
    const val LABEL_GAP_DP = 8f
    const val LABEL_PAD_DP = 4f

    /** The pan activates after this much sideways travel and fails after this much vertical travel (dp). */
    const val ACTIVE_X_DP = 4f
    const val FAIL_Y_DP = 14f

    /** A tap is a short press that did not travel (RNGH's Tap: 500 ms). */
    const val TAP_MAX_MS = 500L

    /** A seek counts as arrived when the player is this close to it (seconds); the slider then stops holding the finger's value. */
    const val SETTLED_S = 1.0

    /** A seek that never lands releases the finger's value after this long (ms). */
    const val SETTLE_MAX_MS = 2000L

    fun clamp01(v: Float): Float = max(0f, min(1f, v))

    /** The fraction a touch at [x] points at, in a track [width] wide. */
    fun fractionAt(x: Float, width: Float): Float = if (width > 0f) clamp01(x / width) else 0f

    /** The playing fraction; 0 until the length is known. */
    fun progress(positionSec: Double, durationSec: Double): Float =
        if (durationSec > 0.0) clamp01((positionSec / durationSec).toFloat()) else 0f

    /** The finger's value while dragging or until the seek lands, the playing value otherwise. */
    fun display(dragging: Boolean, settling: Boolean, dragValue: Float, progress: Float): Float =
        if (dragging || settling) dragValue else progress

    /** Under the finger the track swells to 1.6 x (scaleY) and the fill brightens from 0.78 to 1. */
    fun trackScale(grow: Float): Float = 1f + 0.6f * grow

    fun fillAlpha(grow: Float): Float = 0.78f + 0.22f * grow

    /** `formatTimeSV`: M:SS, "0:00" for anything unusable. */
    fun formatTime(seconds: Double): String {
        if (seconds.isNaN() || seconds.isInfinite() || seconds <= 0.0) return "0:00"
        val m = floor(seconds / 60.0).toInt()
        val s = floor(seconds % 60.0).toInt()
        return "$m:${if (s < 10) "0" else ""}$s"
    }

    /** The stream index a fraction sets, as `MainPlayerModule.setVolume` rounds it (down), within 0..[max]. */
    fun volumeIndex(fraction: Float, max: Int): Int = (clamp01(fraction) * max).toInt().coerceIn(0, max.coerceAtLeast(0))

    /** The fraction a stream at [index] of [max] steps shows; 0 when the stream has no steps. */
    fun volumeFraction(index: Int, max: Int): Float = if (max > 0) clamp01(index.toFloat() / max) else 0f

    enum class Move { WAIT, CLAIM, YIELD }

    /**
     * What a drag [dx], [dy] from the touch-down point means: a sideways drag past [activeX] is the scrubber's, a
     * vertical one past [failY] is not (it is the player's swipe to close). Vertical wins when both hold.
     */
    fun classify(dx: Float, dy: Float, activeX: Float, failY: Float): Move = when {
        abs(dy) > failY -> Move.YIELD
        abs(dx) > activeX -> Move.CLAIM
        else -> Move.WAIT
    }

    /** A tap: lifted soon enough, without having travelled past the touch slop. */
    fun isTap(elapsedMs: Long, travel: Float, slop: Float): Boolean = elapsedMs <= TAP_MAX_MS && travel <= slop

    /** Whether the player has reached the place the finger chose, so the slider can follow the song again. */
    fun settled(positionSec: Double, targetSec: Double): Boolean = abs(positionSec - targetSec) <= SETTLED_S
}
