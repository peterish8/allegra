package com.lyricflow.app.views

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TabBarGeometryTest {
    @Test fun `classic bar sits above the system inset`() {
        assertEquals(800f - 34f - 64f, TabBarGeometry.barTop(false, 800f, 34f, 0f), 0.001f)
    }

    @Test fun `pill bar sits at its offset from the bottom`() {
        assertEquals(64f, TabBarGeometry.barTop(true, 128f, 34f, 0f), 0.001f)
        assertEquals(0f, TabBarGeometry.barTop(true, 40f, 0f, 0f), 0.001f)
    }

    @Test fun `four slots leave the mic gap in the middle`() {
        val slots = TabBarGeometry.slots(pill = false, micEnabled = true, width = 400f, top = 0f)
        assertEquals(4, slots.size)
        // 400 - 24 side - 56 mic = 320 → 160 per group → 80 per cell.
        assertEquals(12f, slots[0].left, 0.001f)
        assertEquals(80f, slots[0].width, 0.001f)
        assertEquals(172f, slots[1].right, 0.001f)
        assertEquals(228f, slots[2].left, 0.001f)
        assertEquals(388f, slots[3].right, 0.001f)
        // Nothing answers a tap in the mic's own 56dp.
        assertFalse(slots.any { it.contains(200f, 32f) })
    }

    @Test fun `without the mic the cells share the whole width`() {
        val slots = TabBarGeometry.slots(pill = true, micEnabled = false, width = 300f, top = 0f)
        assertEquals(6f, slots.first().left, 0.001f)
        assertEquals(294f, slots.last().right, 0.001f)
        for (i in 0 until 3) assertEquals(slots[i].right, slots[i + 1].left, 0.001f)
    }

    @Test fun `every slot is a comfortable touch target`() {
        val narrow = TabBarGeometry.slots(pill = true, micEnabled = true, width = 320f, top = 0f)
        assertTrue(narrow.all { it.width >= 48f && it.bottom - it.top >= 48f })
    }

    @Test fun `slots never overlap and never leave the view`() {
        val slots = TabBarGeometry.slots(pill = false, micEnabled = true, width = 360f, top = 100f)
        for (i in 0 until 3) assertTrue(slots[i].right <= slots[i + 1].left + 0.001f)
        assertTrue(slots.all { it.left >= 0f && it.right <= 360f })
    }
}
