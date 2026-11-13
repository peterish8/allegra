package com.lyricflow.app.island

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Shader
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.Executors

/**
 * Small covers for the island's playlist and song rows, loaded off the main thread (file, content or https, as
 * IslandArt loads the playing cover) and kept in a small cache with their shader, so scrolling never decodes or
 * allocates on a frame. [onLoaded] runs on the main thread when a cover arrives.
 */
@OptIn(UnstableApi::class)
class IslandThumbs(context: Context, private val onLoaded: () -> Unit) {
    class Thumb(val bitmap: Bitmap) {
        val shader = BitmapShader(bitmap, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    }

    // Its own thread: never queued behind the notification's (or the playing cover's) network loads.
    private val executor = MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor { r ->
        Thread(r, "island-thumbs").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 }
    })
    private val loader = DataSourceBitmapLoader(executor, DefaultDataSource.Factory(context.applicationContext), null, MAX_SIZE_PX)
    private val main = Handler(Looper.getMainLooper())
    private val cache = LruCache<String, Thumb>(MAX_COUNT)
    private val pending = HashSet<String>()
    private val failed = HashSet<String>()
    private var generation = 0

    /** The cover for [uri] if it is ready; otherwise null, and it starts loading. */
    fun get(uri: String): Thumb? {
        if (uri.isEmpty()) return null
        cache.get(uri)?.let { return it }
        if (uri in pending || uri in failed) return null
        pending += uri
        val request = generation
        val future = try {
            loader.loadBitmap(Uri.parse(uri))
        } catch (_: Throwable) {
            null
        }
        if (future == null) {
            pending -= uri
            failed += uri
            return null
        }
        future.addListener({
            val bitmap = try {
                future.get()
            } catch (_: Throwable) {
                null
            }
            main.post {
                if (request != generation) return@post
                pending -= uri
                if (bitmap == null) failed += uri else cache.put(uri, Thumb(bitmap))
                onLoaded()
            }
        }, executor)
        return null
    }

    /** Forgets everything (the island left the screen); answers still in flight are ignored. */
    fun clear() {
        generation++
        pending.clear()
        failed.clear()
        cache.evictAll()
    }

    private companion object {
        const val MAX_SIZE_PX = 144
        const val MAX_COUNT = 90
    }
}
