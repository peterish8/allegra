package com.lyricflow.app.startup

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FrameWatchTest {
    @Test
    fun `a window counts against the phone when more than one frame in ten ran over 18 ms`() {
        assertTrue(FrameWatch.badWindow(frames = 600, slowFrames = 61))
        assertFalse(FrameWatch.badWindow(frames = 600, slowFrames = 60))
    }

    @Test
    fun `a quiet window, with too few frames to mean anything moved, never counts`() {
        assertFalse(FrameWatch.badWindow(frames = 100, slowFrames = 100))
    }
}
