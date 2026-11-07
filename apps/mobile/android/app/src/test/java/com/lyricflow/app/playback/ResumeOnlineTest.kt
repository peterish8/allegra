package com.lyricflow.app.playback

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ResumeOnlineTest {
    private val armed = 1_000_000L

    @Test
    fun resumesWhenTheConnectionComesBackInTime() {
        assertTrue(ResumeOnline.shouldResume(armed, armed + 30_000L, wantsToPlay = false, hasSong = true))
        assertTrue(ResumeOnline.shouldResume(armed, armed + ResumeOnline.WINDOW_MS, wantsToPlay = false, hasSong = true))
    }

    @Test
    fun leavesItAloneWhenNotArmedLateOrAlreadyPlaying() {
        assertFalse(ResumeOnline.shouldResume(null, armed, wantsToPlay = false, hasSong = true))
        assertFalse(ResumeOnline.shouldResume(armed, armed + ResumeOnline.WINDOW_MS + 1, wantsToPlay = false, hasSong = true))
        // The listener pressed play meanwhile: nothing to do.
        assertFalse(ResumeOnline.shouldResume(armed, armed + 5_000L, wantsToPlay = true, hasSong = true))
        assertFalse(ResumeOnline.shouldResume(armed, armed + 5_000L, wantsToPlay = false, hasSong = false))
        // A clock that went backwards never resumes.
        assertFalse(ResumeOnline.shouldResume(armed, armed - 1, wantsToPlay = false, hasSong = true))
    }

    @Test
    fun anArmedResumeExpiresAfterItsWindow() {
        assertFalse(ResumeOnline.expired(null, armed))
        assertFalse(ResumeOnline.expired(armed, armed + ResumeOnline.WINDOW_MS))
        assertTrue(ResumeOnline.expired(armed, armed + ResumeOnline.WINDOW_MS + 1))
    }
}
