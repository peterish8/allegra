package com.lyricflow.app.island

import android.graphics.Bitmap
import android.graphics.Color
import androidx.core.graphics.ColorUtils
import androidx.palette.graphics.Palette

/**
 * Reads the island's four colours off a cover. The island card and the in-app glow behind the lyrics
 * (NativeFlowGlowView) both use it, so the two lights are made of the same colours.
 */
object IslandPalette {
    fun colorsOf(bitmap: Bitmap): IslandColors? = try {
        val palette = Palette.from(bitmap).maximumColorCount(12).generate()
        val main = palette.vibrantSwatch ?: palette.darkVibrantSwatch ?: palette.dominantSwatch
        val deep = palette.darkMutedSwatch ?: palette.darkVibrantSwatch ?: palette.dominantSwatch
        val light = palette.lightVibrantSwatch ?: palette.vibrantSwatch ?: palette.dominantSwatch
        // The second light, as the website's second field: another of the cover's colours where it has one.
        val other = palette.mutedSwatch ?: palette.darkVibrantSwatch ?: palette.lightMutedSwatch ?: main
        if (main == null || deep == null) {
            null
        } else {
            IslandColors(
                // White text has to read on both, so the tones are held dark whatever the cover is.
                top = tone(deep.rgb, 0.01f, 0.025f, minSaturation = 0.3f),
                bottom = tone(main.rgb, 0.34f, 0.48f, minSaturation = 0.55f),
                accent = tone(light?.rgb ?: Color.WHITE, 0.62f, 0.84f, minSaturation = 0f),
                second = tone(other?.rgb ?: main.rgb, 0.30f, 0.46f, minSaturation = 0.45f),
            )
        }
    } catch (_: Throwable) {
        null
    }

    private fun tone(color: Int, minLight: Float, maxLight: Float, minSaturation: Float): Int {
        val hsl = FloatArray(3)
        ColorUtils.colorToHSL(color, hsl)
        // A grey cover stays grey; a coloured one is lifted to a colour you can see under the text.
        if (hsl[1] > 0.12f) hsl[1] = maxOf(hsl[1], minSaturation)
        hsl[2] = hsl[2].coerceIn(minLight, maxLight)
        return ColorUtils.HSLToColor(hsl)
    }
}
