package com.lyricflow.app.island

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IslandGeometryTest {

    @Test
    fun `wide notches put the island below the obstruction instead of covering system icons`() {
        val notch = CameraCutout(230f, 0f, 850f, 100f)
        val g = IslandGeometry.compute(1080f, 100f, 3f, notch, 100f)
        assertFalse(g.attached)
        assertTrue(g.pillTop > notch.bottom)
        assertTrue(g.contentTop > notch.bottom)
        assertTrue(g.compactWidth <= 1080f - 152f * 3f)
    }

    @Test
    fun `card content clears corner cameras and curved screen edges`() {
        val hole = CameraCutout(40f, 20f, 106f, 90f)
        val g = IslandGeometry.compute(1080f, 100f, 2.75f, hole, 100f, 20f, 30f)
        assertTrue(g.contentTop > hole.bottom)
        assertTrue(g.anchorX - g.cardWidth / 2f >= 20f)
        assertTrue(g.anchorX + g.cardWidth / 2f <= 1050f)
    }

    @Test
    fun `positioning scales across phone widths densities and top camera layouts`() {
        for (density in listOf(1f, 1.5f, 2f, 2.625f, 3f, 4f)) {
            for (widthDp in listOf(280f, 320f, 360f, 412f, 600f, 840f)) {
                val width = widthDp * density
                val middle = width / 2f
                for (hole in listOf(null,
                    CameraCutout(middle - 12f * density, 6f * density, middle + 12f * density, 30f * density),
                    CameraCutout(middle - 20f * density, 0f, middle + 20f * density, 32f * density),
                    CameraCutout(8f * density, 4f * density, 36f * density, 32f * density),
                    CameraCutout(middle - 90f * density, 0f, middle + 90f * density, 36f * density))) {
                    val g = IslandGeometry.compute(width, 36f * density, density, hole)
                    assertTrue(g.pillTop >= 0f)
                    assertTrue(g.idleWidth > 0f && g.compactWidth >= g.idleWidth)
                    assertTrue(g.anchorX - g.compactWidth / 2f >= 0f)
                    assertTrue(g.anchorX + g.compactWidth / 2f <= width)
                    assertTrue(g.anchorX - g.cardWidth / 2f >= 8f * density - 0.01f)
                    assertTrue(g.anchorX + g.cardWidth / 2f <= width - 8f * density + 0.01f)
                    if (hole != null) assertTrue(g.contentTop > hole.bottom)
                }
            }
        }
    }

    @Test
    fun `a waterdrop notch on the top edge gets an island hanging from the edge round it`() {
        // Galaxy M31: 1080 px wide, density 2.625, a U notch in the middle touching the top.
        val density = 2.625f
        val notch = CameraCutout(486f, 0f, 594f, 79f)
        val g = IslandGeometry.compute(1080f, 79f, density, notch)
        assertTrue(g.attached)
        assertEquals(540f, g.anchorX, 0.01f)
        assertEquals(0f, g.pillTop, 0.01f)
        assertTrue("covers the notch", g.pillHeight >= notch.bottom)
        assertTrue("wider than the notch", g.idleWidth > notch.width)
        assertEquals(0f, g.cardTop, 0.01f)
        assertTrue("content starts below the notch", g.contentTop > notch.bottom)
    }

    @Test
    fun `a punch-hole camera gets a floating pill centred on it`() {
        val density = 2.75f
        val hole = CameraCutout(507f, 24f, 573f, 90f)
        val g = IslandGeometry.compute(1080f, 110f, density, hole)
        assertFalse(g.attached)
        assertEquals(540f, g.anchorX, 0.01f)
        assertTrue("pill top above the hole", g.pillTop <= hole.top)
        assertTrue("pill bottom below the hole", g.pillTop + g.pillHeight >= hole.bottom)
        assertEquals(hole.centerY, g.pillTop + g.pillHeight / 2f, 0.01f)
        assertTrue(g.compactWidth > g.idleWidth)
        assertTrue("content starts below the camera", g.contentTop > hole.bottom)
    }

    @Test
    fun `a camera in a corner leaves the island in the middle`() {
        val g = IslandGeometry.compute(1080f, 100f, 2.75f, CameraCutout(40f, 24f, 106f, 90f))
        assertFalse(g.attached)
        assertEquals(540f, g.anchorX, 0.01f)
        assertEquals(0f, g.cameraWidth, 0.01f)
    }

    @Test
    fun `with no cutout the pill sits inside the status bar`() {
        val statusBar = 72f
        val g = IslandGeometry.compute(1080f, statusBar, 2.75f, null)
        assertEquals(540f, g.anchorX, 0.01f)
        assertTrue(g.pillTop > 0f)
        assertTrue(g.pillTop + g.pillHeight <= statusBar + 0.01f)
    }

    @Test
    fun `the card fits the screen evenly round the anchor`() {
        val density = 2.75f
        // A camera a little right of the middle: the card stays centred on it and on screen.
        val g = IslandGeometry.compute(1080f, 110f, density, CameraCutout(560f, 24f, 626f, 90f))
        assertEquals(593f, g.anchorX, 0.01f)
        assertTrue(g.anchorX - g.cardWidth / 2f >= 8f * density - 0.01f)
        assertTrue(g.anchorX + g.cardWidth / 2f <= 1080f - 8f * density + 0.01f)
    }

    @Test
    fun `the compact pill leaves room for the clock and the status icons`() {
        val density = 2f
        val g = IslandGeometry.compute(720f, 48f, density, CameraCutout(340f, 10f, 380f, 50f))
        assertTrue(g.compactWidth <= 720f - 2 * 76f * density + 0.01f)
        assertTrue(g.compactWidth >= g.idleWidth)
    }

    @Test
    fun `a wide tablet card stops at 440 dp`() {
        val g = IslandGeometry.compute(2560f, 60f, 2f, null)
        assertEquals(880f, g.cardWidth, 0.01f)
    }

    @Test
    fun `the clock reads like a player's`() {
        assertEquals("0:00", islandClock(0))
        assertEquals("2:35", islandClock(155_400))
        assertEquals("-2:02", islandClock(122_000, remaining = true))
        assertEquals("1:02:03", islandClock(3_723_000))
        assertEquals("0:00", islandClock(-5))
    }
}
