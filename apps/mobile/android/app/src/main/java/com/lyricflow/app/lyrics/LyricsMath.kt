package com.lyricflow.app.lyrics

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/**
 * The arithmetic behind the native lyrics' motion: a port of `src/playback/lyricMotion.ts` and
 * `lyricLayout.ts`, so the lines move exactly as the React Native list moves them. Pure, so the JVM tests pin it.
 */
object LyricsMath {
    /** The glide's time constant, seconds. */
    const val GLIDE_SMOOTH_S = 0.42f
    /** A line goes live this long before its first word. */
    const val LINE_LEAD_MS = 300L
    /** How close to the sung line counts as "back where you started", px of dp. */
    const val RESUME_SNAP_DP = 72f
    const val AUTO_RESUME_MS = 3500L
    const val EARLY_RESUME_MS = 500L
    /** The sung line brightens (and the last one dims) over this long. */
    const val DIM_MS = 360L
    /** The scroll offset past which the dismiss drag must leave the lines alone. */
    const val TOP_SLACK_DP = 2f
    /** Lines further than this from the sung one change brightness without a tween. */
    const val TWEEN_REACH = 6

    private const val SWEEP_FEATHER = 0.16f

    class Glide(val offset: Float, val velocity: Float)

    /** One frame of the critically damped follow towards 0 (Unity's SmoothDamp). */
    fun glideStep(offset: Float, velocity: Float, dt: Float, smoothS: Float = GLIDE_SMOOTH_S): Glide {
        val omega = 2f / smoothS
        val x = omega * dt
        val decay = 1f / (1f + x + 0.48f * x * x + 0.235f * x * x * x)
        val temp = (velocity + omega * offset) * dt
        return Glide((offset + temp) * decay, (velocity - omega * temp) * decay)
    }

    fun glideSettled(glide: Glide): Boolean = abs(glide.offset) < 0.75f && abs(glide.velocity) < 6f

    /** How bright a line's resting text is (see `lineRestOpacity`). */
    fun restOpacity(index: Int, active: Int, reading: Boolean, sweeping: Boolean): Float {
        if (reading) return if (index == active && !sweeping) 1f else 0.62f
        if (index == active) return if (sweeping) 0.45f else 1f
        val d = index - active
        return if (d < 0) when (d) { -1 -> 0.62f; -2 -> 0.46f; else -> 0.36f }
        else when (d) { 1 -> 0.42f; 2 -> 0.33f; else -> 0.27f }
    }

    /** Which part of a sung word one copy of the soft edge has reached: 0..1. */
    fun featherAt(p: Float, step: Int, count: Int): Float {
        val q = p * (1f + (count - 1) * SWEEP_FEATHER) - step * SWEEP_FEATHER
        return if (q < 0f) 0f else if (q > 1f) 1f else q
    }

    /** Opacity of each copy, leading first. */
    fun featherAlphas(count: Int): FloatArray = when {
        count >= 3 -> floatArrayOf(0.4f, 0.5f, 1f)
        count == 2 -> floatArrayOf(0.45f, 1f)
        else -> floatArrayOf(1f)
    }

    /** The scroll offset that puts a line's centre at [position] of the viewport, never past the content. */
    fun anchorScrollY(offset: Float, height: Float, viewport: Float, position: Float, content: Float): Float {
        val target = max(0f, offset + height / 2f - viewport * position)
        return min(target, max(0f, content - viewport))
    }

    /** Space after the last line, so the last lines can still reach the anchor. */
    fun anchorFooter(viewport: Float, position: Float, minimum: Float): Float =
        max(minimum, ceil(viewport * (1f - position)))

    /** The line sung at [positionMs] (with the lead), or -1 before the first. [atMs] is in time order. */
    fun activeIndex(atMs: LongArray, positionMs: Long): Int {
        val et = positionMs + LINE_LEAD_MS
        var low = 0
        var high = atMs.size - 1
        var found = -1
        while (low <= high) {
            val mid = (low + high) ushr 1
            if (atMs[mid] <= et) {
                found = mid
                low = mid + 1
            } else {
                high = mid - 1
            }
        }
        return found
    }

    /**
     * How far through a line's sung characters the player is, as a character offset (fractional inside a word).
     * [from], [to], [startMs], [endMs] are the segments of one line, in order.
     */
    fun highlightOffset(from: FloatArray, to: FloatArray, startMs: LongArray, endMs: LongArray, positionMs: Long): Float {
        var offset = 0f
        for (i in from.indices) {
            if (positionMs < startMs[i]) break
            if (positionMs >= endMs[i]) offset = to[i]
            else return from[i] + (to[i] - from[i]) * ((positionMs - startMs[i]).toFloat() / (endMs[i] - startMs[i]).coerceAtLeast(1))
        }
        return offset
    }

    /** The sung part of a word spanning characters [start, end), 0..1. */
    fun wordLit(offset: Float, start: Int, end: Int): Float =
        if (end <= start) 0f else ((offset - start) / (end - start)).coerceIn(0f, 1f)

    /** -1 when the sung line is above the viewport, 1 when below, 0 when within the snap distance. */
    fun pillDirection(target: Float, scrollY: Float, snap: Float): Int {
        if (target < 0f) return 0
        val delta = target - scrollY
        if (abs(delta) < snap) return 0
        return if (delta > 0f) 1 else -1
    }

    /** The sung line is fully on screen, so the next line change may re-attach the list. */
    fun lineFullyVisible(top: Float, height: Float, scrollY: Float, viewport: Float): Boolean =
        top >= scrollY && top + height <= scrollY + viewport

    /** Where a glide restarts after a line change: at most 60% of the viewport from home, so a seek doesn't race. */
    fun glideStart(toY: Float, fromY: Float, viewport: Float): Float {
        val cap = viewport * 0.6f
        return toY + max(-cap, min(cap, fromY - toY))
    }

    class EqSpec(val minDp: Float, val maxDp: Float, val durationMs: Long, val delayMs: Long)

    val EQ_SPECS = arrayOf(
        EqSpec(8f, 22f, 420, 0),
        EqSpec(12f, 34f, 360, 80),
        EqSpec(16f, 42f, 300, 40),
        EqSpec(12f, 34f, 380, 120),
        EqSpec(8f, 22f, 440, 60),
    )
    const val EQ_SCALE = 1.15f
    const val EQ_BAR_DP = 4f
    const val EQ_GAP_DP = 5f
    const val EQ_ROW_DP = 52f
    const val EQ_MIN_WIDTH_DP = 72f

    /** A dancing bar's height in dp [sinceMs] after it went active: min, then min -> max -> min on a sine ease. */
    fun eqActiveHeight(spec: EqSpec, sinceMs: Long): Float {
        val t = sinceMs - spec.delayMs
        if (t <= 0) return spec.minDp * EQ_SCALE
        val period = spec.durationMs * 2
        val phase = (t % period).toFloat() / spec.durationMs
        val x = if (phase <= 1f) phase else 2f - phase
        val eased = (1.0 - Math.cos(Math.PI * x)).toFloat() / 2f
        return (spec.minDp + (spec.maxDp - spec.minDp) * eased) * EQ_SCALE
    }

    /** A resting bar: shorter than its dancing minimum, but never under 4dp. */
    fun eqRestHeight(spec: EqSpec): Float = max(4f, spec.minDp * EQ_SCALE * 0.45f)
}
