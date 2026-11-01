package com.lyricflow.app.modules

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IslandJsAwakeTest {
    private val hold = IslandJsAwake.HOLD_MS

    @Test
    fun `the first hold starts a task`() {
        assertTrue(IslandJsAwake.needsNewTask(now = 1_000L, ms = hold, until = 0L))
    }

    @Test
    fun `a hold while most of the running one is left reuses it`() {
        // A radio top-up 2 s after a search: the running task still covers 18 s.
        assertFalse(IslandJsAwake.needsNewTask(now = 3_000L, ms = hold, until = 1_000L + hold))
    }

    @Test
    fun `a hold near the end of the running one starts another, so the work is never cut short`() {
        // 12 s in: 8 s left, less than half of a new hold.
        assertTrue(IslandJsAwake.needsNewTask(now = 13_000L, ms = hold, until = 1_000L + hold))
        // Long after it ended.
        assertTrue(IslandJsAwake.needsNewTask(now = 60_000L, ms = hold, until = 1_000L + hold))
    }
}
