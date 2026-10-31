package com.lyricflow.app.views

import org.junit.Assert.assertEquals
import org.junit.Test

class AppleBackdropGeometryTest {
    @Test fun `hero uses the top sixty five percent of the player`() {
        assertEquals(1_560f, AppleBackdropGeometry.heroHeight(2_400f), 0f)
        assertEquals(1_235f, AppleBackdropGeometry.heroHeight(1_900f), 0f)
    }

    @Test fun `room keeps its tiny size and scales blur to the screen width`() {
        val room = AppleBackdropGeometry.roomSize(600f, 900f)
        assertEquals(48, room.width)
        assertEquals(72, room.height)
        assertEquals(5.6f, room.sigma, 0.001f)
        assertEquals(6, AppleBackdropGeometry.blurRadius(room.sigma))
    }

    @Test fun `room crops wide and tall covers like fit cover`() {
        assertEquals(AppleBackdropGeometry.Crop(50f, 0f, 100f, 100f), AppleBackdropGeometry.coverCrop(200, 100, 1f, 1f))
        assertEquals(AppleBackdropGeometry.Crop(0f, 50f, 100f, 100f), AppleBackdropGeometry.coverCrop(100, 200, 1f, 1f))
    }

    @Test fun `song room fade is clamped to its twelve hundred millisecond interval`() {
        assertEquals(0f, AppleBackdropGeometry.fade(99, 100), 0f)
        assertEquals(0.776f, AppleBackdropGeometry.fade(700, 100), 0.003f)
        assertEquals(1f, AppleBackdropGeometry.fade(1_500, 100), 0f)
        assertEquals(0.236f, AppleBackdropGeometry.fade(400, 100), 0.002f)
    }

    @Test fun `sharp hero dims and follows a sideways cover shift`() {
        assertEquals(1f, AppleBackdropGeometry.heroOpacity(1f, 0f, 400f), 0f)
        assertEquals(0.7f, AppleBackdropGeometry.heroOpacity(1f, 200f, 400f), 0.0001f)
        assertEquals(0f, AppleBackdropGeometry.heroOpacity(0f, 0f, 400f), 0f)
    }

    @Test fun `new art settles from one hundred four to one hundred percent`() {
        assertEquals(1.04f, AppleBackdropGeometry.settleScale(0f), 0.0001f)
        assertEquals(1f, AppleBackdropGeometry.settleScale(1f), 0f)
    }

    @Test fun `video veil follows the inverse of the hero dissolve`() {
        assertEquals(0f, AppleBackdropGeometry.veilAlpha(0f), 0f)
        assertEquals(0f, AppleBackdropGeometry.veilAlpha(0.75f), 0f)
        assertEquals(0.6f, AppleBackdropGeometry.veilAlpha(0.92f), 0.0001f)
        assertEquals(1f, AppleBackdropGeometry.veilAlpha(1f), 0f)
    }
}
