package com.lyricflow.app.views

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MoreMenuGeometryTest {
    private val w = 272f
    private val hair = 0.5f

    @Test fun `three tiles share the width with 8 dp gaps`() {
        assertEquals(85.333f, MoreMenuGeometry.tileWidth(w), 0.001f)
        assertEquals(0f, MoreMenuGeometry.tileLeft(0, w), 0f)
        assertEquals(93.333f, MoreMenuGeometry.tileLeft(1, w), 0.001f)
        // The last tile ends at the right edge.
        assertEquals(w, MoreMenuGeometry.tileLeft(2, w) + MoreMenuGeometry.tileWidth(w), 0.001f)
    }

    @Test fun `the rows sit 8 dp under the tiles and the content height follows`() {
        assertEquals(86f, MoreMenuGeometry.rowTop(0, hair), 0f)
        assertEquals(144.5f, MoreMenuGeometry.rowTop(1, hair), 0f)
        assertEquals(78f, MoreMenuGeometry.contentHeight(0, hair), 0f)
        assertEquals(144f, MoreMenuGeometry.contentHeight(1, hair), 0f)
        assertEquals(202.5f, MoreMenuGeometry.contentHeight(2, hair), 0f)
    }

    @Test fun `items stagger 30 ms apart after 50`() {
        assertEquals(50L, MoreMenuGeometry.delayMs(0))
        assertEquals(80L, MoreMenuGeometry.delayMs(1))
        assertEquals(140L, MoreMenuGeometry.delayMs(3))
    }

    @Test fun `a touch lands on the tile or row under it`() {
        assertEquals(0, MoreMenuGeometry.hit(40f, 40f, 4, w, hair))
        assertEquals(1, MoreMenuGeometry.hit(130f, 40f, 4, w, hair))
        assertEquals(2, MoreMenuGeometry.hit(250f, 40f, 4, w, hair))
        assertEquals(3, MoreMenuGeometry.hit(100f, 100f, 4, w, hair))
        // The 8 dp gap between the tiles and the rows, and between tiles, hit nothing.
        assertEquals(-1, MoreMenuGeometry.hit(100f, 82f, 4, w, hair))
        assertEquals(-1, MoreMenuGeometry.hit(89f, 40f, 4, w, hair))
        assertEquals(-1, MoreMenuGeometry.hit(100f, 200f, 4, w, hair))
    }

    @Test fun `a press stays alive 20 dp around its item, 30 below`() {
        assertTrue(MoreMenuGeometry.within(0, -19f, 40f, w, hair))
        assertFalse(MoreMenuGeometry.within(0, -21f, 40f, w, hair))
        assertTrue(MoreMenuGeometry.within(0, 40f, 78f + 29f, w, hair))
        assertFalse(MoreMenuGeometry.within(0, 40f, 78f + 31f, w, hair))
    }

    @Test fun `content is centred as a block`() {
        // Icon box 24.56, label line 15: block 46.56 in 78.
        assertEquals(15.72f, MoreMenuGeometry.tileContentTop(24.56f, 15f), 0.001f)
        // Label 19 + 2 + hint 15 = 36 in 58.
        assertEquals(11f, MoreMenuGeometry.rowTextTop(58f, 19f, 15f, true), 0.001f)
        assertEquals(19.5f, MoreMenuGeometry.rowTextTop(58f, 19f, 15f, false), 0.001f)
    }
}
