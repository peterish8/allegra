package com.lyricflow.app.views

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextPaint
import android.util.LruCache
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import com.google.common.util.concurrent.MoreExecutors
import com.lyricflow.app.island.IslandFonts
import com.lyricflow.app.queue.QueueTile
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Song covers for the native lists (Up next, Library): one decoded-bitmap cache shared by every list in the process, so a
 * cover loaded for one list is on screen at once in the other. Pictures are cropped to the centre square and scaled to
 * the slot's own pixels off the main thread, so the cache holds small squares and a long list costs a few megabytes.
 *
 * Main-thread only, except the decode, which runs on [executor] and hands its result back with `post`.
 */
@OptIn(UnstableApi::class)
internal object CoverCache {
    private const val BYTES = 12 * 1024 * 1024
    private const val MIN_DECODE_PX = 96

    class Entry(val bitmap: Bitmap, val shader: BitmapShader, val at: Long)

    private val main = Handler(Looper.getMainLooper())
    private val executor = Executors.newFixedThreadPool(2) { r ->
        Thread(r, "cover-art").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 }
    }
    private val cache = object : LruCache<String, Entry>(BYTES) {
        override fun sizeOf(key: String, value: Entry) = value.bitmap.byteCount
    }
    private val failed = HashSet<String>()
    private val pending = HashSet<String>()
    private val listeners = LinkedHashSet<Runnable>()
    private val loaders = HashMap<Int, DataSourceBitmapLoader>()

    private fun key(uri: String, px: Int) = "$uri@$px"

    fun get(uri: String, px: Int): Entry? = cache.get(key(uri, px))

    fun hasFailed(uri: String, px: Int) = key(uri, px) in failed

    /** How far the picture's fade-in (over [fadeMs]) has got at [now], 0..1: a cover that was cached a while ago is 1. */
    fun fade(entry: Entry, now: Long, fadeMs: Long): Float = ((now - entry.at) / fadeMs.toFloat()).coerceIn(0f, 1f)

    /** [listener] runs on the main thread whenever a cover lands (every list redraws). Add on attach, remove on detach. */
    fun addListener(listener: Runnable) { listeners += listener }

    fun removeListener(listener: Runnable) { listeners -= listener }

    /** Starts loading [uri] at [px] pixels square unless it is loading, loaded or failed. */
    fun request(context: Context, uri: String, px: Int) {
        val k = key(uri, px)
        if (k in failed || !pending.add(k)) return
        val loader = loaders.getOrPut(px) {
            DataSourceBitmapLoader(
                MoreExecutors.listeningDecorator(executor),
                DefaultDataSource.Factory(context.applicationContext), null,
                // Media3 halves the decode until the longer side fits, so ask for plenty: `squareCover` crops and scales it.
                max(MIN_DECODE_PX, px * 4),
            )
        }
        val future = try {
            loader.loadBitmap(Uri.parse(uri))
        } catch (_: Throwable) {
            pending.remove(k)
            failed.add(k)
            return
        }
        future.addListener({
            // Cropped and scaled to the slot here, off the main thread.
            val bitmap = try {
                future.get()?.let { squareCover(it, px) }
            } catch (_: Throwable) {
                null
            }
            main.post {
                pending.remove(k)
                if (bitmap != null) {
                    cache.put(k, Entry(bitmap, BitmapShader(bitmap, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP), SystemClock.uptimeMillis()))
                } else {
                    failed.add(k)
                }
                for (l in listeners.toList()) l.run()
            }
        }, executor)
    }

    /** contentFit "cover" at the slot's own pixels: the centre square of the picture, scaled to [px] (never enlarged). */
    private fun squareCover(src: Bitmap, px: Int): Bitmap {
        val side = min(src.width, src.height)
        val x = (src.width - side) / 2
        val y = (src.height - side) / 2
        val square = if (side == src.width && side == src.height) src else Bitmap.createBitmap(src, x, y, side, side)
        return if (square.width > px) Bitmap.createScaledBitmap(square, px, px, true) else square
    }
}

/**
 * One list's way of drawing a song's cover into a square slot: the picture fading in over the song's base colour, the
 * generated cover (`GeneratedArtwork`) when there is no picture or it fails. Holds its own paints, so one lives in each view.
 */
internal class CoverPainter(private val context: Context, private val sizePx: Float, private val radiusPx: Float, private val fadeMs: Long) {
    private val px = sizePx.roundToInt().coerceAtLeast(1)
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val glyphPaint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()
    private val clip = Path()
    private val matrix = Matrix()
    private val tiles = HashMap<String, GeneratedTile>()

