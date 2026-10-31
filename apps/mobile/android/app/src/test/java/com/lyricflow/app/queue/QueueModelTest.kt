package com.lyricflow.app.queue

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueModelTest {
    private fun row(i: Int, cover: String = "\"https://x/y.jpg\"") =
        """{"i":$i,"id":"s$i","title":"Song $i","sub":"Artist · 3:30","cover":$cover,"base":"#2a1b3d","mid":"#ee6b5f","spark":"#ffaaa0","glyph":"S","variant":1}"""

    @Test fun `parses rows with their place in the whole queue`() {
        val rows = QueueParser.rows("[${row(2)},${row(5, "null")}]")
        assertEquals(2, rows.size)
        assertEquals(2, rows[0].index)
        assertEquals("Song 2", rows[0].title)
        assertEquals("Artist · 3:30", rows[0].subtitle)
        assertEquals("https://x/y.jpg", rows[0].cover)
        assertNull(rows[1].cover)
        assertEquals(5, rows[1].index)
        assertEquals(1, rows[0].tile.variant)
        assertEquals(0xFF2a1b3d.toInt(), rows[0].tile.base)
    }

    @Test fun `a broken or empty payload gives no rows, never a crash`() {
        assertTrue(QueueParser.rows(null).isEmpty())
        assertTrue(QueueParser.rows("").isEmpty())
        assertTrue(QueueParser.rows("not json").isEmpty())
        assertTrue(QueueParser.rows("[{\"id\":\"no index\"}]").isEmpty())
    }

    @Test fun `hex colours`() {
        assertEquals(0xFFFFAAA0.toInt(), QueueParser.hex("#ffaaa0"))
        assertEquals(0xFF282828.toInt(), QueueParser.hex("tomato"))
    }

    @Test fun `a dragged row lands where it points, clamped to the list`() {
        assertEquals(3, QueueMath.dropIndex(1, 130f, 64f, 10))
        assertEquals(1, QueueMath.dropIndex(1, 20f, 64f, 10))
        assertEquals(0, QueueMath.dropIndex(1, -500f, 64f, 10))
        assertEquals(9, QueueMath.dropIndex(8, 500f, 64f, 10))
    }

    @Test fun `a handle drag starts after one dp in any direction`() {
        assertFalse(QueueMath.beginsReorderDrag(0.99f, 0f, 1f))
        assertTrue(QueueMath.beginsReorderDrag(1f, 0f, 1f))
        assertTrue(QueueMath.beginsReorderDrag(0f, -1f, 1f))
        assertFalse(QueueMath.beginsReorderDrag(2.9f, 0f, 3f))
        assertTrue(QueueMath.beginsReorderDrag(3f, 0f, 3f))
        assertTrue(QueueMath.beginsReorderDrag(0f, 3f, 3f))
    }

    @Test fun `rows step aside towards where the dragged row came from`() {
        // Row 1 dragged down over 3: rows 2 and 3 move up one place.
        assertEquals(0, QueueMath.shiftRows(1, 1, 3))
        assertEquals(-1, QueueMath.shiftRows(2, 1, 3))
        assertEquals(-1, QueueMath.shiftRows(3, 1, 3))
        assertEquals(0, QueueMath.shiftRows(4, 1, 3))
        // Row 4 dragged up over 2: rows 2 and 3 move down one place.
        assertEquals(1, QueueMath.shiftRows(2, 4, 2))
        assertEquals(1, QueueMath.shiftRows(3, 4, 2))
        assertEquals(0, QueueMath.shiftRows(1, 4, 2))
        // Nothing dragged.
        assertEquals(0, QueueMath.shiftRows(2, -1, -1))
    }

    @Test fun `the list opens one row above the playing song`() {
        assertEquals(4, QueueMath.startRow(5, 20, true))
        assertEquals(0, QueueMath.startRow(0, 20, true))
        assertEquals(0, QueueMath.startRow(5, 20, false))
        assertEquals(19, QueueMath.startRow(40, 20, true))
    }

    @Test fun `moving an item matches the JavaScript moveItem`() {
        assertEquals(listOf("a", "c", "d", "b", "e"), QueueMath.move(listOf("a", "b", "c", "d", "e"), 1, 3))
        assertEquals(listOf("c", "a", "b"), QueueMath.move(listOf("a", "b", "c"), 2, 0))
        assertEquals(listOf("a", "b"), QueueMath.move(listOf("a", "b"), 5, 0))
        assertEquals(listOf("b", "a"), QueueMath.move(listOf("a", "b"), 0, 9))
    }

    @Test fun `scroll range`() {
        assertEquals(0f, QueueMath.maxScroll(300f, 500f), 0f)
        assertEquals(200f, QueueMath.maxScroll(700f, 500f), 0f)
    }

    @Test fun `a pull down from the top is the panel's, a pull up or a scrolled list is the list's`() {
        assertTrue(QueueMath.yieldsToPanel(0f, 12f, 4f))
        assertTrue(QueueMath.yieldsToPanel(4f, 12f, 4f))
        assertTrue(!QueueMath.yieldsToPanel(0f, -12f, 4f))
        assertTrue(!QueueMath.yieldsToPanel(300f, 12f, 4f))
    }

    @Test fun `the touch slop is not scrolled`() {
        // Finger dragged up 20 with an 8 slop: the first delta is 12.
        assertEquals(12f, QueueMath.scrollOrigin(100f, 80f, 8f) - 80f, 0f)
        // Finger dragged down 20: the first delta is -12.
        assertEquals(-12f, QueueMath.scrollOrigin(100f, 120f, 8f) - 120f, 0f)
    }
}
