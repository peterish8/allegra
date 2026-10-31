package com.lyricflow.app.island

import android.graphics.Color

/**
 * The open card's colours, read from the cover (IslandArt): a deep tone at the top (where the black pill was),
 * the cover's colour below, a light accent for the level bars and a second colour for the drifting light.
 */
data class IslandColors(val top: Int, val bottom: Int, val accent: Int, val second: Int = bottom) {
    companion object {
        /** Nothing loaded, or a cover with no colour to speak of. */
        val NEUTRAL = IslandColors(
            top = Color.rgb(12, 12, 16),
            bottom = Color.rgb(40, 40, 52),
            accent = Color.WHITE,
            second = Color.rgb(30, 30, 44),
        )
    }
}
