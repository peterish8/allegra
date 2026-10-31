package com.lyricflow.app.views

import android.content.Context
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.LruCache
import android.view.Choreographer
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import com.google.common.util.concurrent.MoreExecutors
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The Android Apple-style Now Playing backdrop. It owns its decoded cover and its short cross-fades, and redraws only
 * while a cover or hero is moving. The React Native Skia component remains the iOS / older-build fallback.
 */
@OptIn(UnstableApi::class)
class NativeAppleBackdropView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private class RoomSlot {
        var uri: String? = null
        var source: Bitmap? = null
        var widthDp = 0f
        var heightDp = 0f
        var density = 0f
        var image: Bitmap? = null

        fun clear() {
            uri = null
            source = null
            widthDp = 0f
            heightDp = 0f
            density = 0f
            image = null
        }
    }

    private val coverListener = Runnable { onCoverCacheChanged() }
    private val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val shadePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val maskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN) }
    private val veilPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN) }
    private val rect = RectF()
    private val roomRect = RectF()
    private val srcRect = Rect()
    private var fallbackShader: Shader? = null
    private var fallbackWidth = 0f
    private var fallbackHeight = 0f
    private var fallbackPaletteHash = 0
    private var shadeShader: Shader? = null
    private var shadeHeight = 0f
    private var heroMaskShader: Shader? = null
    private var heroMaskHeight = 0f
    private var veilMaskShader: Shader? = null
    private var veilMaskHeight = 0f

    private var pendingUri: String? = null
    private var requestedUri: String? = null
    private var pendingPalette = intArrayOf(Color.BLACK, Color.BLACK, Color.BLACK)
    private var pendingFrameWidthDp = 0f
    private var pendingFrameHeightDp = 0f
    private var pendingShowHero = false
    private var pendingVeil = false
    private var uri: String? = null
    private var frameWidthDp = 0f
    private var frameHeightDp = 0f
    private var veil = false
    private var palette = intArrayOf(Color.BLACK, Color.BLACK, Color.BLACK)

    private var previousUri: String? = null
    private var previousBitmap: Bitmap? = null
    private var currentBitmapUri: String? = null
    private var currentBitmap: Bitmap? = null
    private val previousRoom = RoomSlot()
    private val currentRoom = RoomSlot()
    private var fadeStartedAt = 0L
    private var fadeDuration = AppleBackdropGeometry.ROOM_FADE_MS
    private var heroFrom = 0f
    private var heroTarget = 0f
    private var heroStartedAt = 0L
    private var heroInitialized = false
    private var shiftX = 0f
    private var looping = false

    init {
        setWillNotDraw(false)
        setBackgroundColor(Color.TRANSPARENT)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        BackdropArtCache.addListener(coverListener)
    }

    fun setUri(value: String?) { pendingUri = value }
    fun setPrimaryColor(value: String?) { pendingPalette[0] = parseColor(value) }
    fun setSecondaryColor(value: String?) { pendingPalette[1] = parseColor(value) }
    fun setTertiaryColor(value: String?) { pendingPalette[2] = parseColor(value) }
    fun setFrameWidth(widthDp: Double?) { pendingFrameWidthDp = (widthDp ?: 0.0).toFloat().coerceAtLeast(0f) }
    fun setFrameHeight(heightDp: Double?) { pendingFrameHeightDp = (heightDp ?: 0.0).toFloat().coerceAtLeast(0f) }
    fun setShowHero(value: Boolean?) { pendingShowHero = value ?: false }
    fun setVeil(value: Boolean?) { pendingVeil = value ?: false }

    /** Reanimated updates this prop on the UI thread, keeping the finger-following hero off the JS frame loop. */
    fun setShiftX(value: Double?) {
        val next = (value ?: 0.0).toFloat()
        if (abs(next - shiftX) < 0.25f) return
        shiftX = next
        invalidate()
    }

    /** Expo batches ordinary props here so an arriving cover, frame and palette are committed together. */
    fun commit() {
        val now = SystemClock.uptimeMillis()
        val nextUri = pendingUri
        if (uri != nextUri) {
            uri = nextUri
            requestedUri = nextUri
            if (nextUri == null) {
                previousUri = null
                previousBitmap = null
                currentBitmapUri = null
                currentBitmap = null
                previousRoom.clear()
                currentRoom.clear()
            } else {
                BackdropArtCache.get(nextUri)?.let { acceptCover(nextUri, it, now) }
                    ?: BackdropArtCache.request(context, nextUri)
            }
        }

        if (!palette.contentEquals(pendingPalette)) palette = pendingPalette.copyOf()
        frameWidthDp = pendingFrameWidthDp
        frameHeightDp = pendingFrameHeightDp
        veil = pendingVeil

        val nextShowHero = pendingShowHero && !veil
        if (veil) {
            // The video veil never draws the sharp hero, so it must not keep a hero animation clock alive.
            heroFrom = 0f
            heroTarget = 0f
            heroStartedAt = now
            heroInitialized = true
        } else if (!heroInitialized) {
            heroFrom = if (nextShowHero) 1f else 0f
            heroTarget = heroFrom
            heroStartedAt = now
            heroInitialized = true
        } else if (nextShowHero != (heroTarget >= 0.5f)) {
            heroFrom = heroAt(now)
            heroTarget = if (nextShowHero) 1f else 0f
            heroStartedAt = now
        }
        invalidate()
        updateLoop()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        BackdropArtCache.addListener(coverListener)
        requestedUri?.let { BackdropArtCache.request(context, it) }
        onCoverCacheChanged()
        updateLoop()
    }

    override fun onDetachedFromWindow() {
        stopLoop()
        BackdropArtCache.removeListener(coverListener)
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val width = this.width.toFloat()
        val density = resources.displayMetrics.density
        val fullHeight = if (frameHeightDp > 0f) frameHeightDp * density else height.toFloat()
        if (width <= 0f || fullHeight <= 0f) return
        requestedUri?.let { BackdropArtCache.request(context, it) }

        val fade = imageFade(SystemClock.uptimeMillis())
        if (veil) {
            drawVeil(canvas, width, fullHeight, density, fade)
        } else {
            drawRoomAndHero(canvas, width, fullHeight, density, fade)
            drawShade(canvas, width, fullHeight)
        }
    }

    private fun drawRoomAndHero(canvas: Canvas, width: Float, height: Float, density: Float, fade: Float) {
        drawFallback(canvas, width, height)
        drawCoverLayer(canvas, 0, previousUri, previousBitmap, width, height, density, 1f - fade, heroAt(SystemClock.uptimeMillis()), true)
        if (currentBitmap != null) {
            canvas.save()
            val heroHeight = AppleBackdropGeometry.heroHeight(height)
            val scale = AppleBackdropGeometry.settleScale(fade)
            canvas.scale(scale, scale, width / 2f, heroHeight / 2f)
            drawCoverLayer(canvas, 1, uri, currentBitmap, width, height, density, fade, heroAt(SystemClock.uptimeMillis()), true)
            canvas.restore()
        }
    }

    private fun drawVeil(canvas: Canvas, width: Float, height: Float, density: Float, fade: Float) {
        val heroHeight = AppleBackdropGeometry.heroHeight(height)
        val layer = canvas.saveLayer(0f, 0f, width, heroHeight, null)
        drawFallback(canvas, width, height)
        drawCoverLayer(canvas, 0, previousUri, previousBitmap, width, height, density, 1f - fade, 0f, false)
        if (currentBitmap != null) {
            canvas.save()
            val scale = AppleBackdropGeometry.settleScale(fade)
            canvas.scale(scale, scale, width / 2f, heroHeight / 2f)
            drawCoverLayer(canvas, 1, uri, currentBitmap, width, height, density, fade, 0f, false)
            canvas.restore()
        }
        if (veilMaskShader == null || veilMaskHeight != heroHeight) {
            veilMaskHeight = heroHeight
            veilMaskShader = LinearGradient(
                0f, 0f, 0f, heroHeight,
                AppleBackdropGeometry.HERO_MASK_ALPHAS.map { alpha -> Color.argb(((1f - alpha) * 255f).roundToInt(), 0, 0, 0) }.toIntArray(),
                AppleBackdropGeometry.HERO_MASK_POSITIONS,
                Shader.TileMode.CLAMP,
            )
        }
        veilPaint.shader = veilMaskShader
        canvas.drawRect(0f, 0f, width, heroHeight, veilPaint)
        canvas.restoreToCount(layer)
        drawShade(canvas, width, height)
    }

    private fun drawFallback(canvas: Canvas, width: Float, height: Float) {
        val paletteHash = palette.contentHashCode()
        if (fallbackShader == null || fallbackWidth != width || fallbackHeight != height || fallbackPaletteHash != paletteHash) {
            fallbackWidth = width
            fallbackHeight = height
            fallbackPaletteHash = paletteHash
            fallbackShader = LinearGradient(0f, 0f, width, height, palette, null, Shader.TileMode.CLAMP)
        }
        fillPaint.shader = fallbackShader
        fillPaint.alpha = 255
        canvas.drawRect(0f, 0f, width, height, fillPaint)
        fillPaint.shader = null
        fillPaint.color = Color.argb(89, 0, 0, 0)
        canvas.drawRect(0f, 0f, width, height, fillPaint)
    }

    private fun drawCoverLayer(
        canvas: Canvas,
        roomIndex: Int,
        layerUri: String?,
        bitmap: Bitmap?,
        width: Float,
        height: Float,
        density: Float,
        opacity: Float,
        hero: Float,
        drawHero: Boolean,
    ) {
        if (bitmap == null || opacity <= 0f) return
        val bleed = AppleBackdropGeometry.BLEED_DP * density
        val wDp = if (frameWidthDp > 0f) frameWidthDp else width / density
        val hDp = if (frameHeightDp > 0f) frameHeightDp else height / density
        val room = if (layerUri != null) roomFor(roomIndex, layerUri, bitmap, wDp, hDp, density) else null
        if (room != null) {
            imagePaint.alpha = (opacity * 255f).roundToInt().coerceIn(0, 255)
            roomRect.set(-bleed, -bleed, width + bleed, height + bleed)
            canvas.drawBitmap(room, null, roomRect, imagePaint)
        }

        if (drawHero && hero > 0f) {
            val heroHeight = AppleBackdropGeometry.heroHeight(height)
            val shiftPx = shiftX * density
            val heroAlpha = AppleBackdropGeometry.heroOpacity(hero, shiftPx, width) * opacity
            if (heroAlpha > 0f) {
                val heroLayer = canvas.saveLayer(0f, 0f, width, heroHeight, null)
                canvas.translate(shiftPx, 0f)
                val crop = AppleBackdropGeometry.coverCrop(bitmap.width, bitmap.height, width, heroHeight)
                srcRect.set(crop.x.roundToInt(), crop.y.roundToInt(), (crop.x + crop.width).roundToInt(), (crop.y + crop.height).roundToInt())
                rect.set(0f, 0f, width, heroHeight)
                imagePaint.alpha = (heroAlpha * 255f).roundToInt().coerceIn(0, 255)
                canvas.drawBitmap(bitmap, srcRect, rect, imagePaint)
                if (heroMaskShader == null || heroMaskHeight != heroHeight) {
                    heroMaskHeight = heroHeight
                    heroMaskShader = LinearGradient(
                        0f, 0f, 0f, heroHeight,
                        AppleBackdropGeometry.HERO_MASK_ALPHAS.map { alpha -> Color.argb((alpha * 255f).roundToInt(), 0, 0, 0) }.toIntArray(),
                        AppleBackdropGeometry.HERO_MASK_POSITIONS,
                        Shader.TileMode.CLAMP,
                    )
                }
                maskPaint.shader = heroMaskShader
                canvas.drawRect(0f, 0f, width, heroHeight, maskPaint)
                canvas.restoreToCount(heroLayer)
            }
        }
        imagePaint.alpha = 255
    }

    private fun roomFor(index: Int, uri: String, source: Bitmap, widthDp: Float, heightDp: Float, density: Float): Bitmap {
        val slot = if (index == 0) previousRoom else currentRoom
        if (slot.uri == uri && slot.source === source && slot.widthDp == widthDp && slot.heightDp == heightDp && slot.density == density) {
            return slot.image ?: BackdropArtCache.room(uri, source, widthDp, heightDp, density).also { slot.image = it }
        }
        val image = BackdropArtCache.room(uri, source, widthDp, heightDp, density)
        slot.uri = uri
        slot.source = source
        slot.widthDp = widthDp
        slot.heightDp = heightDp
        slot.density = density
        slot.image = image
        return image
    }

    private fun drawShade(canvas: Canvas, width: Float, height: Float) {
        if (shadeShader == null || shadeHeight != height) {
            shadeHeight = height
            shadeShader = LinearGradient(
                0f, 0f, 0f, height,
                intArrayOf(Color.argb(13, 0, 0, 0), Color.argb(102, 0, 0, 0)),
                null,
                Shader.TileMode.CLAMP,
            )
        }
        shadePaint.shader = shadeShader
        canvas.drawRect(0f, 0f, width, height, shadePaint)
    }

    private fun imageFade(now: Long): Float = AppleBackdropGeometry.fade(now, fadeStartedAt, fadeDuration)

    private fun heroAt(now: Long): Float {
        if (!heroInitialized) return 0f
        val progress = AppleBackdropGeometry.fade(now, heroStartedAt, AppleBackdropGeometry.HERO_FADE_MS)
        return heroFrom + (heroTarget - heroFrom) * progress
    }

    private fun acceptCover(uri: String, bitmap: Bitmap, now: Long) {
        if (uri != requestedUri || bitmap === currentBitmap) return
        val first = currentBitmap == null && previousBitmap == null
        val midFade = previousBitmap != null && now - fadeStartedAt < fadeDuration
        if (!first && !midFade) {
            previousUri = currentBitmapUri
            previousBitmap = currentBitmap
            previousRoom.clear()
            previousRoom.uri = currentRoom.uri
            previousRoom.source = currentRoom.source
            previousRoom.widthDp = currentRoom.widthDp
            previousRoom.heightDp = currentRoom.heightDp
            previousRoom.density = currentRoom.density
            previousRoom.image = currentRoom.image
            currentRoom.clear()
            fadeStartedAt = now
            fadeDuration = AppleBackdropGeometry.ROOM_FADE_MS
        } else if (midFade) {
            // Keep the outgoing cover and carry its in-progress fade through a rapid skip.
            currentRoom.clear()
            fadeStartedAt = now
            fadeDuration = 700L
        } else {
            previousUri = null
            previousBitmap = null
            previousRoom.clear()
            currentRoom.clear()
            fadeStartedAt = now - AppleBackdropGeometry.ROOM_FADE_MS
            fadeDuration = AppleBackdropGeometry.ROOM_FADE_MS
        }
        currentBitmapUri = uri
        currentBitmap = bitmap
        updateLoop()
        invalidate()
    }

    private fun onCoverCacheChanged() {
        val currentUri = requestedUri ?: return
        val bitmap = BackdropArtCache.get(currentUri)
        if (bitmap != null) {
            acceptCover(currentUri, bitmap, SystemClock.uptimeMillis())
        } else if (BackdropArtCache.hasFailed(currentUri)) {
            previousUri = null
            previousBitmap = null
            currentBitmapUri = null
            currentBitmap = null
            previousRoom.clear()
            currentRoom.clear()
            invalidate()
            updateLoop()
        }
    }

    private fun updateLoop() {
        val now = SystemClock.uptimeMillis()
        val wanted = isAttachedToWindow && (previousBitmap != null || abs(heroAt(now) - heroTarget) > 0.001f)
        if (wanted && !looping) {
            looping = true
            Choreographer.getInstance().postFrameCallback(frame)
        } else if (!wanted && looping) {
            stopLoop()
        }
    }

    private fun stopLoop() {
        if (!looping) return
        Choreographer.getInstance().removeFrameCallback(frame)
        looping = false
    }

    private val frame = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!isAttachedToWindow) {
                looping = false
                return
            }
            if (previousBitmap != null && imageFade(SystemClock.uptimeMillis()) >= 1f) {
                previousBitmap = null
                previousUri = null
                previousRoom.clear()
            }
            invalidate()
            if (previousBitmap != null || abs(heroAt(SystemClock.uptimeMillis()) - heroTarget) > 0.001f) {
                Choreographer.getInstance().postFrameCallback(this)
            } else {
                looping = false
            }
        }
    }

    private fun parseColor(value: String?): Int = try {
        Color.parseColor(value ?: "#000000")
    } catch (_: IllegalArgumentException) {
        Color.BLACK
    }
}

