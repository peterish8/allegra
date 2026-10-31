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

    /** Pressable keeps a press alive while the finger is within this much of the target (its default retention offsets). */
    const val RETAIN = 20f
    const val RETAIN_BOTTOM = 30f

    enum class Target { NONE, QUEUE, OUTPUT, TIMER, LYRICS }

    /** A segment half: at least 64 wide, 16 of padding each side, the icon and (timer only) a label after a 6 gap. */
    fun halfWidth(iconDp: Float, labelDp: Float): Float =
        max(HALF_MIN_W, 2 * HALF_PAD + iconDp + (if (labelDp > 0f) HALF_GAP + labelDp else 0f))

    /** Where the three items sit in a row [width] wide: `justifyContent: space-between`. x of each left edge. */
    class Row(val queueX: Float, val segmentX: Float, val segmentW: Float, val lyricsX: Float)

    fun row(width: Float, segmentW: Float): Row =
        Row(0f, BUTTON + (width - 2 * BUTTON - segmentW) / 2f, segmentW, width - BUTTON)

    /**
     * What a touch at ([x], [y]) (row coordinates, y from the row's top) lands on. Later siblings sit on top in React
     * Native, so lyrics wins over the segment, which wins over the queue button where their areas overlap.
     */
    fun hit(x: Float, y: Float, row: Row, outputW: Float, timerW: Float, hasTimer: Boolean): Target {
        if (inButton(x, y, row.lyricsX)) return Target.LYRICS
        if (y >= 0f && y <= ROW_H) {
            if (x >= row.segmentX && x < row.segmentX + outputW) return Target.OUTPUT
            if (hasTimer && x >= row.segmentX + outputW && x <= row.segmentX + outputW + timerW) return Target.TIMER
        }
        if (inButton(x, y, row.queueX)) return Target.QUEUE
        return Target.NONE
    }

    private fun inButton(x: Float, y: Float, left: Float) =
        x >= left - SLOP && x <= left + BUTTON + SLOP && y >= -SLOP && y <= ROW_H + SLOP

    /**
     * Whether a press that started on [target] is still alive with the finger at ([x], [y]): inside that item's own
     * area (the buttons with their slop) widened by Pressable's retention (20 on three sides, 30 below). It tests only
     * the pressed item, so sliding over a neighbour does not end the press.
     */
    fun within(target: Target, x: Float, y: Float, row: Row, outputW: Float, timerW: Float): Boolean {
        val left: Float
        val right: Float
        val top: Float
        val bottom: Float
        when (target) {
            Target.QUEUE -> { left = row.queueX - SLOP; right = row.queueX + BUTTON + SLOP; top = -SLOP; bottom = ROW_H + SLOP }
            Target.LYRICS -> { left = row.lyricsX - SLOP; right = row.lyricsX + BUTTON + SLOP; top = -SLOP; bottom = ROW_H + SLOP }
            Target.OUTPUT -> { left = row.segmentX; right = row.segmentX + outputW; top = 0f; bottom = ROW_H }
            Target.TIMER -> { left = row.segmentX + outputW; right = row.segmentX + outputW + timerW; top = 0f; bottom = ROW_H }
            Target.NONE -> return false
        }
        return x >= left - RETAIN && x <= right + RETAIN && y >= top - RETAIN && y <= bottom + RETAIN_BOTTOM
    }
}
