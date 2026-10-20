package com.lyricflow.app.island

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

    @Test
    fun `word fill follows the player clock through gaps and seeks`() {
        val line = IslandLyrics.Line(2000, "First word", listOf(
            IslandLyrics.Segment(0f, 5f, 2000, 3000),
            IslandLyrics.Segment(6f, 10f, 3500, 4000),
        ), true)
        assertEquals(0f, IslandLyrics.highlightOffset(line, 1000), 0.001f)
        assertEquals(2.5f, IslandLyrics.highlightOffset(line, 2500), 0.001f)
        assertEquals(5f, IslandLyrics.highlightOffset(line, 3200), 0.001f)
        assertEquals(8f, IslandLyrics.highlightOffset(line, 3750), 0.001f)
        assertEquals(10f, IslandLyrics.highlightOffset(line, 5000), 0.001f)
        assertEquals(0f, IslandLyrics.highlightOffset(line, 1000), 0.001f)
    }

    @Test
    fun `instrumental labels become symbols instead of sung words`() {
        for (text in listOf("[INSTRUMENTAL]", "Instrumental Break", "Instrumental"))
            assertEquals(true, IslandLyrics.isInstrumental(text))
        assertEquals(false, IslandLyrics.isInstrumental("Sing this line"))
    }

    @Test
    fun `only the sung line sweeps, and never under Reduce Motion or for a music break`() {
        val timed = IslandLyrics.Line(0, "Sing", listOf(IslandLyrics.Segment(0f, 4f, 0, 1000)), true)
        assertTrue(IslandLyrics.sweeps(timed, sung = true, motionOff = false))
        assertFalse("no ticks under Reduce Motion: a sweep would freeze mid-word", IslandLyrics.sweeps(timed, sung = true, motionOff = true))
        assertFalse(IslandLyrics.sweeps(timed, sung = false, motionOff = false))
        assertFalse("lines mode never sweeps", IslandLyrics.sweeps(IslandLyrics.Line(0, "Sing", timed.segments, false), true, false))
        assertFalse(IslandLyrics.sweeps(IslandLyrics.Line(0, "[INSTRUMENTAL]", timed.segments, true), true, false))
    }

    @Test
    fun `timing from JavaScript keeps a fraction past the line end, sorts lines and drops blanks`() {
        val parsed = IslandLyrics.parseTiming(
            """{"highlight":"letters","lines":[
              {"atMs":5000,"text":"Second","segments":[]},
              {"atMs":1000,"text":"First word","segments":[{"from":0,"to":5,"startMs":1000,"endMs":2000},{"from":6,"to":10.000001,"startMs":2500,"endMs":3000}]},
              {"atMs":3000,"text":"   ","segments":[]}]}"""
        )!!
        assertEquals(listOf("First word", "Second"), parsed.map { it.text })
        assertTrue(parsed[0].letters)
        assertEquals(2, parsed[0].segments.size)
        assertEquals(10f, parsed[0].segments[1].to, 0f)
    }

    @Test
    fun `malformed or impossible timing is refused so the previous sheet stays`() {
        assertNull(IslandLyrics.parseTiming("not json"))
        assertNull(IslandLyrics.parseTiming("{}"))
        val bad = IslandLyrics.parseTiming(
            """{"highlight":"letters","lines":[{"atMs":0,"text":"Word","segments":[{"from":2,"to":1,"startMs":0,"endMs":10},{"from":0,"to":9,"startMs":0,"endMs":10},{"from":0,"to":2,"startMs":10,"endMs":10}]}]}"""
        )!!
        assertTrue("backwards, too long and zero-length segments are dropped", bad[0].segments.isEmpty())
    }
}
