package com.lyricflow.app.playback

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ResumeOnlineTest {
    private val armed = 1_000_000L

    private fun resume(
        now: Long,
        armedAt: Long? = armed,
        wantsToPlay: Boolean = false,
        hasSong: Boolean = true,
        sawLoss: Boolean = true,
        usable: Boolean = true,
    ) = ResumeOnline.shouldResume(armedAt, now, wantsToPlay, hasSong, sawLoss, usable)

    @Test
    fun resumesWhenTheConnectionComesBackInTime() {
        assertTrue(resume(armed + 30_000L))
        assertTrue(resume(armed + ResumeOnline.WINDOW_MS))
    }

    @Test
    fun leavesItAloneWhenNotArmedLateOrAlreadyPlaying() {
        assertFalse(resume(armed, armedAt = null))
        assertFalse(resume(armed + ResumeOnline.WINDOW_MS + 1))
        // The listener pressed play meanwhile: nothing to do.
        assertFalse(resume(armed + 5_000L, wantsToPlay = true))
        assertFalse(resume(armed + 5_000L, hasSong = false))
        // A clock that went backwards never resumes.
        assertFalse(resume(armed - 1))
    }

    @Test
    fun aStreamThatFailedWhileStillOnlineIsNotAConnectionComingBack() {
        // Android reports the network already up as soon as the watch starts: no loss, so no resume.
        assertFalse(resume(armed + 10L, sawLoss = false))
    }

    @Test
    fun onlyAUsableNetworkResumes() {
        // Connected to Wi-Fi with no internet yet (captive portal, not validated): keep waiting.
        assertFalse(resume(armed + 20_000L, usable = false))
        assertTrue(resume(armed + 25_000L, usable = true))
    }

    @Test
    fun anArmedResumeExpiresAfterItsWindow() {
        assertFalse(ResumeOnline.expired(null, armed))
        assertFalse(ResumeOnline.expired(armed, armed + ResumeOnline.WINDOW_MS))
        assertTrue(ResumeOnline.expired(armed, armed + ResumeOnline.WINDOW_MS + 1))
    }
}
