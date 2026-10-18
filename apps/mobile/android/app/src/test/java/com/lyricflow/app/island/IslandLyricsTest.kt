package com.lyricflow.app.island

import org.junit.Assert.assertEquals
import org.junit.Test

class IslandLyricsTest {

    private val lines = IslandLyrics.linesOf(
        listOf(12_000L, 4_000L, 8_000L, 16_000L),
        listOf("third", "first", "  ", "fourth"),
    )

    @Test
    fun `lines are kept in time order and blank ones are dropped`() {
        assertEquals(listOf("first", "third", "fourth"), lines.map { it.text })
        assertEquals(listOf(4_000L, 12_000L, 16_000L), lines.map { it.atMs })
    }

    @Test
    fun `before the first line nothing is being sung`() {
        assertEquals(-1, IslandLyrics.lineAt(lines, 3_999L))
    }

    @Test
    fun `the sung line is the last one that has started`() {
        assertEquals(0, IslandLyrics.lineAt(lines, 4_000L))
        assertEquals(0, IslandLyrics.lineAt(lines, 11_999L))
        assertEquals(1, IslandLyrics.lineAt(lines, 12_000L))
        assertEquals(2, IslandLyrics.lineAt(lines, 600_000L))
    }

    @Test
    fun `no lines means nothing is sung`() {
        assertEquals(-1, IslandLyrics.lineAt(emptyList(), 5_000L))
    }
}
