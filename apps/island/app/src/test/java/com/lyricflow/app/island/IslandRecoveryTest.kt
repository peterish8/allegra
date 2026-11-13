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

    // ── 1.44.0: the island after a restart, and after the screen goes off and on ─────────────────────────────

    /** The service's own bookkeeping, played through the same rules it uses (IslandService.screenReceiver). */
    private class Phone(var wanted: Boolean = true) {
        var added = true
        var healthy = true
        var inUse = false
        private var firstSeen = false
        val done = mutableListOf<IslandRecovery.Action>()

        fun connect() { firstSeen = false }

        fun screenEvent(): IslandRecovery.Action {
            val action = IslandRecovery.onScreenEvent(wanted, added, healthy, inUse, firstSinceConnect = !firstSeen)
            if (IslandRecovery.consumesFirstEvent(action)) firstSeen = true
            if (action == IslandRecovery.Action.REBUILD || action == IslandRecovery.Action.BUILD) { added = true; healthy = true }
            done += action
            return action
        }
    }

    @Test
    fun aServiceStartedByARestartRebuildsItsWindowOnceThingsSettle() {
        // Android binds the service shortly after boot (after the PIN): a restart's.
        assertTrue(IslandRecovery.connectedAtBoot(40_000L))
        assertTrue(IslandRecovery.connectedAtBoot(0L))
        // Switched on in Settings hours later, or the app updated: not a restart, nothing extra.
        assertFalse(IslandRecovery.connectedAtBoot(3 * 60 * 60_000L))
        assertFalse(IslandRecovery.connectedAtBoot(IslandRecovery.BOOT_WINDOW_MS))
        assertFalse(IslandRecovery.connectedAtBoot(-1L))
        // Rebuilt more than once, the last well after a slow phone's lock screen and system UI have settled.
        val times = IslandRecovery.BOOT_REBUILD_MS.toList()
        assertTrue(times.size >= 2)
        assertTrue(times.zipWithNext().all { (a, b) -> b > a })
        assertTrue(times.first() >= 3_000L)
        assertTrue(times.last() >= 20_000L)
    }

    @Test
    fun aBootRebuildIsWhatTheAppSwitchDoesButNeverWhileTheIslandIsInHand() {
        assertEquals(IslandRecovery.Action.REBUILD, IslandRecovery.onBootRebuild(wanted = true, windowAdded = true, inUse = false))
        assertEquals(IslandRecovery.Action.BUILD, IslandRecovery.onBootRebuild(wanted = true, windowAdded = false, inUse = false))
        assertEquals(IslandRecovery.Action.RECHECK, IslandRecovery.onBootRebuild(wanted = true, windowAdded = true, inUse = true))
        assertEquals(IslandRecovery.Action.NOTHING, IslandRecovery.onBootRebuild(wanted = false, windowAdded = true, inUse = false))
    }

    @Test
    fun theFirstUnlockAfterARestartRebuildsThenLaterOnesOnlyLookAgain() {
        val phone = Phone()
        phone.connect()
        // The window looks fine but may hold a size, rotation or lock from before the phone finished starting.
        assertEquals(IslandRecovery.Action.REBUILD, phone.screenEvent())
        // Screen off and on, unlock, all day long: no flicker, just a fresh look at the lock and the screen.
        repeat(20) { assertEquals(IslandRecovery.Action.RECHECK, phone.screenEvent()) }
    }

    @Test
    fun aWindowAndroidDroppedIsRebuiltOnTheNextScreenOn() {
        val phone = Phone()
        phone.connect()
        phone.screenEvent()
        phone.healthy = false // e.g. the system UI restarted and took the overlay's surface with it
        assertEquals(IslandRecovery.Action.REBUILD, phone.screenEvent())
        assertEquals(IslandRecovery.Action.RECHECK, phone.screenEvent())
    }

    @Test
    fun aRefusedWindowIsBuiltOnTheNextScreenOn() {
        val phone = Phone()
        phone.connect()
        phone.added = false
        assertEquals(IslandRecovery.Action.BUILD, phone.screenEvent())
        assertEquals(IslandRecovery.Action.RECHECK, phone.screenEvent())
    }

    @Test
    fun anIslandOpenInTheListenersHandWaitsForTheNextEvent() {
        val phone = Phone()
        phone.connect()
        phone.inUse = true
        assertEquals(IslandRecovery.Action.RECHECK, phone.screenEvent())
        phone.inUse = false
        // The deferred first rebuild still happens.
        assertEquals(IslandRecovery.Action.REBUILD, phone.screenEvent())
        assertEquals(IslandRecovery.Action.RECHECK, phone.screenEvent())
    }

    @Test
    fun anIslandSwitchedOffStaysOffThroughEveryScreenEvent() {
        val phone = Phone(wanted = false)
        phone.connect()
        repeat(5) { assertEquals(IslandRecovery.Action.NOTHING, phone.screenEvent()) }
        // Switched back on in the app: the next screen-on brings it.
        phone.wanted = true
        phone.added = false
        assertEquals(IslandRecovery.Action.BUILD, phone.screenEvent())
    }

    @Test
    fun aServiceThatReconnectsStartsOverWithAFirstRebuild() {
        val phone = Phone()
        phone.connect()
        phone.screenEvent()
        phone.connect() // Android re-bound the service (process killed by a battery saver, then restarted)
        assertEquals(IslandRecovery.Action.REBUILD, phone.screenEvent())
    }

    @Test
    fun onlyABuildOrRebuildCountsAsHandlingTheFirstEvent() {
        assertTrue(IslandRecovery.consumesFirstEvent(IslandRecovery.Action.REBUILD))
        assertTrue(IslandRecovery.consumesFirstEvent(IslandRecovery.Action.BUILD))
        assertFalse(IslandRecovery.consumesFirstEvent(IslandRecovery.Action.RECHECK))
        assertFalse(IslandRecovery.consumesFirstEvent(IslandRecovery.Action.NOTHING))
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
