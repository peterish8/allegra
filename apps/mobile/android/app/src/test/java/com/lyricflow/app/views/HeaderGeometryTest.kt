package com.lyricflow.app.views

import com.lyricflow.app.views.HeaderGeometry.Target
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HeaderGeometryTest {
    private val w = 360f

    @Test fun `the stack is the grabber box and 36 dp per chip`() {
        assertEquals(17f, HeaderGeometry.height(0), 0f)
        assertEquals(53f, HeaderGeometry.height(1), 0f)
        assertEquals(89f, HeaderGeometry.height(2), 0f)
        assertEquals(23f, HeaderGeometry.chipTop(0), 0f)
        assertEquals(59f, HeaderGeometry.chipTop(1), 0f)
    }

    @Test fun `a chip fits its content but never passes 80 percent`() {
        // 12 + 15 + 6 + 100 + 12
        assertEquals(145f, HeaderGeometry.chipWidth(100f, w), 0f)
        assertEquals(288f, HeaderGeometry.chipWidth(900f, w), 0f)
        assertEquals(100f, HeaderGeometry.chipTextRoom(145f), 0f)
        assertEquals(0f, HeaderGeometry.chipTextRoom(20f), 0f)
    }

    @Test fun `chips are centred in the container`() {
        val r = HeaderGeometry.chipRect(0, 100f, w)
        assertEquals((w - 145f) / 2f, r.left, 0f)
        assertEquals(w - r.left, r.right, 1e-4f)
        assertEquals(30f, r.bottom - r.top, 0f)
    }

    @Test fun `the grabber takes a wide hit slop`() {
        val g = HeaderGeometry.grabberHit(w)
        // 38 wide at the centre, 40 more either side; 17 high with 12 more above and below.
        assertEquals(180f - 19f - 40f, g.left, 0f)
        assertEquals(180f + 19f + 40f, g.right, 0f)
        assertEquals(-12f, g.top, 0f)
        assertEquals(29f, g.bottom, 0f)
    }

    @Test fun `touches land on the grabber or a chip`() {
        val widths = listOf(100f, 60f)
        assertEquals(Target.Back, HeaderGeometry.hit(180f, 8f, w, widths))
        assertEquals(Target.Back, HeaderGeometry.hit(130f, -10f, w, widths))
        assertEquals(Target.Chip(0), HeaderGeometry.hit(180f, 35f, w, widths))
        assertEquals(Target.Chip(1), HeaderGeometry.hit(180f, 70f, w, widths))
        assertEquals(Target.None, HeaderGeometry.hit(10f, 8f, w, widths))
        assertEquals(Target.None, HeaderGeometry.hit(180f, 120f, w, widths))
    }

    @Test fun `a chip wins where it overlaps the grabber's slop`() {
        // The grabber's slop reaches y 29, the first chip starts at 23.
        assertEquals(Target.Chip(0), HeaderGeometry.hit(180f, 26f, w, listOf(100f)))
        assertEquals(Target.Back, HeaderGeometry.hit(180f, 20f, w, listOf(100f)))
    }

    @Test fun `the target box holds the grabber slop and every chip, and nothing else`() {
        val noChips = HeaderGeometry.targetBox(w, emptyList())
        assertEquals(121f, noChips.left, 0f)
        assertEquals(239f, noChips.right, 0f)
        assertEquals(29f, noChips.bottom, 0f)
        val withChips = HeaderGeometry.targetBox(w, listOf(250f))
        // A chip wider than the grabber's slop widens the box to the chip.
        val chip = HeaderGeometry.chipRect(0, 250f, w)
        assertEquals(chip.left, withChips.left, 0f)
        assertEquals(chip.right, withChips.right, 0f)
        assertEquals(chip.bottom, withChips.bottom, 0f)
        assertTrue(withChips.top < 0f)
    }
}
