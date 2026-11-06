package com.lyricflow.app.modules

import org.junit.Assert.assertEquals
import org.junit.Test

/** 1.41.0: Luvs keeps only a few players warm, most likely next first, so opening it can't exhaust a phone. */
class LuvsWarmPoolTest {
    @Test
    fun `keeps at most the limit, in the order JS asked, without the live song or blanks`() {
        val warm = listOf("next", "", "live", "left", "next", "right", "previous")
        assertEquals(listOf("next", "left", "right"), warmToKeep("live", warm, MAX_WARM_PLAYERS))
    }

    @Test
    fun `a low-memory phone keeps one`() {
        assertEquals(listOf("next"), warmToKeep("live", listOf("next", "left"), MAX_WARM_PLAYERS_LOW_RAM))
    }

    @Test
    fun `nothing warm when there is nothing to keep or no room`() {
        assertEquals(emptyList<String>(), warmToKeep("live", emptyList(), MAX_WARM_PLAYERS))
        assertEquals(emptyList<String>(), warmToKeep("live", listOf("a"), 0))
        assertEquals(emptyList<String>(), warmToKeep("live", listOf("a"), -2))
    }
}
