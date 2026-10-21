package com.lyricflow.app.lyrics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LyricsParserTest {
    private fun sheet(rows: String, songId: String = "song-1", letters: Boolean = true) =
        """{"songId":"$songId","letters":$letters,"rows":[$rows]}"""

    @Test fun `parses lines with their timing and keeps the song they belong to`() {
        val parsed = LyricsParser.sheet(
            sheet("""{"atMs":1500,"ts":2,"text":"First word","instrumental":false,"segments":[{"from":0,"to":5,"startMs":1500,"endMs":2500},{"from":6,"to":10,"startMs":3000,"endMs":3500}]}"""),
        )
        assertNotNull(parsed)
        assertEquals("song-1", parsed!!.songId)
        assertTrue(parsed.letters)
        assertEquals(1500L, parsed.atMs[0])
        assertEquals(2.0, parsed.rows[0].timestamp, 0.0)
        assertEquals(2, parsed.rows[0].from.size)
        assertEquals(3000L, parsed.rows[0].startMs[1])
    }

    @Test fun `a malformed sheet is refused so the previous one stays`() {
        assertNull(LyricsParser.sheet("not json"))
        assertNull(LyricsParser.sheet("""{"rows":[]}"""))
        assertNull(LyricsParser.sheet(sheet("", songId = "")))
    }

    @Test fun `segments that cannot be honest are dropped, never invented`() {
        val parsed = LyricsParser.sheet(
            sheet("""{"atMs":0,"ts":0,"text":"abc","instrumental":false,"segments":[{"from":2,"to":1,"startMs":0,"endMs":10},{"from":0,"to":3,"startMs":10,"endMs":5},{"from":0,"to":9,"startMs":0,"endMs":10},{"from":0,"to":3.005,"startMs":0,"endMs":10}]}"""),
        )!!
        // Only the last one survives, clamped to the text.
        assertEquals(1, parsed.rows[0].from.size)
        assertEquals(3f, parsed.rows[0].to[0], 0f)
    }

    @Test fun `a music break carries no sweep`() {
        val parsed = LyricsParser.sheet(
            sheet("""{"atMs":0,"ts":0,"text":"","instrumental":true,"segments":[{"from":0,"to":1,"startMs":0,"endMs":10}]}"""),
        )!!
        assertTrue(parsed.rows[0].instrumental)
        assertFalse(parsed.rows[0].hasSegments)
    }

    @Test fun `a delay change keeps the layouts but a text change does not`() {
        val a = LyricsParser.sheet(sheet("""{"atMs":1000,"ts":1,"text":"hello","instrumental":false}"""))!!
        val later = LyricsParser.sheet(sheet("""{"atMs":1500,"ts":1,"text":"hello","instrumental":false}"""))!!
        val other = LyricsParser.sheet(sheet("""{"atMs":1000,"ts":1,"text":"goodbye","instrumental":false}"""))!!
        assertTrue(a.sameText(later))
        assertFalse(a.sameText(other))
    }

    @Test fun `config is clamped to sane values`() {
        val config = LyricsParser.config("""{"fontSize":900,"lineHeight":1,"gap":-4,"activePos":3,"align":"center","featherCount":9,"reduceMotion":true,"title":"  "}""")!!
        assertEquals(120f, config.fontSize, 0f)
        assertEquals(96f, config.lineHeight, 0f)
        assertEquals(0f, config.gap, 0f)
        assertEquals(1f, config.activePos, 0f)
        assertEquals(LyricsAlign.CENTER, config.align)
        assertEquals(3, config.featherCount)
        assertTrue(config.reduceMotion)
        assertNull(config.title)
        assertNull(LyricsParser.config("{"))
    }
}
