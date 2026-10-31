package com.lyricflow.app.views

/**
 * The round glass buttons at the end of Now Playing's title row (fullscreen lyrics, song options, like), ported from
 * `roundGlass` and the row's `gap: 10` in `NowPlayingControls.tsx`. All in dp; pure, so it is tested on the JVM.
 * The buttons are laid left to right in the order [Button.FULLSCREEN], [Button.MORE], [Button.LIKE], those that are
 * present; the cluster's left edge is x = 0 and its top y = 0.
 */
object SongActionsGeometry {
    const val BUTTON = 38f
    const val GAP = 10f

    /** Pressable keeps a press alive while the finger is within this much of the target (its default retention). */
    const val RETAIN = 20f
    const val RETAIN_BOTTOM = 30f

    enum class Button { FULLSCREEN, MORE, LIKE }

    /** The buttons shown, in order. */
    fun shown(fullscreen: Boolean, more: Boolean): List<Button> = buildList {
        if (fullscreen) add(Button.FULLSCREEN)
        if (more) add(Button.MORE)
        add(Button.LIKE)
    }

    fun clusterWidth(count: Int): Float = if (count <= 0) 0f else count * BUTTON + (count - 1) * GAP

    fun left(index: Int): Float = index * (BUTTON + GAP)

    /**
     * The button a touch at ([x], [y]) lands on, each button's area widened by [slop] (`hitSlop`). Later siblings are on
     * top in React Native, so where two slops overlap the later button wins. Null when none.
     */
    fun hit(x: Float, y: Float, count: Int, slop: Float): Int? {
        for (i in count - 1 downTo 0) if (inside(x, y, i, slop)) return i
        return null
    }

    /** Whether a press that began on button [index] is still alive at ([x], [y]): its area, slop and retention. */
    fun within(index: Int, x: Float, y: Float, slop: Float): Boolean {
        val l = left(index) - slop - RETAIN
        val r = left(index) + BUTTON + slop + RETAIN
        return x >= l && x <= r && y >= -slop - RETAIN && y <= BUTTON + slop + RETAIN_BOTTOM
    }

    private fun inside(x: Float, y: Float, index: Int, slop: Float) =
        x >= left(index) - slop && x <= left(index) + BUTTON + slop && y >= -slop && y <= BUTTON + slop

    /**
     * The like glyph's morph at progress [p] (0 = outline, 1 = filled), from `MorphIcon`: the incoming glyph turns from
     * -45 degrees and grows from 0.6, the outgoing one turns to 45 degrees and shrinks to 0.6.
     */
    class Morph(val onAlpha: Float, val onRotate: Float, val onScale: Float, val offAlpha: Float, val offRotate: Float, val offScale: Float)

    fun morph(p: Float): Morph = Morph(
        onAlpha = p.coerceIn(0f, 1f),
        onRotate = (1f - p) * -45f,
        onScale = 0.6f + 0.4f * p,
        offAlpha = (1f - p).coerceIn(0f, 1f),
        offRotate = p * 45f,
        offScale = 1f - 0.4f * p,
    )
}
