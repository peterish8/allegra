package com.lyricflow.app.views

/**
 * The layout of the "More" menu's items (the tiles across the top and the rows under them), ported from the styles in
 * `MoreMenu.tsx` (`tiles`, `tile`, `rows`, `row`, `rule`). All in dp; pure, so it is tested on the JVM. Items are
 * numbered tiles first, then rows, as in `MORE_ITEMS`.
 */
object MoreMenuGeometry {
    const val TILES = 3
    const val TILE_H = 78f
    const val TILE_GAP = 8f
    const val TILE_RADIUS = 18f
    const val TILE_CONTENT_GAP = 7f

    const val ROWS_TOP_GAP = 8f
    const val ROWS_RADIUS = 18f
    const val ROW_MIN_H = 58f
    const val ROW_PAD_X = 14f
    const val ROW_ICON_GAP = 14f
    const val ROW_TEXT_GAP = 2f
    const val RULE_INSET = 50f

    /** Pressable keeps a press alive while the finger is within this much of the target (its default retention). */
    const val RETAIN = 20f
    const val RETAIN_BOTTOM = 30f

    /** `riseIn`: item [index] starts 50 ms in and each one after waits 30 ms more. */
    fun delayMs(index: Int): Long = 50L + 30L * index

    fun tileWidth(width: Float): Float = (width - (TILES - 1) * TILE_GAP) / TILES

    fun tileLeft(index: Int, width: Float): Float = index * (tileWidth(width) + TILE_GAP)

    /** Top of row [row] (0-based among the rows), with a [hairline] rule between rows. */
    fun rowTop(row: Int, hairline: Float): Float = TILE_H + ROWS_TOP_GAP + row * (ROW_MIN_H + hairline)

    /** The height the items take: the tiles, then the rows block when there are rows. */
    fun contentHeight(rows: Int, hairline: Float): Float =
        TILE_H + if (rows > 0) ROWS_TOP_GAP + ROW_MIN_H * rows + hairline * (rows - 1) else 0f

    class Rect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
        fun contains(x: Float, y: Float) = x >= left && x <= right && y >= top && y <= bottom
    }

    /** The area of item [index] (tiles 0 until [TILES], then rows). */
    fun area(index: Int, width: Float, hairline: Float): Rect =
        if (index < TILES) {
            val l = tileLeft(index, width)
            Rect(l, 0f, l + tileWidth(width), TILE_H)
        } else {
            val top = rowTop(index - TILES, hairline)
            Rect(0f, top, width, top + ROW_MIN_H)
        }

    /** The item a touch at ([x], [y]) lands on among [count] items, or -1. */
    fun hit(x: Float, y: Float, count: Int, width: Float, hairline: Float): Int {
        for (i in 0 until count) if (area(i, width, hairline).contains(x, y)) return i
        return -1
    }

    /** Whether a press that began on [index] is alive at ([x], [y]): its area widened by the retention. */
    fun within(index: Int, x: Float, y: Float, width: Float, hairline: Float): Boolean {
        val a = area(index, width, hairline)
        return x >= a.left - RETAIN && x <= a.right + RETAIN && y >= a.top - RETAIN && y <= a.bottom + RETAIN_BOTTOM
    }

    /** A tile's icon and label, centred as a block: the icon box, a 7 gap, the label line. Offset of the icon box's top. */
    fun tileContentTop(iconBoxH: Float, labelH: Float): Float = (TILE_H - (iconBoxH + TILE_CONTENT_GAP + labelH)) / 2f

    /** A row's text block (label, then a 2 gap and the hint when there is one) centred in the row: offset of its top. */
    fun rowTextTop(rowH: Float, labelH: Float, hintH: Float, hasHint: Boolean): Float {
        val block = labelH + if (hasHint) ROW_TEXT_GAP + hintH else 0f
        return (rowH - block) / 2f
    }
}
