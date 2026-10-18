package com.lyricflow.app.island

import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class IslandGlowTest {

    @Test
    fun `the blur leaves no hard edge`() {
        val w = 8
        val px = IntArray(w * w) { i -> if (i % w < w / 2) Color.BLACK else Color.WHITE }
        repeat(3) { IslandGlow.blur(px, w, w, 2) }
        for (y in 0 until w) for (x in 1 until w) {
            val step = abs(Color.red(px[y * w + x]) - Color.red(px[y * w + x - 1]))
            assertTrue("neighbours differ by $step", step < 90)
        }
    }

    @Test
    fun `lifted colours glow but stay dark enough for white text`() {
        for (c in intArrayOf(Color.WHITE, Color.BLACK, Color.rgb(200, 190, 185), Color.rgb(30, 60, 200))) {
            val out = IslandGlow.lift(c)
            val mx = maxOf(Color.red(out), Color.green(out), Color.blue(out)) / 255f
            val mn = minOf(Color.red(out), Color.green(out), Color.blue(out)) / 255f
            val l = (mx + mn) / 2f
            assertTrue("lightness $l for ${Integer.toHexString(c)}", l <= 0.52f)
        }
        assertEquals("black stays black", Color.BLACK, IslandGlow.lift(Color.BLACK))
    }
}
