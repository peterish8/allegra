package com.lyricflow.app.startup

import org.junit.Assert.assertEquals
import org.junit.Test

class DisplayScaleTest {
    @Test
    fun snapsToTheOfferedSizes() {
        assertEquals(0.85f, DisplayScale.clamp(0.5f))
        assertEquals(0.92f, DisplayScale.clamp(0.9f))
        assertEquals(1f, DisplayScale.clamp(1f))
        assertEquals(1.08f, DisplayScale.clamp(3f))
    }

    @Test
    fun badValuesFallBackToTheDefault() {
        assertEquals(1f, DisplayScale.clamp(Float.NaN))
        assertEquals(1f, DisplayScale.clamp(Float.POSITIVE_INFINITY))
        assertEquals(1f, DisplayScale.clamp(0f))
        assertEquals(1f, DisplayScale.clamp(-1f))
    }

    @Test
    fun scalesFromTheDeviceDensityEveryTime() {
        // A 2.0 / 320dpi emulator at the smallest size: computed from the device value, so applying twice is the same.
        assertEquals(1.7f, DisplayScale.scaledDensity(2f, 0.85f), 0.0001f)
        assertEquals(272, DisplayScale.scaledDpi(320, 0.85f))
        assertEquals(320, DisplayScale.scaledDpi(320, 1f))
        assertEquals(1, DisplayScale.scaledDpi(0, 0.85f))
    }
}
