package com.lyricflow.app.views

import kotlin.math.ceil

/**
 * Pure layout of the native tab bar, in dp. The view draws icons and lays out its touch slots from
 * the same rectangles, so what is drawn is what answers a tap. The numbers mirror the React Native
 * bars (`CustomTabBar`, `ModernPillTabBar`) so the two renderers swap without anything moving.
 */
object TabBarGeometry {
    const val BAR_HEIGHT = 64f
    const val V6_BAR_HEIGHT = 56f
    const val V6_LABEL_SP = 12f
    const val MIC_SLOT = 56f
    const val PILL_SIDE = 6f
    const val CLASSIC_SIDE = 12f

    private const val V6_LABEL_TOP = 34f
    private const val V6_MIN_LABEL_BASELINE = 48f
    private const val V6_LABEL_BOTTOM_PADDING = 4f
    private const val V6_HEIGHT_RESERVE = 1.3f

    data class V6Layout(val barHeight: Float, val labelBaseline: Float) {
        val childBottom: Float get() = barHeight
    }

    data class Slot(val left: Float, val top: Float, val right: Float, val bottom: Float) {
        val centerX: Float get() = (left + right) / 2f
        val width: Float get() = right - left
        fun contains(x: Float, y: Float): Boolean = x >= left && x < right && y >= top && y < bottom
    }

    fun v6LabelBaseline(fontTop: Float): Float = maxOf(V6_MIN_LABEL_BASELINE, V6_LABEL_TOP - fontTop)

    /** Keep the font-scale reserve in sync with `navBarHeight` in `src/navigation/v6Shell.ts`. */
    fun v6Layout(fontScale: Float, fontTop: Float, fontBottom: Float): V6Layout {
        val baseline = v6LabelBaseline(fontTop)
        val scaleHeight = ceil(38f + V6_LABEL_SP * fontScale.coerceAtLeast(1f) * V6_HEIGHT_RESERVE).toFloat()
        val textHeight = ceil(baseline + fontBottom + V6_LABEL_BOTTOM_PADDING).toFloat()
        return V6Layout(maxOf(V6_BAR_HEIGHT, scaleHeight, textHeight), baseline)
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
