package com.lyricflow.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CacheBudgetTest {

    private fun budget() = CacheBudget(maxBytes = 1000, headBytes = 100, headBudgetBytes = 300)
    private val a = SpanInfo("A", position = 0, length = 200, lastTouch = 1)
    private val b = SpanInfo("B", position = 500, length = 400, lastTouch = 2)
    private val c = SpanInfo("C", position = 0, length = 200, lastTouch = 3)

    private fun filled() = budget().apply { added(a); added(b); added(c) }

    @Test
    fun `nothing is evicted under the ceiling`() {
        assertTrue(filled().victims(200).isEmpty())
        assertEquals(800, filled().totalSize)
    }

    @Test
    fun `ordinary spans go first, oldest first`() {
        assertEquals(listOf(b), filled().victims(500))
    }

    @Test
    fun `protected openings go only after every ordinary span`() {
        assertEquals(listOf(b, c, a), filled().victims(900))
    }

    @Test
    fun `the head budget caps how much is protected`() {
        // A fills 200 of 300; C (another 200) would pass the budget, so it is ordinary and goes before A.
        assertEquals(listOf(b, c), filled().victims(700))
    }

    @Test
    fun `lowering the ceiling evicts without a new span`() {
        val cache = filled()
        cache.maxBytes = 300
        assertEquals(listOf(b, c), cache.victims(0))
    }

    @Test
    fun `a removed span no longer counts`() {
        val cache = filled()
        cache.removed(b)
        assertEquals(400, cache.totalSize)
        cache.removed(b)
        assertEquals(400, cache.totalSize)
    }
}
