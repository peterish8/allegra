package com.lyricflow.app.playback

import com.lyricflow.app.playback.CutoffGuard.Verdict
import org.junit.Assert.assertEquals
import org.junit.Test

class CutoffGuardTest {

    @Test
    fun `a stream cut mid-song resumes where it stopped`() {
        assertEquals(Verdict.Resume(120_500, 1), CutoffGuard().judge("a", 120_500, 245_000, 245))
    }

    @Test
    fun `an end within three seconds of the container length is genuine`() {
        assertEquals(Verdict.Accept, CutoffGuard().judge("a", 243_100, 245_000, 245))
    }

    @Test
    fun `an unknown container length falls back to the catalog length in seconds`() {
        assertEquals(Verdict.Resume(120_500, 1), CutoffGuard().judge("a", 120_500, -1, 245))
    }

    @Test
    fun `no length anywhere is accepted as today`() {
        assertEquals(Verdict.Accept, CutoffGuard().judge("a", 120_500, -1, 0))
    }

    @Test
    fun `a third cut of the same track is accepted, never a loop`() {
        val guard = CutoffGuard()
        assertEquals(Verdict.Resume(100_000, 1), guard.judge("a", 100_000, 245_000, 245))
        assertEquals(Verdict.Resume(150_000, 2), guard.judge("a", 150_000, 245_000, 245))
        assertEquals(Verdict.Accept, guard.judge("a", 180_000, 245_000, 245))
    }

    @Test
    fun `a radio edit shorter than the catalog trusts the container`() {
        assertEquals(Verdict.Accept, CutoffGuard().judge("a", 199_000, 200_000, 245))
    }

    @Test
    fun `the counter resets on a new track and is kept for the same id`() {
        val guard = CutoffGuard()
        guard.judge("a", 100_000, 245_000, 245)
        guard.judge("a", 150_000, 245_000, 245)
        guard.onTrack("a")
        assertEquals(Verdict.Accept, guard.judge("a", 170_000, 245_000, 245))
        guard.onTrack("b")
        assertEquals(Verdict.Resume(50_000, 1), guard.judge("b", 50_000, 245_000, 245))
    }

    @Test
    fun `a position under one second is a load failure, not a cut`() {
        assertEquals(Verdict.Accept, CutoffGuard().judge("a", 400, 245_000, 245))
    }
}
