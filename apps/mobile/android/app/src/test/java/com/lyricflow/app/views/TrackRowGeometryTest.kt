package com.lyricflow.app.views

import com.lyricflow.app.views.TrackRowGeometry as G
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackRowGeometryTest {
    private val w = 360f

    @Test fun `the cover and the text sit where the React Native row puts them`() {
        // 20 side padding, a 48 cover centred in 64, a 12 gap.
        assertEquals(8f, G.artTop(), 0f)
        assertEquals(80f, G.textLeft(), 0f)
        assertEquals(340f, G.textRight(w, false), 0f)
        // With the trailing button: 44 wide and a 12 gap before it.
        assertEquals(284f, G.textRight(w, true), 0f)
        assertEquals(296f, G.trailLeft(w), 0f)
        assertEquals(10f, G.trailTop(), 0f)
    }

    @Test fun `the playing disc hangs 4 dp off the cover's corner`() {
        assertEquals(62f, G.dotCenterX(), 0f)
        assertEquals(50f, G.dotCenterY(), 0f)
    }

    @Test fun `the text block is centred, with the progress line when there is one`() {
        // 19 + 2 + 16 = 37 high, so 13.5 from the top.
        assertEquals(37f, G.blockHeight(19f, 16f, false), 0f)
        assertEquals(13.5f, G.blockTop(37f), 0f)
        assertEquals(45f, G.blockHeight(19f, 16f, true), 0f)
        assertEquals(9.5f, G.blockTop(45f), 0f)
    }

    @Test fun `the progress fill never reads empty or passes the track`() {
        assertEquals(0.02f, G.progressFill(0f), 0f)
        assertEquals(0.5f, G.progressFill(0.5f), 0f)
        assertEquals(1f, G.progressFill(3f), 0f)
    }

    @Test fun `the trailing button takes its 10 dp slop`() {
        assertTrue(G.onTrailing(300f, 32f, w))
        assertTrue(G.onTrailing(296f - 10f, 32f, w))
        assertFalse(G.onTrailing(296f - 11f, 32f, w))
        assertTrue(G.onTrailing(340f + 10f, 0f, w))
        assertFalse(G.onTrailing(100f, 32f, w))
    }

    @Test fun `a press on the row stays alive within 20 dp, 30 below`() {
        assertTrue(G.rowAlive(-20f, 32f, w))
        assertFalse(G.rowAlive(-21f, 32f, w))
        assertTrue(G.rowAlive(180f, -20f, w))
        assertFalse(G.rowAlive(180f, -21f, w))
        assertTrue(G.rowAlive(180f, 94f, w))
        assertFalse(G.rowAlive(180f, 95f, w))
    }

    @Test fun `a press on the trailing button keeps its slop and retention`() {
        assertTrue(G.trailingAlive(296f - 30f, 32f, w))
        assertFalse(G.trailingAlive(296f - 31f, 32f, w))
        assertTrue(G.trailingAlive(340f + 30f, 32f, w))
        assertFalse(G.trailingAlive(340f + 31f, 32f, w))
    }

    @Test fun `the row keeps 64 dp only while the text fits the cover`() {
        assertTrue(G.fitsAtFontScale(1f, false))
        assertTrue(G.fitsAtFontScale(1.3f, false))
        assertFalse(G.fitsAtFontScale(1.5f, false))
        assertTrue(G.fitsAtFontScale(1f, true))
        assertFalse(G.fitsAtFontScale(1.15f, true))
    }
}
