package com.lyricflow.app.views

/**
 * The layout of a song row in the Library and the download lists, ported from `TrackRow` in `StreamItems.tsx`
 * (`styles.row`: 20 dp side padding, 12 dp gap, a 48 dp cover, the title and meta lines, an optional 44 dp trailing button).
 * All in dp, with the row's left edge at x = 0 and its top at y = 0; pure, so it is tested on the JVM.
 */
object TrackRowGeometry {
    const val HEIGHT = 64f
    const val PAD_X = 20f
    const val ART = 48f
    const val GAP = 12f

    /** The playing mark: a 20 dp disc that hangs 4 dp off the cover's bottom right, with a 2 dp ring in the page colour. */
    const val DOT = 20f
    const val DOT_OFFSET = 4f
    const val DOT_RING = 2f
    const val DOT_ICON = 11f

    /** `trailing`: a 44 dp round button with `hitSlop={10}`, and a 22 dp icon. */
    const val TRAIL = 44f
    const val TRAIL_SLOP = 10f
    const val TRAIL_ICON = 22f

    /** The meta line sits 2 dp under the title; a download's progress line 6 dp under that, 2 dp high. */
    const val META_TOP = 2f
    const val PROGRESS_TOP = 6f
    const val PROGRESS_H = 2f

    /** Pressable keeps a press alive while the finger is within this much of the target (its default retention). */
    const val RETAIN = 20f
    const val RETAIN_BOTTOM = 30f

    /** `delayLongPress` of a Pressable. */
    const val LONG_PRESS_MS = 500L

    /** `Motion.pressScale`, applied to the trailing button while it is pressed. */
    const val PRESS_SCALE = 0.94f

    fun artTop(): Float = (HEIGHT - ART) / 2f

    fun textLeft(): Float = PAD_X + ART + GAP

    /** Where the text column ends: the right padding, or the trailing button and the gap before it. */
    fun textRight(width: Float, trailing: Boolean): Float = width - PAD_X - (if (trailing) TRAIL + GAP else 0f)

    fun trailLeft(width: Float): Float = width - PAD_X - TRAIL

    fun trailTop(): Float = (HEIGHT - TRAIL) / 2f

    /** The playing disc's centre. */
    fun dotCenterX(): Float = PAD_X + ART + DOT_OFFSET - DOT / 2f

    fun dotCenterY(): Float = artTop() + ART + DOT_OFFSET - DOT / 2f

    /** The text block's height: the title, the meta line and, for a download, the progress line. */
    fun blockHeight(titleH: Float, metaH: Float, progress: Boolean): Float =
        titleH + META_TOP + metaH + (if (progress) PROGRESS_TOP + PROGRESS_H else 0f)

    /** The block is centred in the row (`alignItems: 'center'`); this is its top. */
    fun blockTop(blockH: Float): Float = (HEIGHT - blockH) / 2f

    /** A download's fill: it never reads empty (`Math.max(0.02, ...)`) and never passes the track. */
    fun progressFill(progress: Float): Float = progress.coerceIn(0.02f, 1f)

    /** Whether the touch ([x], [y]) is on the trailing button, counting its slop. */
    fun onTrailing(x: Float, y: Float, width: Float): Boolean {
        val l = trailLeft(width) - TRAIL_SLOP
        val t = trailTop() - TRAIL_SLOP
        return x >= l && x <= l + TRAIL + 2 * TRAIL_SLOP && y >= t && y <= t + TRAIL + 2 * TRAIL_SLOP
    }

    /** Whether a press that began on the row is still alive at ([x], [y]): the row's area plus the retention. */
    fun rowAlive(x: Float, y: Float, width: Float): Boolean =
        x >= -RETAIN && x <= width + RETAIN && y >= -RETAIN && y <= HEIGHT + RETAIN_BOTTOM

    /** Whether a press that began on the trailing button is still alive: its area, slop and retention. */
    fun trailingAlive(x: Float, y: Float, width: Float): Boolean {
        val l = trailLeft(width) - TRAIL_SLOP - RETAIN
        val t = trailTop() - TRAIL_SLOP - RETAIN
        return x >= l && x <= trailLeft(width) + TRAIL + TRAIL_SLOP + RETAIN && y >= t && y <= trailTop() + TRAIL + TRAIL_SLOP + RETAIN_BOTTOM
    }

    /**
     * The tallest the system font scale may be for the row to keep its 64 dp: the block is 1.2 x each line's size
     * (SF Pro Text's top..bottom), and the cover (48 dp) is the row's content height until the block passes it.
     */
    fun fitsAtFontScale(fontScale: Float, progress: Boolean): Boolean {
        val block = (16f + 13f) * LINE * fontScale + META_TOP + (if (progress) PROGRESS_TOP + PROGRESS_H else 0f)
        return block <= ART
    }

    private const val LINE = 1.2f
}
