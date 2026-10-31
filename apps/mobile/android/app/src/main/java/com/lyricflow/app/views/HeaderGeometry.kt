package com.lyricflow.app.views

import kotlin.math.max
import kotlin.math.min

/**
 * The layout of Now Playing's header (a grabber and, when they apply, the "Listening together" and "Playing on" chips),
 * ported from `NowPlayingHeader.tsx`'s styles. All in dp, in the view's own coordinates (x across the container, y from
 * the top of the stack under the safe-area padding); pure, so it is tested on the JVM.
 */
object HeaderGeometry {
    const val GRABBER_W = 38f
    const val GRABBER_H = 5f
    const val GRABBER_V_MARGIN = 6f

    /** The grabber's pressable is the grabber plus its 6 dp margins above and below. */
    const val GRABBER_BOX_H = GRABBER_H + 2 * GRABBER_V_MARGIN

    /** `hitSlop={{ top: 12, bottom: 12, left: 40, right: 40 }}` on the grabber. */
    const val SLOP_V = 12f
    const val SLOP_H = 40f

    const val CHIP_H = 30f
    const val CHIP_GAP = 6f
    const val CHIP_PAD_X = 12f
    const val CHIP_ICON = 15f
    const val CHIP_ICON_GAP = 6f

    /** `maxWidth: '80%'`. */
    const val CHIP_MAX = 0.8f

    sealed interface Target {
        object None : Target
        object Back : Target
        data class Chip(val index: Int) : Target
    }

    /**
     * The view starts [ORIGIN] above the stack (the JS side gives it that much negative margin), so the grabber's slop
     * above it lies inside the view: Android only sends a child touches that land inside its own bounds. Stack y +
     * [ORIGIN] is view y.
     */
    const val ORIGIN = SLOP_V

    /** The stack's height: the grabber's box, then each chip with the 6 dp above it. */
    fun height(chips: Int): Float = GRABBER_BOX_H + chips * (CHIP_GAP + CHIP_H)

    /** The view's height: the stack, or the grabber's slop below it when that reaches further, plus [ORIGIN] above. */
    fun viewHeight(chips: Int): Float = ORIGIN + max(GRABBER_BOX_H + SLOP_V, height(chips))

    /** A chip as wide as its icon, gap, text and padding, but never past 80% of the container. */
    fun chipWidth(textW: Float, width: Float): Float =
        min(width * CHIP_MAX, 2 * CHIP_PAD_X + CHIP_ICON + CHIP_ICON_GAP + textW)

    /** The room a chip's text has once its icon, gap and padding are taken out. */
    fun chipTextRoom(chipW: Float): Float = max(0f, chipW - 2 * CHIP_PAD_X - CHIP_ICON - CHIP_ICON_GAP)

    fun chipTop(index: Int): Float = GRABBER_BOX_H + CHIP_GAP + index * (CHIP_H + CHIP_GAP)

    class Rect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
        fun contains(x: Float, y: Float) = x >= left && x <= right && y >= top && y <= bottom
    }

    fun grabberHit(width: Float): Rect {
        val cx = width / 2f
        return Rect(cx - GRABBER_W / 2f - SLOP_H, -SLOP_V, cx + GRABBER_W / 2f + SLOP_H, GRABBER_BOX_H + SLOP_V)
    }

    fun chipRect(index: Int, textW: Float, width: Float): Rect {
        val w = chipWidth(textW, width)
        val left = (width - w) / 2f
        val top = chipTop(index)
        return Rect(left, top, left + w, top + CHIP_H)
    }

    /** What a touch at ([x], [y]) lands on. Chips come after the grabber in React Native, so a chip wins where they overlap. */
    fun hit(x: Float, y: Float, width: Float, chipTextWidths: List<Float>): Target {
        for (i in chipTextWidths.indices.reversed()) if (chipRect(i, chipTextWidths[i], width).contains(x, y)) return Target.Chip(i)
        return if (grabberHit(width).contains(x, y)) Target.Back else Target.None
    }

    /**
     * The box that holds the grabber's slop and every chip, in stack coordinates: React Native's hit test uses it
     * (`ReactHitSlopView`) so the rest of the header's strip is not this view's. Gesture Handler ignores that and
     * tests plain bounds, which is why the touch targets are also real child views sized to the same rectangles.
     */
    fun targetBox(width: Float, chipTextWidths: List<Float>): Rect {
        var left = grabberHit(width).left
        var right = grabberHit(width).right
        var bottom = grabberHit(width).bottom
        for (i in chipTextWidths.indices) {
            val r = chipRect(i, chipTextWidths[i], width)
            left = min(left, r.left)
            right = max(right, r.right)
            bottom = max(bottom, r.bottom)
        }
        return Rect(max(left, 0f), -SLOP_V, min(right, width), bottom)
    }
}
