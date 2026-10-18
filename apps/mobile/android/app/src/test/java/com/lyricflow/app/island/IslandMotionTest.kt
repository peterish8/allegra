package com.lyricflow.app.island

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class IslandMotionTest {
    private val density = 2.625f

    @Test
    fun `a title that fits never moves`() {
        assertEquals(0f, IslandMotion.marqueeOffset(10f, 100f, 200f, density), 0f)
        assertEquals(-1f, IslandMotion.marqueeWait(10f, 100f, 200f, density), 0f)
    }

    @Test
    fun `a long title rests, glides right to left by one loop, then rests four seconds`() {
        val text = 600f
        val room = 300f
        val distance = IslandMotion.marqueeDistance(text, density)
        val loop = distance / (IslandMotion.MARQUEE_SPEED_DP * density) + IslandMotion.MARQUEE_RAMP_S
        val start = IslandMotion.MARQUEE_START_S
        assertEquals("rests at first", 0f, IslandMotion.marqueeOffset(1f, text, room, density), 0f)
        assertEquals("halfway through the loop", distance / 2f, IslandMotion.marqueeOffset(start + loop / 2f, text, room, density), 1f)
        assertEquals("rests after the loop", 0f, IslandMotion.marqueeOffset(start + loop + 1f, text, room, density), 0f)
        assertEquals("for four seconds", 3f, IslandMotion.marqueeWait(start + loop + 1f, text, room, density), 0.001f)
        assertEquals(0f, IslandMotion.marqueeWait(start + 0.5f, text, room, density), 0f)
    }

    @Test
    fun `a loop eases in and out instead of jerking`() {
        val text = 600f
        val start = IslandMotion.MARQUEE_START_S
        val distance = IslandMotion.marqueeDistance(text, density)
        val loop = distance / (IslandMotion.MARQUEE_SPEED_DP * density) + IslandMotion.MARQUEE_RAMP_S
        val step = 1f / 60f
        val full = IslandMotion.MARQUEE_SPEED_DP * density * step
        var t = start
        var last = 0f
        var lastStep = 0f
        var peak = 0f
        while (t < start + loop - step) {
            t += step
            val now = IslandMotion.marqueeOffset(t, text, 300f, density)
            val moved = now - last
            if (now > 0f) {
                assertTrue("never faster than its pace", moved <= full + 0.01f)
                assertTrue("speeds change gently", abs(moved - lastStep) <= full * step / IslandMotion.MARQUEE_RAMP_S + 0.05f)
                lastStep = moved
            }
            peak = maxOf(peak, now)
            last = now
        }
        assertEquals("lands on the next copy", distance, peak, 0.5f)
    }

    @Test
    fun `paused mid-loop, a title goes home the nearer way`() {
        assertEquals(0f, IslandMotion.marqueeHome(100f, 500f), 0f)
        assertEquals(500f, IslandMotion.marqueeHome(300f, 500f), 0f)
    }
}
