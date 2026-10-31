package com.lyricflow.app.views

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MoreMenuItemsTest {
    private fun tile(key: String) = """{"key":"$key","label":"$key","icon":"search","tile":true}"""
    private val row = """{"key":"Settings","label":"Settings","icon":"settings-outline","hint":"Playback","tile":false}"""

    @Test fun `parses three tiles then the rows`() {
        val items = MoreMenuItems.parse("[${tile("a")},${tile("b")},${tile("c")},$row]")
        assertEquals(4, items.size)
        assertEquals("a", items[0].key)
        assertTrue(items[2].tile)
        assertEquals("Settings", items[3].key)
        assertEquals("Playback", items[3].hint)
        assertNull(items[0].hint)
    }

    @Test fun `anything the geometry cannot draw gives no items`() {
        assertTrue(MoreMenuItems.parse(null).isEmpty())
        assertTrue(MoreMenuItems.parse("").isEmpty())
        assertTrue(MoreMenuItems.parse("nope").isEmpty())
        // Two tiles only.
        assertTrue(MoreMenuItems.parse("[${tile("a")},${tile("b")},$row]").isEmpty())
        // A row before the tiles end.
        assertTrue(MoreMenuItems.parse("[${tile("a")},$row,${tile("b")},${tile("c")}]").isEmpty())
        // A missing field.
        assertTrue(MoreMenuItems.parse("""[{"key":"a"}]""").isEmpty())
    }
}
