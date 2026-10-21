package com.lyricflow.app.views

import kotlin.math.max

/**
 * The geometry of Now Playing's bottom row (queue, the output / sleep timer segment, lyrics), ported from the styles in
 * `NowPlayingControls.tsx` (`footer`, `footerBtn`, `segment`, `segmentHalf`). All in dp; pure, so it is tested on the JVM.
 */
object FooterGeometry {
    const val ROW_H = 44f
    const val BUTTON = 44f
    const val HALF_MIN_W = 64f
    const val HALF_PAD = 16f
    const val HALF_GAP = 6f
    const val DIVIDER_H = 22f

    /** `hitSlop={10}` on the queue and lyrics buttons. */
    const val SLOP = 10f

    /** Pressable keeps a press alive while the finger is within this much of the target (its default retention). */
    const val RETAIN = 20f

    enum class Target { NONE, QUEUE, OUTPUT, TIMER, LYRICS }

    /** A segment half: at least 64 wide, 16 of padding each side, the icon and (timer only) a label after a 6 gap. */
    fun halfWidth(iconDp: Float, labelDp: Float): Float =
        max(HALF_MIN_W, 2 * HALF_PAD + iconDp + (if (labelDp > 0f) HALF_GAP + labelDp else 0f))

    /** Where the three items sit in a row [width] wide: `justifyContent: space-between`. x of each left edge. */
    class Row(val queueX: Float, val segmentX: Float, val segmentW: Float, val lyricsX: Float)

    fun row(width: Float, segmentW: Float): Row =
        Row(0f, BUTTON + (width - 2 * BUTTON - segmentW) / 2f, segmentW, width - BUTTON)

    /**
     * What a touch at ([x], [y]) (row coordinates, y from the row's top) lands on, [extra] dp more generous on every
     * side (0 for a press, [RETAIN] to keep one). Later siblings sit on top in React Native, so lyrics wins over the
     * segment, which wins over the queue button.
     */
    fun hit(x: Float, y: Float, row: Row, outputW: Float, timerW: Float, hasTimer: Boolean, extra: Float = 0f): Target {
        val s = SLOP + extra
        if (x >= row.lyricsX - s && x <= row.lyricsX + BUTTON + s && y >= -s && y <= ROW_H + s) return Target.LYRICS
        if (y >= -extra && y <= ROW_H + extra) {
            if (x >= row.segmentX - extra && x < row.segmentX + outputW) return Target.OUTPUT
            if (hasTimer && x >= row.segmentX + outputW && x <= row.segmentX + outputW + timerW + extra) return Target.TIMER
        }
        if (x >= row.queueX - s && x <= row.queueX + BUTTON + s && y >= -s && y <= ROW_H + s) return Target.QUEUE
        return Target.NONE
    }
}
