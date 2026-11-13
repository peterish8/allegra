package com.lyricflow.app.island

import org.junit.Assert.assertEquals
import org.junit.Test

class IslandBudgetTest {
    private fun pick(
        lowRam: Boolean = false,
        memMb: Long = 6144,
        cores: Int = 8,
        api: Int = 31,
        powerSave: Boolean = false,
        refreshHz: Float = 60f,
    ) = IslandBudget.pick(lowRam, memMb, cores, api, powerSave, refreshHz)

    @Test
    fun `older or constrained phones keep the inexpensive island even with a fast display`() {
        assertEquals(IslandBudget.LOW, pick(lowRam = true, refreshHz = 120f))
        assertEquals(IslandBudget.LOW, pick(memMb = 3072, refreshHz = 120f))
        assertEquals(IslandBudget.LOW, pick(cores = 4, refreshHz = 120f))
        assertEquals(IslandBudget.LOW, pick(api = 28, refreshHz = 120f))
    }

    @Test
    fun `battery saver overrides the rich launch on a capable phone`() {
        assertEquals(IslandBudget.LOW, pick(memMb = 8192, refreshHz = 120f, powerSave = true))
    }

    @Test
    fun `an M31 uses thirty frame ticks and a capable fast display uses sixty`() {
        assertEquals(IslandBudget.MID, pick())
        assertEquals(33L, pick().tickMs)
        assertEquals(IslandBudget.HIGH, pick(memMb = 8192, refreshHz = 120f))
        assertEquals(16L, pick(memMb = 8192, refreshHz = 120f).tickMs)
        assertEquals(IslandBudget.MID, pick(memMb = 4096, refreshHz = 120f))
    }
}
