package com.lyricflow.app.lyrics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LyricsMathTest {
    @Test fun `glide lands on home without overshoot`() {
        var offset = 300f
        var velocity = 0f
        var frames = 0
        var crossed = false
        while (frames < 400) {
            val next = LyricsMath.glideStep(offset, velocity, 1f / 60f)
            offset = next.offset
            velocity = next.velocity
            if (offset < 0f) crossed = true
            frames++
            if (LyricsMath.glideSettled(next)) break
        }
        assertFalse("a critically damped follow never passes home", crossed)
        assertTrue("settles in about a second and a half", frames in 60..150)
    }

    @Test fun `glide keeps the speed it had when a new line arrives mid flight`() {
        val moving = LyricsMath.glideStep(120f, -400f, 1f / 60f)
        val rested = LyricsMath.glideStep(120f, 0f, 1f / 60f)
        assertTrue(moving.offset < rested.offset)
    }

    @Test fun `lines just sung stay brighter than the ones to come`() {
        assertEquals(1f, LyricsMath.restOpacity(5, 5, false, false), 0f)
        assertEquals(0.45f, LyricsMath.restOpacity(5, 5, false, true), 0f)
        assertEquals(0.62f, LyricsMath.restOpacity(4, 5, false, false), 0f)
        assertEquals(0.46f, LyricsMath.restOpacity(3, 5, false, false), 0f)
        assertEquals(0.36f, LyricsMath.restOpacity(0, 5, false, false), 0f)
        assertEquals(0.42f, LyricsMath.restOpacity(6, 5, false, false), 0f)
        assertEquals(0.33f, LyricsMath.restOpacity(7, 5, false, false), 0f)
        assertEquals(0.27f, LyricsMath.restOpacity(40, 5, false, false), 0f)
    }

    @Test fun `reading makes every line easy to read`() {
        assertEquals(0.62f, LyricsMath.restOpacity(0, 5, true, false), 0f)
        assertEquals(1f, LyricsMath.restOpacity(5, 5, true, false), 0f)
        assertEquals(0.62f, LyricsMath.restOpacity(5, 5, true, true), 0f)
    }

    @Test fun `feathered copies all start unlit and end lit`() {
        for (count in 1..3) {
            for (step in 0 until count) {
                assertEquals(0f, LyricsMath.featherAt(0f, step, count), 1e-5f)
                assertEquals(1f, LyricsMath.featherAt(1f, step, count), 1e-5f)
            }
        }
        // The leading copy is ahead of the trailing one mid word.
        assertTrue(LyricsMath.featherAt(0.5f, 0, 3) > LyricsMath.featherAt(0.5f, 2, 3))
        assertEquals(listOf(0.4f, 0.5f, 1f), LyricsMath.featherAlphas(3).toList())
        assertEquals(listOf(0.45f, 1f), LyricsMath.featherAlphas(2).toList())
        assertEquals(listOf(1f), LyricsMath.featherAlphas(1).toList())
    }

    @Test fun `the sung line is centred at its anchor and never past the content`() {
        // A 100px line at 1000: centre 1050, anchor at 35% of an 800px viewport = 280.
        assertEquals(770f, LyricsMath.anchorScrollY(1000f, 100f, 800f, 0.35f, 5000f), 0.001f)
        assertEquals(0f, LyricsMath.anchorScrollY(10f, 40f, 800f, 0.35f, 5000f), 0.001f)
        assertEquals(4200f, LyricsMath.anchorScrollY(4900f, 100f, 800f, 0.35f, 5000f), 0.001f)
        assertEquals(520f, LyricsMath.anchorFooter(800f, 0.35f, 100f), 0.001f)
        assertEquals(600f, LyricsMath.anchorFooter(800f, 0.35f, 600f), 0.001f)
    }

    @Test fun `a line goes live a beat before it is sung`() {
        val at = longArrayOf(1000, 3000, 5000)
        assertEquals(-1, LyricsMath.activeIndex(at, 0))
        assertEquals(0, LyricsMath.activeIndex(at, 700))
        assertEquals(0, LyricsMath.activeIndex(at, 2600))
        assertEquals(1, LyricsMath.activeIndex(at, 2700))
        assertEquals(2, LyricsMath.activeIndex(at, 90_000))
        assertEquals(-1, LyricsMath.activeIndex(longArrayOf(), 5000))
    }

    @Test fun `the sweep follows the segments and holds between words`() {
        val from = floatArrayOf(0f, 6f)
        val to = floatArrayOf(5f, 10f)
        val start = longArrayOf(1000, 3000)
        val end = longArrayOf(2000, 3500)
        assertEquals(0f, LyricsMath.highlightOffset(from, to, start, end, 500), 0f)
        assertEquals(2.5f, LyricsMath.highlightOffset(from, to, start, end, 1500), 0.001f)
        assertEquals(5f, LyricsMath.highlightOffset(from, to, start, end, 2500), 0.001f)
        assertEquals(8f, LyricsMath.highlightOffset(from, to, start, end, 3250), 0.001f)
        assertEquals(10f, LyricsMath.highlightOffset(from, to, start, end, 9000), 0.001f)
    }

    @Test fun `a word is lit by how far the sweep is inside it`() {
        assertEquals(0f, LyricsMath.wordLit(2f, 6, 10), 0f)
        assertEquals(0.5f, LyricsMath.wordLit(8f, 6, 10), 0.001f)
        assertEquals(1f, LyricsMath.wordLit(30f, 6, 10), 0f)
        assertEquals(0f, LyricsMath.wordLit(3f, 4, 4), 0f)
    }

    @Test fun `the pill points at the sung line only when it is far away`() {
        assertEquals(0, LyricsMath.pillDirection(-1f, 500f, 72f))
        assertEquals(0, LyricsMath.pillDirection(540f, 500f, 72f))
        assertEquals(1, LyricsMath.pillDirection(900f, 500f, 72f))
        assertEquals(-1, LyricsMath.pillDirection(100f, 500f, 72f))
    }

    @Test fun `a seek starts the glide at most sixty percent of the height away`() {
        assertEquals(1000f + 480f, LyricsMath.glideStart(1000f, 9000f, 800f), 0.001f)
        assertEquals(1000f - 480f, LyricsMath.glideStart(1000f, -9000f, 800f), 0.001f)
        assertEquals(1100f, LyricsMath.glideStart(1000f, 1100f, 800f), 0.001f)
    }

    @Test fun `the sung line must be fully on screen to re-attach early`() {
        assertTrue(LyricsMath.lineFullyVisible(300f, 100f, 200f, 800f))
        assertFalse(LyricsMath.lineFullyVisible(150f, 100f, 200f, 800f))
        assertFalse(LyricsMath.lineFullyVisible(950f, 100f, 200f, 800f))
    }

    @Test fun `the equalizer rests, dances inside its range and returns to its minimum`() {
        val spec = LyricsMath.EQ_SPECS[2]
        val min = spec.minDp * LyricsMath.EQ_SCALE
        val max = spec.maxDp * LyricsMath.EQ_SCALE
        assertEquals(min, LyricsMath.eqActiveHeight(spec, 0), 0.001f)
        assertEquals(min, LyricsMath.eqActiveHeight(spec, spec.delayMs), 0.001f)
        assertEquals(max, LyricsMath.eqActiveHeight(spec, spec.delayMs + spec.durationMs), 0.01f)
        assertEquals(min, LyricsMath.eqActiveHeight(spec, spec.delayMs + spec.durationMs * 2), 0.01f)
        for (ms in 0L..3000L step 7) {
            val h = LyricsMath.eqActiveHeight(spec, ms)
            assertTrue(h >= min - 0.001f && h <= max + 0.001f)
        }
        assertEquals(8f * 1.15f * 0.45f, LyricsMath.eqRestHeight(LyricsMath.EQ_SPECS[0]), 0.001f)
        assertEquals(16f * 1.15f * 0.45f, LyricsMath.eqRestHeight(spec), 0.001f)
    }
}
