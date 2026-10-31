package com.lyricflow.app.views

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AlphabetRailMathTest {
    @Test fun `the rail is its padding, a 15 dp line per letter and the border`() {
        assertEquals(16f + 15f * 5 + 1f, AlphabetRailMath.railHeight(5, 0.5f), 0f)
        assertEquals(16f, AlphabetRailMath.railHeight(0, 0f), 0f)
    }

    @Test fun `the rail and the letters follow the line height JavaScript hands down`() {
        assertEquals(16f + 26 * 15.2381f + 1f, AlphabetRailMath.railHeight(26, 0.5f, 15.2381f), 1e-3f)
        assertEquals(8.5f + 2 * 15.2381f, AlphabetRailMath.letterTop(2, 0.5f, 15.2381f), 1e-3f)
        assertEquals(1f + 10f, AlphabetRailMath.baselineInLine(-10f, 3f, 15f), 1e-4f)
    }

    @Test fun `a touch picks the letter under it like railPick`() {
        // 10 letters on a 200 dp rail: each owns 20 dp.
        assertEquals(0, AlphabetRailMath.pick(0f, 200f, 10))
        assertEquals(0, AlphabetRailMath.pick(19.9f, 200f, 10))
        assertEquals(1, AlphabetRailMath.pick(20f, 200f, 10))
        assertEquals(9, AlphabetRailMath.pick(199f, 200f, 10))
        // Off the ends it clamps.
        assertEquals(0, AlphabetRailMath.pick(-40f, 200f, 10))
        assertEquals(9, AlphabetRailMath.pick(500f, 200f, 10))
        // Nothing to pick from.
        assertEquals(0, AlphabetRailMath.pick(50f, 0f, 10))
        assertEquals(0, AlphabetRailMath.pick(50f, 200f, 0))
    }

    @Test fun `the bubble follows the touch but stays on the rail`() {
        assertEquals(80f, AlphabetRailMath.bubbleY(80f, 200f), 0f)
        assertEquals(0f, AlphabetRailMath.bubbleY(-30f, 200f), 0f)
        assertEquals(200f, AlphabetRailMath.bubbleY(260f, 200f), 0f)
    }

    @Test fun `the view reaches far enough for the bubble`() {
        // The bubble's left edge is 56 + 40 - 26 = 70 dp left of the rail.
        assertEquals(70f, AlphabetRailMath.REACH_LEFT, 0f)
        assertEquals(28f, AlphabetRailMath.REACH_V, 0f)
    }

    @Test fun `letters sit on 15 dp lines under the padding`() {
        assertEquals(8.5f, AlphabetRailMath.letterTop(0, 0.5f), 0f)
        assertEquals(23.5f, AlphabetRailMath.letterTop(1, 0.5f), 0f)
    }

    @Test fun `a step moves one letter and stays on the rail`() {
        assertEquals(0, AlphabetRailMath.step(-1, 1, 5))
        assertEquals(4, AlphabetRailMath.step(-1, -1, 5))
        assertEquals(3, AlphabetRailMath.step(2, 1, 5))
        assertEquals(4, AlphabetRailMath.step(4, 1, 5))
        assertEquals(0, AlphabetRailMath.step(0, -1, 5))
        assertEquals(-1, AlphabetRailMath.step(0, 1, 0))
    }

    @Test fun `the baseline sits where spare leading is split evenly`() {
        // Ascent -10, descent 3: glyph height 13 in a 15 line: 1 above, so the baseline is 1 + 10 below the top.
        assertEquals(11f, AlphabetRailMath.baselineInLine(-10f, 3f), 0f)
    }

    @Test fun `parses the letters and survives garbage`() {
        val letters = AlphabetRailMath.parse("""[{"letter":"A","index":0},{"letter":"B","index":12}]""")
        assertEquals(listOf(RailLetter("A", 0), RailLetter("B", 12)), letters)
        assertTrue(AlphabetRailMath.parse(null).isEmpty())
        assertTrue(AlphabetRailMath.parse("").isEmpty())
        assertTrue(AlphabetRailMath.parse("nope").isEmpty())
        assertTrue(AlphabetRailMath.parse("""[{"letter":"A"}]""").isEmpty())
    }
}
