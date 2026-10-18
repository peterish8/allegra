package com.lyricflow.app.island

import android.graphics.Bitmap
import android.graphics.Color
import kotlin.math.max
import kotlin.math.min

/**
 * The light behind the open island, made from the song's own cover, as Apple Music makes its moving backdrop: the
 * cover shrunk to a few pixels, blurred until no shape is left, its colours lifted, then drawn many times larger
 * in slowly turning layers (IslandView.drawGlow). Scaled up that far with filtering, a tiny blurred image is one
 * smooth field of the cover's colours: no circles, no edges, nothing that reads as a gradient someone drew.
 *
 * Built once per cover, off the main thread (IslandArt), and for covers that are missing from the cover's colours.
 */
object IslandGlow {
    /** Pixels a side: small enough that the upscale is all soft light, big enough to keep the cover's colour layout. */
    const val SIZE = 24
    private const val MAX_PEAK = 0.66f

    /** The cover as light. */
    fun fromCover(cover: Bitmap): Bitmap {
        val small = Bitmap.createScaledBitmap(cover, SIZE, SIZE, true)
        val px = IntArray(SIZE * SIZE)
        small.getPixels(px, 0, SIZE, 0, 0, SIZE, SIZE)
        if (small !== cover) small.recycle()
        repeat(3) { blur(px, SIZE, SIZE, 3) }
        for (i in px.indices) px[i] = lift(px[i])
        return Bitmap.createBitmap(px, SIZE, SIZE, Bitmap.Config.ARGB_8888)
    }

    /** No cover: the same kind of field from the colours alone (a song with no artwork still glows its own way). */
    fun fromColors(colors: IslandColors): Bitmap {
        val px = IntArray(SIZE * SIZE)
        val corners = intArrayOf(colors.bottom, colors.second, colors.second, colors.bottom)
        for (y in 0 until SIZE) for (x in 0 until SIZE) {
            val fx = x / (SIZE - 1f)
            val fy = y / (SIZE - 1f)
            px[y * SIZE + x] = mix(mix(corners[0], corners[1], fx), mix(corners[2], corners[3], fx), fy)
        }
        repeat(2) { blur(px, SIZE, SIZE, 3) }
        return Bitmap.createBitmap(px, SIZE, SIZE, Bitmap.Config.ARGB_8888)
    }

    /** A box blur of [r] across rows then columns, edges clamped. Three passes approach a gaussian. */
    fun blur(px: IntArray, w: Int, h: Int, r: Int) {
        val out = IntArray(px.size)
        for (pass in 0..1) {
            val src = if (pass == 0) px else out
            val dst = if (pass == 0) out else px
            for (j in 0 until (if (pass == 0) h else w)) {
                for (i in 0 until (if (pass == 0) w else h)) {
                    var a = 0; var red = 0; var gr = 0; var bl = 0
                    for (k in -r..r) {
                        val ii = (i + k).coerceIn(0, (if (pass == 0) w else h) - 1)
                        val c = if (pass == 0) src[j * w + ii] else src[ii * w + j]
                        a += c ushr 24; red += (c shr 16) and 0xff; gr += (c shr 8) and 0xff; bl += c and 0xff
                    }
                    val n = 2 * r + 1
                    val v = ((a / n) shl 24) or ((red / n) shl 16) or ((gr / n) shl 8) or (bl / n)
                    if (pass == 0) dst[j * w + i] = v else dst[i * w + j] = v
                }
            }
        }
    }

    /**
     * Colours made to glow: saturation raised and brightness held in a middle band, so a pale cover still gives
     * colour and a dark one still gives light, and white text stays readable over it.
     */
    fun lift(color: Int): Int {
        val r = Color.red(color) / 255f
        val g = Color.green(color) / 255f
        val b = Color.blue(color) / 255f
        val mx = max(r, max(g, b))
        val mn = min(r, min(g, b))
        val l = (mx + mn) / 2f
        // Push each channel away from the grey of the same lightness (saturation × 1.45), then settle the lightness.
        fun sat(c: Float) = (l + (c - l) * 1.45f).coerceIn(0f, 1f)
        var rr = sat(r); var gg = sat(g); var bb = sat(b)
        val lightness = (max(rr, max(gg, bb)) + min(rr, min(gg, bb))) / 2f
        val target = lightness.coerceIn(0.22f, 0.42f)
        val k = if (lightness > 0.001f) target / lightness else 1f
        rr = (rr * k).coerceIn(0f, 1f); gg = (gg * k).coerceIn(0f, 1f); bb = (bb * k).coerceIn(0f, 1f)
        // And no channel past a deep glow: a neon cover gives rich colour, never a bright sheet behind the text.
        val peak = max(rr, max(gg, bb))
        if (peak > MAX_PEAK) {
            val d = MAX_PEAK / peak
            rr *= d; gg *= d; bb *= d
        }
        return Color.rgb((rr * 255).toInt(), (gg * 255).toInt(), (bb * 255).toInt())
    }

    private fun mix(a: Int, b: Int, t: Float): Int = Color.rgb(
        (Color.red(a) + (Color.red(b) - Color.red(a)) * t).toInt(),
        (Color.green(a) + (Color.green(b) - Color.green(a)) * t).toInt(),
        (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t).toInt(),
    )
}
