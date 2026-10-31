package com.lyricflow.app.scrubber

import com.lyricflow.app.scrubber.ScrubberMath.Move
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScrubberMathTest {
    @Test fun `a touch maps to a fraction clamped to the track`() {
        assertEquals(0.25f, ScrubberMath.fractionAt(50f, 200f), 0f)
        assertEquals(0f, ScrubberMath.fractionAt(-30f, 200f), 0f)
        assertEquals(1f, ScrubberMath.fractionAt(260f, 200f), 0f)
        assertEquals(0f, ScrubberMath.fractionAt(50f, 0f), 0f)
    }

    @Test fun `progress is zero until the length is known and never past the end`() {
        assertEquals(0f, ScrubberMath.progress(30.0, 0.0), 0f)
        assertEquals(0.5f, ScrubberMath.progress(30.0, 60.0), 0f)
        assertEquals(1f, ScrubberMath.progress(75.0, 60.0), 0f)
        assertEquals(0f, ScrubberMath.progress(-3.0, 60.0), 0f)
    }

    @Test fun `the finger's value is shown until the seek lands`() {
        assertEquals(0.8f, ScrubberMath.display(true, false, 0.8f, 0.1f), 0f)
        assertEquals(0.8f, ScrubberMath.display(false, true, 0.8f, 0.1f), 0f)
        assertEquals(0.1f, ScrubberMath.display(false, false, 0.8f, 0.1f), 0f)
    }

    @Test fun `the swell and the brightening follow the grow value`() {
        assertEquals(1f, ScrubberMath.trackScale(0f), 1e-6f)
        assertEquals(1.6f, ScrubberMath.trackScale(1f), 1e-6f)
        assertEquals(0.78f, ScrubberMath.fillAlpha(0f), 1e-6f)
        assertEquals(1f, ScrubberMath.fillAlpha(1f), 1e-6f)
    }

    @Test fun `time labels read like formatTimeSV`() {
        assertEquals("0:00", ScrubberMath.formatTime(0.0))
        assertEquals("0:09", ScrubberMath.formatTime(9.9))
        assertEquals("1:05", ScrubberMath.formatTime(65.0))
        assertEquals("12:00", ScrubberMath.formatTime(720.0))
        assertEquals("0:00", ScrubberMath.formatTime(-4.0))
        assertEquals("0:00", ScrubberMath.formatTime(Double.NaN))
        assertEquals("0:00", ScrubberMath.formatTime(Double.POSITIVE_INFINITY))
    }

    @Test fun `the volume slider sets the stream the way the module does`() {
        assertEquals(0, ScrubberMath.volumeIndex(0f, 15))
        assertEquals(7, ScrubberMath.volumeIndex(0.5f, 15))
        assertEquals(14, ScrubberMath.volumeIndex(0.99f, 15))
        assertEquals(15, ScrubberMath.volumeIndex(1f, 15))
        assertEquals(15, ScrubberMath.volumeIndex(3f, 15))
        assertEquals(0, ScrubberMath.volumeIndex(-1f, 15))
        assertEquals(0, ScrubberMath.volumeIndex(0.5f, 0))
        assertEquals(0.4f, ScrubberMath.volumeFraction(6, 15), 1e-6f)
        assertEquals(0f, ScrubberMath.volumeFraction(6, 0), 0f)
        assertEquals(1f, ScrubberMath.volumeFraction(20, 15), 0f)
    }

    @Test fun `a sideways drag is the scrubber's, a vertical one is the player's`() {
        assertEquals(Move.WAIT, ScrubberMath.classify(2f, 3f, 4f, 14f))
        assertEquals(Move.CLAIM, ScrubberMath.classify(6f, 3f, 4f, 14f))
        assertEquals(Move.CLAIM, ScrubberMath.classify(-9f, 10f, 4f, 14f))
        assertEquals(Move.YIELD, ScrubberMath.classify(1f, 20f, 4f, 14f))
        assertEquals(Move.YIELD, ScrubberMath.classify(1f, -20f, 4f, 14f))
        // Both at once: vertical wins, so the player can still be closed.
        assertEquals(Move.YIELD, ScrubberMath.classify(30f, 20f, 4f, 14f))
    }

    @Test fun `a tap is short and did not travel`() {
        assertTrue(ScrubberMath.isTap(120L, 2f, 8f))
        assertFalse(ScrubberMath.isTap(700L, 2f, 8f))
        assertFalse(ScrubberMath.isTap(120L, 12f, 8f))
    }

    @Test fun `the slider follows the song again once the player is near the chosen place`() {
        assertTrue(ScrubberMath.settled(100.4, 100.0))
        assertTrue(ScrubberMath.settled(99.2, 100.0))
        assertFalse(ScrubberMath.settled(30.0, 100.0))
    }
}