    /** Forgets generated covers of songs no longer shown. */
    fun keepOnly(keys: Set<String>) { tiles.keys.retainAll(keys) }

    /**
     * Draws the cover for [uri] (null for none) at ([left], [top]); [tileKey] names the song's generated cover. True while a
     * fade is still running, so the caller keeps redrawing.
     */
    fun draw(canvas: Canvas, uri: String?, tile: QueueTile, tileKey: String, left: Float, top: Float): Boolean {
        rect.set(left, top, left + sizePx, top + sizePx)
        val entry = if (uri != null) CoverCache.get(uri, px) else null
        if (entry == null) {
            if (uri != null && !CoverCache.hasFailed(uri, px)) {
                CoverCache.request(context, uri, px)
                // The base colour while the picture loads, as the React Native cover does.
                fill.color = tile.base
                canvas.drawRoundRect(rect, radiusPx, radiusPx, fill)
            } else {
                drawGenerated(canvas, tile, tileKey, left, top)
            }
            return false
        }
        val a = CoverCache.fade(entry, SystemClock.uptimeMillis(), fadeMs)
        if (a < 1f) {
            fill.color = tile.base
            canvas.drawRoundRect(rect, radiusPx, radiusPx, fill)
        }
        // The cache holds the centre square already scaled to the slot: it fills the square.
        val scale = max(sizePx / entry.bitmap.width, sizePx / entry.bitmap.height)
        matrix.setScale(scale, scale)
        matrix.postTranslate(left + (sizePx - entry.bitmap.width * scale) / 2f, top + (sizePx - entry.bitmap.height * scale) / 2f)
        entry.shader.setLocalMatrix(matrix)
        imagePaint.shader = entry.shader
        imagePaint.alpha = (255 * a).roundToInt()
        canvas.drawRoundRect(rect, radiusPx, radiusPx, imagePaint)
        imagePaint.shader = null
        return a < 1f
    }

    /** What GeneratedArtwork draws: a duotone from the song's own title, a spark, grooves and a monogram. */
    private fun drawGenerated(canvas: Canvas, tile: QueueTile, key: String, left: Float, top: Float) {
        val t = tiles.getOrPut(key) { GeneratedTile(tile, sizePx) }
        canvas.save()
        clip.reset()
        clip.addRoundRect(rect, radiusPx, radiusPx, Path.Direction.CW)
        canvas.clipPath(clip)
        canvas.translate(left, top)
        t.draw(canvas, sizePx, glyphPaint, stroke)
        canvas.restore()
    }

    private class GeneratedTile(private val t: QueueTile, size: Float) {
        private val base = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = if (t.variant == 1) {
                LinearGradient(size, 0f, 0f, size, t.base, t.mid, Shader.TileMode.CLAMP)
            } else {
                LinearGradient(0f, 0f, size, size, t.base, t.mid, Shader.TileMode.CLAMP)
            }
        }
        private val spark = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            val cx = if (t.variant == 2) 0.22f else 0.78f
            shader = RadialGradient(cx * size, 0.22f * size, 0.62f * size, withAlpha(t.spark, 0.55f), withAlpha(t.spark, 0f), Shader.TileMode.CLAMP)
        }
        private val dark = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = RadialGradient(0.3f * size, size, 0.7f * size, withAlpha(t.base, 0.7f), withAlpha(t.base, 0f), Shader.TileMode.CLAMP)
        }

        fun draw(canvas: Canvas, size: Float, glyph: TextPaint, stroke: Paint) {
            canvas.drawRect(0f, 0f, size, size, base)
            canvas.drawRect(0f, 0f, size, size, spark)
            canvas.drawRect(0f, 0f, size, size, dark)
            stroke.shader = null
            stroke.strokeWidth = 0.008f * size
            val cx = if (t.variant == 2) 0.86f * size else 0.14f * size
            for ((n, r) in floatArrayOf(34f, 46f, 58f).withIndex()) {
                stroke.color = withAlpha(t.spark, 0.14f - n * 0.03f)
                canvas.drawCircle(cx, 0.86f * size, r / 100f * size, stroke)
            }
            glyph.typeface = IslandFonts.bold
            glyph.textSize = size * 0.9f
            glyph.color = withAlpha(t.spark, 0.28f)
            // GeneratedArtwork: letterSpacing -4 on a 48 dp cover with a 0.9 x size glyph, in em.
            glyph.letterSpacing = -4f / (48f * 0.9f)
            val w = glyph.measureText(t.glyph)
            canvas.drawText(t.glyph, size - w + size * 0.08f, size + size * 0.2f - glyph.descent(), glyph)
        }

        private fun withAlpha(color: Int, a: Float) = Color.argb((255 * a).roundToInt().coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))
    }
}
