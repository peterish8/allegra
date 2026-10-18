package com.lyricflow.app.island

/**
 * The island's timed motion, kept apart from the view so it is tested on the JVM (IslandMotionTest).
 *
 * - The marquee follows the app's (`components/allegra/marqueeMath.ts`): a beat with the start showing, one slow loop
 *   right to left that eases in and out, a 4 s rest, again. Only text that does not fit moves, and only while music
 *   plays: on pause it glides home to its start (IslandView), and plays on from there.
 * - The light behind the open card is the song's cover as moving light (IslandGlow), in layers turning against
 *   each other on their own periods. Their clock runs only while music plays.
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

    /**
     * One layer of the light (IslandGlow's blurred cover, drawn large): where it turns about (fractions of the card's
     * width and of the light's depth at the bottom), how big it is (times the card's width), how fast it turns
     * (degrees a second, either way), how much it breathes in size and over how long, and how strong it is.
     * Several such layers turning against each other is Apple Music's moving backdrop: the colours flow round each
     * other and never repeat a shape, with nothing that reads as a circle. Their clock runs only while music plays.
     */
    class Layer(val x: Float, val y: Float, val size: Float, val degPerS: Float, val breathe: Float, val breatheS: Float,
                val alpha: Float, val screen: Boolean)

    val LAYERS = arrayOf(
        Layer(0.34f, 0.86f, 1.9f, 7f, 0.08f, 23f, 1f, screen = false),
        Layer(0.72f, 0.98f, 1.6f, -9f, 0.10f, 29f, 0.8f, screen = false),
        Layer(0.52f, 0.78f, 1.25f, 12f, 0.12f, 19f, 0.5f, screen = true),
    )

    /** Layer [layer] at [seconds] on its clock: its turn in degrees in [out][0] and its size factor in [out][1]. */
    fun layerAt(layer: Layer, seconds: Float, out: FloatArray) {
        out[0] = (layer.degPerS * seconds) % 360f
        out[1] = layer.size * (1f + layer.breathe * kotlin.math.sin(seconds / layer.breatheS * 2f * Math.PI.toFloat()))
    }
}
