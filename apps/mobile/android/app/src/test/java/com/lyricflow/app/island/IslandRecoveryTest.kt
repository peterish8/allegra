package com.lyricflow.app.island

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IslandRecoveryTest {
    @Test
    fun retriesBackOffAndThenStop() {
        val delays = generateSequence(0) { it + 1 }.map { IslandRecovery.retryDelayMs(it) }.takeWhile { it != null }.map { it!! }.toList()
        assertTrue("retries at least a few times", delays.size >= 5)
        assertEquals(1_000L, delays.first())
        assertTrue("never shrinks", delays.zipWithNext().all { (a, b) -> b >= a })
        // A phone that boots slowly still gets its island back: retries cover a few minutes.
        assertTrue(delays.sum() >= 120_000L)
        assertNull(IslandRecovery.retryDelayMs(delays.size))
        assertNull(IslandRecovery.retryDelayMs(-1))
    }

    @Test
    fun retriesOnlyAWantedIslandThatIsNotUp() {
        assertTrue(IslandRecovery.needsRetry(wanted = true, windowAdded = false))
        assertFalse(IslandRecovery.needsRetry(wanted = true, windowAdded = true))
        assertFalse(IslandRecovery.needsRetry(wanted = false, windowAdded = false))
    }

    @Test
    fun locksAreReadAgainUntilTheKeyguardHasSurelySettled() {
        val checks = IslandRecovery.LOCK_RECHECK_MS
        assertTrue(checks.isNotEmpty())
        assertTrue(checks.toList().zipWithNext().all { (a, b) -> b > a })
        // The last read lands well after a slow keyguard exit animation.
        assertTrue(checks.last() >= 3_000L)
    }
}
