package com.lyricflow.app.island

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import androidx.annotation.OptIn
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
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
    class Art(val bitmap: Bitmap, val colors: IslandColors?)

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

    /** [onDone] runs on the main thread with the cover and its colours, or nulls when there is none. */
    fun load(metadata: MediaMetadata, onDone: (Bitmap?, IslandColors?) -> Unit) {
        val request = ++generation
        val key = keyOf(metadata)
        if (key == null) {
            onDone(null, null)
            return
        }
        cache.get(key)?.let {
            onDone(it.bitmap, it.colors)
            return
        }
        fetch(key, metadata) { art -> if (request == generation) onDone(art?.bitmap, art?.colors) }
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
            val art = bitmap?.let { Art(it, IslandPalette.colorsOf(it)) }
            main.post {
                pending -= key
                if (art != null) cache.put(key, art)
                onDone(art)
            }
        }, executor)
    }

    /** What identifies a cover: its address, or the embedded picture when the song has no address. */
    private fun keyOf(metadata: MediaMetadata): String? {
        metadata.artworkUri?.let { return it.toString() }
        val data = metadata.artworkData ?: return null
        return "data:${data.size}:${data.contentHashCode()}"
    }

    private companion object {
        const val MAX_SIZE_PX = 256
        const val CACHE_SIZE = 16
    }
}
