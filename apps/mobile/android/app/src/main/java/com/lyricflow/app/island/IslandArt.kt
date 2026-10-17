package com.lyricflow.app.island

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.core.graphics.ColorUtils
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import androidx.palette.graphics.Palette

/** The open card's colours: a deep tone at the top (where the black pill was), the cover's colour below. */
data class IslandColors(val top: Int, val bottom: Int, val accent: Int) {
    companion object {
        /** Nothing loaded, or a cover with no colour to speak of. */
        val NEUTRAL = IslandColors(top = Color.rgb(12, 12, 16), bottom = Color.rgb(40, 40, 52), accent = Color.WHITE)
    }
}

/**
 * Loads the playing song's cover small (file, content or https, as the session has it) and reads its colours
 * off the main thread. Only the latest request answers, so a quick run of skips never lands an old cover.
 */
@OptIn(UnstableApi::class)
class IslandArt(context: Context) {
    private val executor = DataSourceBitmapLoader.DEFAULT_EXECUTOR_SERVICE.get()
    private val loader = DataSourceBitmapLoader(executor, DefaultDataSource.Factory(context.applicationContext), null, MAX_SIZE_PX)
    private val main = Handler(Looper.getMainLooper())
    private var generation = 0

    /** [onDone] runs on the main thread with the cover and its colours, or nulls when there is none. */
    fun load(metadata: MediaMetadata, onDone: (Bitmap?, IslandColors?) -> Unit) {
        val request = ++generation
        val future = try {
            loader.loadBitmapFromMetadata(metadata)
        } catch (_: Throwable) {
            null
        }
        if (future == null) {
            onDone(null, null)
            return
        }
        future.addListener({
            val bitmap = try {
                future.get()
            } catch (_: Throwable) {
                null
            }
            val colors = bitmap?.let { colorsOf(it) }
            main.post { if (request == generation) onDone(bitmap, colors) }
        }, executor)
    }

    fun cancel() {
        generation++
    }

    private fun colorsOf(bitmap: Bitmap): IslandColors? = try {
        val palette = Palette.from(bitmap).maximumColorCount(12).generate()
        val main = palette.vibrantSwatch ?: palette.darkVibrantSwatch ?: palette.dominantSwatch
        val deep = palette.darkMutedSwatch ?: palette.darkVibrantSwatch ?: palette.dominantSwatch
        val light = palette.lightVibrantSwatch ?: palette.vibrantSwatch ?: palette.dominantSwatch
        if (main == null || deep == null) {
            null
        } else {
            IslandColors(
                // White text has to read on both, so the tones are held dark whatever the cover is.
                top = tone(deep.rgb, 0.01f, 0.025f, minSaturation = 0.3f),
                bottom = tone(main.rgb, 0.34f, 0.48f, minSaturation = 0.55f),
                accent = tone(light?.rgb ?: Color.WHITE, 0.62f, 0.84f, minSaturation = 0f),
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

    private companion object {
        const val MAX_SIZE_PX = 256
    }
}
