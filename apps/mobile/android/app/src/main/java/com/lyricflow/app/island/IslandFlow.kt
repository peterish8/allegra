package com.lyricflow.app.island

import android.graphics.Color
import kotlin.math.exp
import kotlin.math.sin

/**
 * The light behind the open island: a flowing mesh of the song's colours, the way a fluid shader moves. Four
 * colours sit at points that wander on their own slow paths; the space between them is bent by slowly turning
 * waves (a domain warp); every pixel takes all four in proportion to how near it is (weights that always add up to
 * one), so the field is one continuous liquid: no circles, no edges, no gaps of black between colours.
 *
 * Android 12 phones cannot run an app's own GPU shader, so the field is computed here at [W]×[H] pixels and drawn
 * many times larger with filtering (IslandView.drawFlow), which is all smooth light. A frame costs a few thousand
 * pixels of arithmetic and allocates nothing; it is only recomputed while the clock moves (music playing).
 */
class IslandFlow {
    /** The field's pixels, ARGB, row by row: what IslandView copies into its bitmap. */
    val pixels = IntArray(W * H)
    private val r = FloatArray(4)
    private val g = FloatArray(4)
    private val b = FloatArray(4)
    private val cx = FloatArray(4)
    private val cy = FloatArray(4)
    private var lastT = Float.NaN
    private var lastColors = IntArray(4)

    /**
     * Fills [pixels] for clock [t] (seconds, running only while music plays) and the four colours. Returns false,
     * doing nothing, when neither changed since the last call.
     */
    fun render(t: Float, c0: Int, c1: Int, c2: Int, c3: Int): Boolean {
        if (t == lastT && c0 == lastColors[0] && c1 == lastColors[1] && c2 == lastColors[2] && c3 == lastColors[3]) return false
        lastT = t
        lastColors[0] = c0; lastColors[1] = c1; lastColors[2] = c2; lastColors[3] = c3
        for (i in 0 until 4) {
            val c = lastColors[i]
            r[i] = Color.red(c).toFloat(); g[i] = Color.green(c).toFloat(); b[i] = Color.blue(c).toFloat()
            // Each colour's home wanders on a slow, never-repeating path (periods share no factor).
            cx[i] = HOME_X[i] + 0.22f * sin(t * SPEED_X[i] + PHASE[i])
            cy[i] = HOME_Y[i] + 0.16f * sin(t * SPEED_Y[i] + PHASE[i] * 1.7f)
        }
        var k = 0
        for (py in 0 until H) {
            val v = py / (H - 1f)
            // The waves that bend the space, along the row (shared by the whole row: cheaper, and smoother).
            val bendX = 0.20f * sin(v * 3.1f + t * 0.47f) + 0.09f * sin(v * 5.7f - t * 0.31f + 1.3f)
            for (px in 0 until W) {
                val u = px / (W - 1f)
                val wx = u + bendX
                val wy = v + 0.18f * sin(u * 2.6f - t * 0.41f + 0.6f) + 0.08f * sin(u * 6.1f + t * 0.27f)
                var sw = 0f; var sr = 0f; var sg = 0f; var sb = 0f
                for (i in 0 until 4) {
                    val dx = wx - cx[i]
                    val dy = (wy - cy[i]) * 1.15f
                    val w = exp(-(dx * dx + dy * dy) * SHARPNESS)
                    sw += w; sr += w * r[i]; sg += w * g[i]; sb += w * b[i]
                }
                // A soft sheen rolls through the colours, so the field has depth and is never flat.
                val sheen = 0.86f + 0.14f * sin(wx * 4.2f + t * 0.52f) * sin(wy * 3.3f - t * 0.37f)
                val n = sheen / (sw + 1e-6f)
                pixels[k++] = (0xff shl 24) or
                    ((sr * n).toInt().coerceIn(0, 255) shl 16) or
                    ((sg * n).toInt().coerceIn(0, 255) shl 8) or
                    (sb * n).toInt().coerceIn(0, 255)
            }
        }
        return true
    }

    companion object {
        const val W = 40
        const val H = 56
        /** How quickly a colour gives way to its neighbours: soft enough that none reads as a shape of its own. */
        private const val SHARPNESS = 5.5f
        private val HOME_X = floatArrayOf(0.22f, 0.80f, 0.55f, 0.15f)
        private val HOME_Y = floatArrayOf(0.30f, 0.45f, 0.85f, 0.88f)
        private val SPEED_X = floatArrayOf(0.23f, 0.19f, 0.29f, 0.17f)
        private val SPEED_Y = floatArrayOf(0.31f, 0.27f, 0.21f, 0.25f)
        private val PHASE = floatArrayOf(0f, 1.9f, 3.7f, 5.1f)
    }
}