/** A bounded process cache shared by the player backdrop's primary, incoming and video-veil views. */
@OptIn(UnstableApi::class)
private object BackdropArtCache {
    private const val MAX_IMAGE_BYTES = 36 * 1024 * 1024
    private const val MAX_ROOM_BYTES = 2 * 1024 * 1024
    private const val MAX_DECODE_PX = 2_048
    private const val MAX_ATTEMPTS = 3
    private const val RETRY_MS = 1_500L

    private val main = Handler(Looper.getMainLooper())
    private val executor = Executors.newFixedThreadPool(2) { task ->
        Thread(task, "player-backdrop").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 }
    }
    private val listeners = LinkedHashSet<Runnable>()
    private val pending = HashSet<String>()
    private val attempts = HashMap<String, Int>()
    private val bitmapCache = object : LruCache<String, Bitmap>(MAX_IMAGE_BYTES) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }
    private val roomCache = object : LruCache<String, Bitmap>(MAX_ROOM_BYTES) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }
    private val loaders = HashMap<Int, DataSourceBitmapLoader>()
    private var callbacksRegistered = false
    private val memoryCallbacks = object : ComponentCallbacks2 {
        override fun onTrimMemory(level: Int) {
            if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
                roomCache.evictAll()
                bitmapCache.trimToSize(MAX_IMAGE_BYTES / 2)
            }
            if (level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE) bitmapCache.evictAll()
        }

        override fun onLowMemory() {
            roomCache.evictAll()
            bitmapCache.evictAll()
        }

        override fun onConfigurationChanged(newConfig: Configuration) = Unit
    }

    fun addListener(listener: Runnable) { listeners += listener }
    fun removeListener(listener: Runnable) { listeners -= listener }
    fun get(uri: String): Bitmap? = bitmapCache.get(uri)
    fun hasFailed(uri: String): Boolean = (attempts[uri] ?: 0) >= MAX_ATTEMPTS

    fun request(context: Context, uri: String) {
        if (!callbacksRegistered) {
            context.applicationContext.registerComponentCallbacks(memoryCallbacks)
            callbacksRegistered = true
        }
        if (uri.isBlank() || bitmapCache.get(uri) != null || !pending.add(uri)) return
        if (hasFailed(uri)) {
            pending.remove(uri)
            return
        }
        val loader = loaders.getOrPut(MAX_DECODE_PX) {
            DataSourceBitmapLoader(
                MoreExecutors.listeningDecorator(executor),
                DefaultDataSource.Factory(context.applicationContext), null, MAX_DECODE_PX,
            )
        }
        val future = try {
            loader.loadBitmap(Uri.parse(uri))
        } catch (_: Throwable) {
            pending.remove(uri)
            failed(uri, context.applicationContext)
            return
        }
        future.addListener({
            val bitmap = try { future.get() } catch (_: Throwable) { null }
            main.post {
                pending.remove(uri)
                if (bitmap != null) {
                    attempts.remove(uri)
                    bitmapCache.put(uri, bitmap)
                } else {
                    failed(uri, context.applicationContext)
                }
                listeners.toList().forEach { it.run() }
            }
        }, executor)
    }

    private fun failed(uri: String, context: Context) {
        val count = (attempts[uri] ?: 0) + 1
        attempts[uri] = count
        if (attempts.size > 128) attempts.keys.firstOrNull()?.let { attempts.remove(it) }
        if (count < MAX_ATTEMPTS) {
            main.postDelayed({ if (bitmapCache.get(uri) == null) request(context, uri) }, RETRY_MS)
        }
        listeners.toList().forEach { it.run() }
    }

    /** Build the tiny 48 px room once per cover and player frame; no full-screen blur runs on a redraw. */
    fun room(uri: String, source: Bitmap, widthDp: Float, heightDp: Float, density: Float): Bitmap {
        val w = max(1, widthDp.roundToInt())
        val h = max(1, heightDp.roundToInt())
        val densityKey = (density * 100).roundToInt()
        // A refreshed bitmap can arrive for the same URI; do not reuse the old pixels for that cover.
        val key = "$uri@${System.identityHashCode(source)}:$w:$h:$densityKey"
        roomCache.get(key)?.let { return it }

        val boxWidthDp = widthDp + AppleBackdropGeometry.BLEED_DP * 2f
        val boxHeightDp = heightDp + AppleBackdropGeometry.BLEED_DP * 2f
        val size = AppleBackdropGeometry.roomSize(boxWidthDp, boxHeightDp)
        val result = Bitmap.createBitmap(size.width, size.height, Bitmap.Config.ARGB_8888)
        val crop = AppleBackdropGeometry.coverCrop(source.width, source.height, boxWidthDp, boxHeightDp)
        val src = Rect(crop.x.roundToInt(), crop.y.roundToInt(), (crop.x + crop.width).roundToInt(), (crop.y + crop.height).roundToInt())
        val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
        Canvas(result).drawBitmap(source, src, RectF(0f, 0f, size.width.toFloat(), size.height.toFloat()), paint)
        blur(result, AppleBackdropGeometry.blurRadius(size.sigma))
        roomCache.put(key, result)
        return result
    }

    /** Three horizontal/vertical box-blur pairs approximate the source's heavily blurred room at this tiny size. */
    private fun blur(bitmap: Bitmap, radius: Int) {
        if (radius <= 0) return
        val width = bitmap.width
        val height = bitmap.height
        var source = IntArray(width * height)
        var scratch = IntArray(width * height)
        bitmap.getPixels(source, 0, width, 0, 0, width, height)
        repeat(3) {
            boxPass(source, scratch, width, height, radius, horizontal = true)
            boxPass(scratch, source, width, height, radius, horizontal = false)
        }
        bitmap.setPixels(source, 0, width, 0, 0, width, height)
    }

    private fun boxPass(input: IntArray, output: IntArray, width: Int, height: Int, radius: Int, horizontal: Boolean) {
        val span = radius * 2 + 1
        for (y in 0 until height) {
            for (x in 0 until width) {
                var a = 0
                var r = 0
                var g = 0
                var b = 0
                for (offset in -radius..radius) {
                    val xx = if (horizontal) (x + offset).coerceIn(0, width - 1) else x
                    val yy = if (horizontal) y else (y + offset).coerceIn(0, height - 1)
                    val color = input[yy * width + xx]
                    a += Color.alpha(color)
                    r += Color.red(color)
                    g += Color.green(color)
                    b += Color.blue(color)
                }
                output[y * width + x] = Color.argb(a / span, r / span, g / span, b / span)
            }
        }
    }
}
