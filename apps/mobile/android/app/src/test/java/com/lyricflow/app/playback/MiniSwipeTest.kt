package com.lyricflow.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as src/playback/miniSwipe.test.ts: the main-thread swipe must agree with the JavaScript rule. */
class MiniSwipeTest {
    private val width = 300f

    @Test
    fun `a long slow drag left plays the next song and right the previous one`() {
        assertEquals(MiniSwipe.NEXT, MiniSwipe.decide(-80f, 4f, -100f, width))
        assertEquals(MiniSwipe.PREVIOUS, MiniSwipe.decide(80f, 4f, 100f, width))
    }

    @Test
    fun `a short slow drag does nothing`() {
        assertEquals(MiniSwipe.NONE, MiniSwipe.decide(-30f, 2f, -100f, width))
    }

    @Test
    fun `a flick commits sooner but only the same way`() {
        assertEquals(MiniSwipe.NEXT, MiniSwipe.decide(-30f, 2f, -1200f, width))
        assertEquals(MiniSwipe.NONE, MiniSwipe.decide(-30f, 2f, 1200f, width))
        assertEquals(MiniSwipe.NONE, MiniSwipe.decide(-10f, 1f, -1200f, width))
    }

    @Test
    fun `a mostly vertical drag never skips`() {
        assertEquals(MiniSwipe.NONE, MiniSwipe.decide(-90f, 120f, -2000f, width))
        assertEquals(MiniSwipe.NONE, MiniSwipe.decide(-60f, 60f, -2000f, width))
    }

    @Test
    fun `a wide bar needs a longer slow drag`() {
        val wide = 600f
        assertEquals(132f, MiniSwipe.threshold(wide), 0.001f)
        assertEquals(MiniSwipe.NONE, MiniSwipe.decide(-100f, 2f, -100f, wide))
        assertEquals(MiniSwipe.NEXT, MiniSwipe.decide(-140f, 2f, -100f, wide))
    }

    @Test
    fun `right to left layouts swap the directions`() {
        assertEquals(MiniSwipe.PREVIOUS, MiniSwipe.decide(-80f, 4f, -100f, width, rtl = true))
        assertEquals(MiniSwipe.NEXT, MiniSwipe.decide(80f, 4f, 100f, width, rtl = true))
    }

    @Test
    fun `bad numbers decide nothing`() {
        assertEquals(MiniSwipe.NONE, MiniSwipe.decide(Float.NaN, 0f, 0f, width))
        assertEquals(MiniSwipe.NONE, MiniSwipe.decide(-80f, Float.POSITIVE_INFINITY, 0f, width))
    }

    @Test
    fun `the content follows half the finger and stops at the limit`() {
        assertEquals(-20f, MiniSwipe.follow(-40f), 0.001f)
        assertEquals(MiniSwipe.FOLLOW_MAX, MiniSwipe.follow(500f), 0.001f)
        assertEquals(-MiniSwipe.FOLLOW_MAX, MiniSwipe.follow(-500f), 0.001f)
    }

    @Test
    fun `the content dims by at most half`() {
        assertEquals(1f, MiniSwipe.fade(0f), 0.001f)
        assertEquals(0.5f, MiniSwipe.fade(900f), 0.001f)
    }

    @Test
    fun `a drag starts past the slop and only when more across than down`() {
        assertFalse(MiniSwipe.isDrag(10f, 0f))
        assertTrue(MiniSwipe.isDrag(18f, 4f))
        assertFalse(MiniSwipe.isDrag(18f, 30f))
    }
}
