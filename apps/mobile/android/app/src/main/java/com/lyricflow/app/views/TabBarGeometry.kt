package com.lyricflow.app.views

/**
 * Pure layout of the native tab bar, in dp. The view draws icons and lays out its touch slots from
 * the same rectangles, so what is drawn is what answers a tap. The numbers mirror the React Native
 * bars (`CustomTabBar`, `ModernPillTabBar`) so the two renderers swap without anything moving.
 */
object TabBarGeometry {
    const val BAR_HEIGHT = 64f
    const val MIC_SLOT = 56f
    const val PILL_SIDE = 6f
    const val CLASSIC_SIDE = 12f

    data class Slot(val left: Float, val top: Float, val right: Float, val bottom: Float) {
        val centerX: Float get() = (left + right) / 2f
        val width: Float get() = right - left
        fun contains(x: Float, y: Float): Boolean = x >= left && x < right && y >= top && y < bottom
    }

    /** Top of the 64dp bar inside a view of [height]: the classic bar sits above the system inset. */
    fun barTop(pill: Boolean, height: Float, bottomInset: Float, bottomOffset: Float): Float =
        if (pill) (height - bottomOffset - BAR_HEIGHT).coerceAtLeast(0f)
        else (height - bottomInset - BAR_HEIGHT).coerceAtLeast(0f)

    /** Stream, Luvs, [mic gap], Library, More: four equal cells, two each side of the mic. */
    fun slots(pill: Boolean, micEnabled: Boolean, width: Float, top: Float): List<Slot> {
        val side = if (pill) PILL_SIDE else CLASSIC_SIDE
        val centre = if (micEnabled) MIC_SLOT else 0f
        val group = ((width - side * 2f - centre).coerceAtLeast(0f)) / 2f
        val cell = group / 2f
        val rightStart = side + group + centre
        val bottom = top + BAR_HEIGHT
        return listOf(
            Slot(side, top, side + cell, bottom),
            Slot(side + cell, top, side + group, bottom),
            Slot(rightStart, top, rightStart + cell, bottom),
            Slot(rightStart + cell, top, rightStart + group, bottom),
        )
    }
}
