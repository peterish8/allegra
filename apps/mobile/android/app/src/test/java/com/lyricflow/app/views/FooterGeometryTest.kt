package com.lyricflow.app.views

import com.lyricflow.app.views.FooterGeometry.Target
import org.junit.Assert.assertEquals
import org.junit.Test

class FooterGeometryTest {
    @Test fun `a half is at least 64 wide and grows with its label`() {
        assertEquals(64f, FooterGeometry.halfWidth(22f, 0f), 0f)
        assertEquals(64f, FooterGeometry.halfWidth(21f, 0f), 0f)
        // 16 + 21 + 6 + 40 + 16
        assertEquals(99f, FooterGeometry.halfWidth(21f, 40f), 0f)
    }

    @Test fun `the three items are spread across the row`() {
        val row = FooterGeometry.row(304f, 129f)
        assertEquals(0f, row.queueX, 0f)
        assertEquals(260f, row.lyricsX, 0f)
        // Equal gaps either side of the segment: (304 - 88 - 129) / 2 = 43.5 after the 44 wide queue button.
        assertEquals(87.5f, row.segmentX, 0f)
        val before = row.segmentX - FooterGeometry.BUTTON
        val after = row.lyricsX - (row.segmentX + row.segmentW)
        assertEquals(before, after, 1e-4f)
    }

    private val row = FooterGeometry.row(304f, 129f)

    private fun hit(x: Float, y: Float, hasTimer: Boolean = true, extra: Float = 0f) =
        FooterGeometry.hit(x, y, row, 64f, 65f, hasTimer, extra)

    @Test fun `touches land on the item under them`() {
        assertEquals(Target.QUEUE, hit(20f, 22f))
        assertEquals(Target.OUTPUT, hit(row.segmentX + 10f, 22f))
        assertEquals(Target.TIMER, hit(row.segmentX + 64f + 10f, 22f))
        assertEquals(Target.LYRICS, hit(280f, 22f))
        assertEquals(Target.NONE, hit(row.segmentX - 5f, 22f))
    }

    @Test fun `the queue and lyrics buttons take a 10 dp slop, the segment halves none`() {
        assertEquals(Target.QUEUE, hit(-9f, -9f))
        assertEquals(Target.QUEUE, hit(53f, 53f))
        assertEquals(Target.NONE, hit(-11f, 22f))
        assertEquals(Target.LYRICS, hit(row.lyricsX - 9f, 22f))
        assertEquals(Target.LYRICS, hit(row.lyricsX + 44f + 9f, 54f))
        // Above the segment is outside it: only a retained press reaches that far.
        assertEquals(Target.NONE, hit(row.segmentX + 10f, -3f))
        assertEquals(Target.OUTPUT, hit(row.segmentX + 10f, -3f, extra = 20f))
    }

    @Test fun `without a timer there is only the output half`() {
        assertEquals(Target.NONE, hit(row.segmentX + 64f + 10f, 22f, hasTimer = false))
    }

    @Test fun `lyrics wins where its slop overlaps another item`() {
        // A tiny row where the lyrics slop reaches into the segment.
        val narrow = FooterGeometry.row(160f, 64f)
        assertEquals(Target.LYRICS, FooterGeometry.hit(narrow.lyricsX - 5f, 22f, narrow, 64f, 0f, false))
    }
}
