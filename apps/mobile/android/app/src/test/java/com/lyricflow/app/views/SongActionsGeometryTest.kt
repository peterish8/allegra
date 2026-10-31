package com.lyricflow.app.views

import com.lyricflow.app.views.SongActionsGeometry.Button
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SongActionsGeometryTest {
    @Test fun `the like button is always there, the others when given`() {
        assertEquals(listOf(Button.LIKE), SongActionsGeometry.shown(false, false))
        assertEquals(listOf(Button.MORE, Button.LIKE), SongActionsGeometry.shown(false, true))
        assertEquals(listOf(Button.FULLSCREEN, Button.LIKE), SongActionsGeometry.shown(true, false))
        assertEquals(listOf(Button.FULLSCREEN, Button.MORE, Button.LIKE), SongActionsGeometry.shown(true, true))
    }

    @Test fun `the cluster is 38 wide buttons with a 10 gap`() {
        assertEquals(0f, SongActionsGeometry.clusterWidth(0), 0f)
        assertEquals(38f, SongActionsGeometry.clusterWidth(1), 0f)
        assertEquals(86f, SongActionsGeometry.clusterWidth(2), 0f)
        assertEquals(134f, SongActionsGeometry.clusterWidth(3), 0f)
        assertEquals(48f, SongActionsGeometry.left(1), 0f)
        assertEquals(96f, SongActionsGeometry.left(2), 0f)
    }

    @Test fun `a touch lands on the button under it, slop included`() {
        assertEquals(0, SongActionsGeometry.hit(19f, 19f, 3, 8f))
        assertEquals(1, SongActionsGeometry.hit(60f, 19f, 3, 8f))
        assertEquals(2, SongActionsGeometry.hit(110f, 19f, 3, 8f))
        // 8 dp of slop above and to the right of the last one.
        assertEquals(2, SongActionsGeometry.hit(96f + 38f + 7f, -7f, 3, 8f))
        assertNull(SongActionsGeometry.hit(96f + 38f + 9f, 19f, 3, 8f))
        assertNull(SongActionsGeometry.hit(19f, 38f + 9f, 3, 8f))
    }

    @Test fun `where two slops overlap the later button wins`() {
        // Buttons 0 and 1 are 10 dp apart (38..48); with 8 dp slop each reaches 6 dp into the other's neighbourhood.
        assertEquals(1, SongActionsGeometry.hit(41f, 19f, 3, 8f))
        assertEquals(0, SongActionsGeometry.hit(37f, 19f, 3, 8f))
    }

    @Test fun `a press stays alive around its own button`() {
        assertTrue(SongActionsGeometry.within(1, 48f + 19f, 38f + 8f + 29f, 8f))
        assertFalse(SongActionsGeometry.within(1, 48f + 19f, 38f + 8f + 31f, 8f))
        assertTrue(SongActionsGeometry.within(1, 48f - 8f - 19f, 19f, 8f))
        assertFalse(SongActionsGeometry.within(1, 48f - 8f - 21f, 19f, 8f))
        // Sliding over the neighbour keeps the press on the button that was pressed.
        assertTrue(SongActionsGeometry.within(0, 40f, 19f, 8f))
    }

    @Test fun `the like glyph morphs between outline and filled`() {
        val off = SongActionsGeometry.morph(0f)
        assertEquals(0f, off.onAlpha, 0f)
        assertEquals(1f, off.offAlpha, 0f)
        assertEquals(-45f, off.onRotate, 0f)
        assertEquals(0.6f, off.onScale, 1e-6f)
        val on = SongActionsGeometry.morph(1f)
        assertEquals(1f, on.onAlpha, 0f)
        assertEquals(0f, on.offAlpha, 0f)
        assertEquals(0f, on.onRotate, 0f)
        assertEquals(45f, on.offRotate, 0f)
        assertEquals(0.6f, on.offScale, 1e-6f)
        // A spring overshoot never gives a negative or over-full opacity.
        assertEquals(1f, SongActionsGeometry.morph(1.2f).onAlpha, 0f)
        assertEquals(0f, SongActionsGeometry.morph(1.2f).offAlpha, 0f)
    }
}
