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
    fun `letter by letter lights each word across its own time`() {
        // "Uyire uyire": word one is chars 0..6 (with its space) over 1.0–2.0 s, word two 6..11 over 2.0–3.0 s.
        val swept = IslandLyrics.linesOf(listOf(1_000L), listOf("Uyire uyire"), listOf(listOf(6.0, 1_000.0, 2_000.0, 11.0, 2_000.0, 3_000.0)))[0]
        assertEquals(0f, IslandLyrics.litChars(swept, 500L), 0.001f)
        assertEquals(3f, IslandLyrics.litChars(swept, 1_500L), 0.001f)
        assertEquals(6f, IslandLyrics.litChars(swept, 2_000L), 0.001f)
        assertEquals(8.5f, IslandLyrics.litChars(swept, 2_500L), 0.001f)
        assertEquals(11f, IslandLyrics.litChars(swept, 9_000L), 0.001f)
    }

    @Test
    fun `line by line has no marks and draws whole`() {
        assertEquals(-1f, IslandLyrics.litChars(lines[0], 5_000L), 0.001f)
        val broken = IslandLyrics.linesOf(listOf(0L), listOf("x"), listOf(listOf(1.0, 0.0)))[0]
        assertEquals(-1f, IslandLyrics.litChars(broken, 5_000L), 0.001f)
    }

    @Test
    fun `no lines means nothing is sung`() {
        assertEquals(-1, IslandLyrics.lineAt(emptyList(), 5_000L))
    }
}
