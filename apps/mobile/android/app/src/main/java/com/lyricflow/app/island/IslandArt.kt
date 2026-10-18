package com.lyricflow.app.island

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import androidx.annotation.OptIn
import androidx.core.graphics.ColorUtils
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import androidx.palette.graphics.Palette
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.Executors

/**
 * Loads the playing song's cover small (file, content or https, as the session has it) and reads its colours
 * off the main thread. Only the latest request answers, so a quick run of skips never lands an old cover.
 *
 * The island has its own two loader threads. Media3's default loader is one thread shared with the media
 * notification's artwork: one slow https cover held up every cover queued behind it, so a downloaded song sat on a
 * grey tile, with the last song's colours, for as long as the network took to give up (about 20 s). Covers and
 * their colours are also kept by address, so a song played again, or the next song (prefetched), shows at once.
 */
@OptIn(UnstableApi::class)
class IslandArt(context: Context) {
    class Art(val bitmap: Bitmap, val colors: IslandColors?, val glow: Bitmap?)

    private val executor = MoreExecutors.listeningDecorator(Executors.newFixedThreadPool(2) { r ->
        Thread(r, "island-art").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 }
    })
    private val loader = DataSourceBitmapLoader(executor, DefaultDataSource.Factory(context.applicationContext), null, MAX_SIZE_PX)
    private val main = Handler(Looper.getMainLooper())
    private val cache = LruCache<String, Art>(CACHE_SIZE)
    private val pending = HashSet<String>()
    private var generation = 0

    /** The cover already decoded for [metadata], if any: shown on the same frame as the song's title. */
    fun cached(metadata: MediaMetadata): Art? = keyOf(metadata)?.let { cache.get(it) }

    /** [onDone] runs on the main thread with the cover, its colours and its light (IslandGlow), or nulls when there is none. */
    fun load(metadata: MediaMetadata, onDone: (Bitmap?, IslandColors?, Bitmap?) -> Unit) {
        val request = ++generation
        val key = keyOf(metadata)
        if (key == null) {
            onDone(null, null, null)
            return
        }
        cache.get(key)?.let {
            onDone(it.bitmap, it.colors, it.glow)
            return
        }
        fetch(key, metadata) { art -> if (request == generation) onDone(art?.bitmap, art?.colors, art?.glow) }
    }

    /** Decodes the cover of a song that is about to play (the next one), so a skip finds it ready. */
    fun prefetch(metadata: MediaMetadata) {
        val key = keyOf(metadata) ?: return
        if (cache.get(key) != null || key in pending) return
        fetch(key, metadata) { }
    }

    fun cancel() {
        generation++
    }

    private fun fetch(key: String, metadata: MediaMetadata, onDone: (Art?) -> Unit) {
        pending += key
        // The app's chosen cover (artworkUri) comes first; a file's own embedded picture only when there is no address.
        val future: ListenableFuture<Bitmap>? = try {
            val uri = metadata.artworkUri
            val data = metadata.artworkData
            when {
                uri != null -> loader.loadBitmap(uri)
                data != null -> loader.decodeBitmap(data)
                else -> null
            }
        } catch (_: Throwable) {
            null
        }
        if (future == null) {
            pending -= key
            onDone(null)
            return
        }
        future.addListener({
            val bitmap = try {
                future.get()
            } catch (_: Throwable) {
                null
            }
            val art = bitmap?.let { Art(it, colorsOf(it), glowOf(it)) }
            main.post {
                pending -= key
                if (art != null) cache.put(key, art)
                onDone(art)
            }
        }, executor)
    }

    private fun glowOf(bitmap: Bitmap): Bitmap? = try {
        IslandGlow.fromCover(bitmap)
    } catch (_: Throwable) {
        null
    }

    /** What identifies a cover: its address, or the embedded picture when the song has no address. */
    private fun keyOf(metadata: MediaMetadata): String? {
        metadata.artworkUri?.let { return it.toString() }
        val data = metadata.artworkData ?: return null
        return "data:${data.size}:${data.contentHashCode()}"
    }

    private fun colorsOf(bitmap: Bitmap): IslandColors? = try {
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

    private companion object {
        const val MAX_SIZE_PX = 256
        const val CACHE_SIZE = 16
    }
}
