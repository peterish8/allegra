package com.lyricflow.app.island

/**
 * The island's timed motion, kept apart from the view so it is tested on the JVM (IslandMotionTest).
 *
 * - The marquee follows the app's (`components/allegra/marqueeMath.ts`): a beat with the start showing, one slow loop
 *   right to left that eases in and out, a 4 s rest, again. Only text that does not fit moves, and only while music
 *   plays: on pause it glides home to its start (IslandView), and plays on from there.
 * - The light behind the open card is its own class (IslandFlow).
 */
object IslandMotion {
    /** Density-independent pixels a second at full pace: slow enough to read as it goes by. */
    const val MARQUEE_SPEED_DP = 30f
    /** A beat with the start showing before the first loop (and after the song plays again). */
    const val MARQUEE_START_S = 1.4f
    /** The rest with the start showing between loops. */
    const val MARQUEE_REST_S = 4f
    /** Each loop eases in and out over this long instead of starting and stopping dead. */
    const val MARQUEE_RAMP_S = 0.6f
    const val MARQUEE_GAP_DP = 48f

    /** How far one loop travels: the text and the gap before its next copy (which then shows the start again). */
    fun marqueeDistance(textWidth: Float, density: Float) = textWidth + MARQUEE_GAP_DP * density

    /** How long one loop takes, ramps included. */
    private fun loopSeconds(distance: Float, density: Float) = distance / (MARQUEE_SPEED_DP * density) + MARQUEE_RAMP_S

    /**
     * How far text [textWidth] wide has slid left in a box [room] wide, [seconds] into its clock (which only runs
     * while music plays). 0 when it fits. Each loop speeds up, keeps a steady pace and slows down again, so the
     * text glides away from its start and lands back on it (the next copy) without a jerk.
     */
    fun marqueeOffset(seconds: Float, textWidth: Float, room: Float, density: Float): Float {
        if (room <= 0f || textWidth <= room + 1f) return 0f
        val distance = marqueeDistance(textWidth, density)
        val loop = loopSeconds(distance, density)
        val t = seconds - MARQUEE_START_S
        if (t <= 0f) return 0f
        val k = t % (loop + MARQUEE_REST_S)
        if (k >= loop) return 0f
        val v = MARQUEE_SPEED_DP * density
        val ramp = MARQUEE_RAMP_S
        return when {
            k < ramp -> v * k * k / (2f * ramp)
            k < loop - ramp -> v * (k - ramp / 2f)
            else -> distance - v * (loop - k) * (loop - k) / (2f * ramp)
        }
    }

    /** Seconds until text that is resting starts to move again; 0 while it moves; -1 when it fits (never moves). */
    fun marqueeWait(seconds: Float, textWidth: Float, room: Float, density: Float): Float {
        if (room <= 0f || textWidth <= room + 1f) return -1f
        val loop = loopSeconds(marqueeDistance(textWidth, density), density)
        val t = seconds - MARQUEE_START_S
        if (t < 0f) return -t
        val k = t % (loop + MARQUEE_REST_S)
        return if (k < loop) 0f else loop + MARQUEE_REST_S - k
    }

    /**
     * Where text at [offset] goes home to when the music pauses: back to 0, or on to the next copy ([distance],
     * which shows the same start), whichever is nearer, so the glide home is never longer than half a loop.
     */
    fun marqueeHome(offset: Float, distance: Float): Float = if (offset > distance / 2f) distance else 0f
}
