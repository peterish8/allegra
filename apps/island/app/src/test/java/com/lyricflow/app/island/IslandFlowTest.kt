package com.lyricflow.app.island

import android.graphics.Color
import android.app.Application
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.math.abs

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class, sdk = [28])
class IslandFlowTest {
    private val colors = intArrayOf(Color.rgb(60, 10, 30), Color.rgb(214, 110, 36), Color.rgb(196, 48, 104), Color.rgb(240, 170, 150))

    private fun render(flow: IslandFlow, t: Float) = flow.render(t, colors[0], colors[1], colors[2], colors[3])

    @Test
    fun `the field is one smooth liquid, with no edge anywhere`() {
        val flow = IslandFlow()
        for (t in listOf(0f, 7.3f, 41f)) {
            render(flow, t)
            val px = flow.pixels
            for (y in 0 until IslandFlow.H) for (x in 0 until IslandFlow.W) {
                val c = px[y * IslandFlow.W + x]
                if (x > 0) assertTrue("step across at $x,$y", step(c, px[y * IslandFlow.W + x - 1]) < 28)
                if (y > 0) assertTrue("step down at $x,$y", step(c, px[(y - 1) * IslandFlow.W + x]) < 28)
            }
        }
    }

    @Test
    fun `every pixel is the song's colours, never a gap of black`() {
        val flow = IslandFlow()
        render(flow, 12f)
        val darkest = colors.minOf { Color.red(it) + Color.green(it) + Color.blue(it) }
        for (c in flow.pixels) {
            assertTrue(Color.red(c) + Color.green(c) + Color.blue(c) >= darkest * 0.7f)
        }
    }

    @Test
    fun `a paused clock costs nothing and holds the light still`() {
        val flow = IslandFlow()
        assertTrue(render(flow, 3f))
        val before = flow.pixels.copyOf()
        assertFalse("nothing changed: nothing recomputed", render(flow, 3f))
        assertArrayEquals(before, flow.pixels)
        assertTrue(render(flow, 3f + 1f / 30f))
        var moved = 0
        for (i in before.indices) if (before[i] != flow.pixels[i]) moved++
        assertTrue("a frame later it has flowed on a little", moved > 0)
    }

    private fun step(a: Int, b: Int) = maxOf(
        abs(Color.red(a) - Color.red(b)), abs(Color.green(a) - Color.green(b)), abs(Color.blue(a) - Color.blue(b)),
    )
}
