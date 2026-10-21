package com.lyricflow.app.views

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.LruCache
import android.view.Choreographer
import androidx.annotation.OptIn
import androidx.core.graphics.ColorUtils
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import com.lyricflow.app.island.IslandBudget
import com.lyricflow.app.island.IslandColors
import com.lyricflow.app.island.IslandFlow
import com.lyricflow.app.island.IslandPalette
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors
import kotlin.math.min

/**
 * The glow behind Now Playing's lyrics ("Apple + glow"), drawn in Kotlin with the dynamic island's own light: the
 * cover's colours as one flowing liquid mesh (IslandFlow), computed small and drawn large with filtering, under a
 * veil that keeps the header and the lyrics readable. The React Native glow (`GlowBackground.tsx`, Skia) stays as the
 * fallback for iOS and for builds without this view.
 *
 * The colours are read from the cover the island's way (IslandPalette). The flow's clock runs only while the surface
 * is on screen and the song plays, and eases to a stop on pause, so a paused or hidden glow costs nothing.
 */
@OptIn(UnstableApi::class)
class NativeFlowGlowView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val main = Handler(Looper.getMainLooper())
    private val budget = IslandBudget.of(context)
    private val flow = IslandFlow()
    private val flowBitmap: Bitmap = Bitmap.createBitmap(IslandFlow.W, IslandFlow.H, Bitmap.Config.ARGB_8888)
    private val flowPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG).apply {
        shader = BitmapShader(flowBitmap, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    }
    private val veilPaint = Paint()
    private val matrix = Matrix()

    private var coverUri: String? = null
    var active = false
        set(value) {
            if (field == value) return
            field = value
            updateLoop()
        }
    var playing = false
        set(value) {
            if (field == value) return
            field = value
            updateLoop()
        }

    private var from = IslandColors.NEUTRAL
    private var to = IslandColors.NEUTRAL
    private var mix = 1f
    private var clock = 0f
    private var speed = 0f
    private var lastFrameNs = 0L
    private var renderedMs = 0L
    private var looping = false
    private var requestedUri: String? = null

    init {
        setWillNotDraw(false)
        veilPaint.shader = LinearGradient(
            0f, 0f, 0f, 1f,
            intArrayOf(Color.argb(150, 0, 0, 0), Color.argb(70, 0, 0, 0), Color.argb(20, 0, 0, 0), Color.TRANSPARENT),
            floatArrayOf(0f, 0.3f, 0.6f, 0.9f),
            Shader.TileMode.CLAMP,
        )
    }

    // React Native gives the view its size; it has no children to place.
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    fun setCover(uri: String?) {
        if (uri == coverUri) return
        coverUri = uri
        val key = uri ?: return setColors(IslandColors.NEUTRAL)
        colorCache.get(key)?.let { return setColors(it) }
        requestedUri = key
        val future = try {
            loader.loadBitmap(Uri.parse(key))
        } catch (_: Throwable) {
            return setColors(IslandColors.NEUTRAL)
        }
        future.addListener({
            val colors = try {
                future.get()?.let { IslandPalette.colorsOf(it) }
            } catch (_: Throwable) {
                null
            }
            main.post {
                if (colors != null) colorCache.put(key, colors)
                // Only the latest cover answers, so a quick run of skips never lands an old song's colours.
                if (requestedUri == key) setColors(colors ?: IslandColors.NEUTRAL)
            }
        }, executor)
    }

    private fun setColors(next: IslandColors) {
        if (next == to) return
        // The first colours show at once; a new song crosses over from wherever the last one had got to.
        if (!hasShownColors) {
            from = next
            to = next
            mix = 1f
        } else {
            from = blended()
            to = next
            mix = 0f
        }
        hasShownColors = true
        renderedMs = 0L
        updateLoop()
        invalidate()
    }

    private var hasShownColors = false

    private fun blended(): IslandColors {
        if (mix >= 1f) return to
        val m = mix.coerceIn(0f, 1f)
        return IslandColors(
            ColorUtils.blendARGB(from.top, to.top, m),
            ColorUtils.blendARGB(from.bottom, to.bottom, m),
            ColorUtils.blendARGB(from.accent, to.accent, m),
            ColorUtils.blendARGB(from.second, to.second, m),
        )
    }

    private fun motionOff() = !android.animation.ValueAnimator.areAnimatorsEnabled()

    private fun wantsFrames() = active && isAttachedToWindow && (playing || speed > 0.01f || mix < 1f)

    private fun updateLoop() {
        if (wantsFrames()) {
            if (!looping) {
                looping = true
                lastFrameNs = 0L
                Choreographer.getInstance().postFrameCallback(frame)
            }
        } else {
            invalidate()
        }
    }

    private val frame = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!wantsFrames()) {
                looping = false
                invalidate()
                return
            }
            val dt = if (lastFrameNs == 0L) 0f else min(0.1f, (frameTimeNanos - lastFrameNs) / 1e9f)
            lastFrameNs = frameTimeNanos
            // The light eases up to its pace and down to a stop, the way the island's does.
            val target = if (playing && !motionOff()) 1f else 0f
            speed += (target - speed) * min(1f, dt * 2.5f)
            if (target == 0f && speed < 0.01f) speed = 0f
            clock += dt * speed * FLOW_TEMPO
            if (mix < 1f) mix = min(1f, mix + dt / COLOR_FADE_S)
            invalidate()
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        updateLoop()
    }

    override fun onDetachedFromWindow() {
        looping = false
        Choreographer.getInstance().removeFrameCallback(frame)
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return
        val now = SystemClock.uptimeMillis()
        // The field is recomputed at the phone's budget, not on every frame: filtered large, a few frames a second
        // already read as smooth light.
        if (renderedMs == 0L || now - renderedMs >= budget.flowFrameMs) {
            renderedMs = now
            val c = blended()
            val deep = ColorUtils.blendARGB(c.bottom, Color.BLACK, 0.55f)
            val light = ColorUtils.blendARGB(c.accent, c.bottom, 0.35f)
            if (flow.render(clock, deep, c.second, c.bottom, light)) {
                flowBitmap.setPixels(flow.pixels, 0, IslandFlow.W, 0, 0, IslandFlow.W, IslandFlow.H)
            }
        }
        matrix.setScale(w / (IslandFlow.W - 1), h / (IslandFlow.H - 1))
        flowPaint.shader?.setLocalMatrix(matrix)
        canvas.drawRect(0f, 0f, w, h, flowPaint)
        // The dark room over the top, stretched to the view's height.
        matrix.setScale(1f, h)
        veilPaint.shader?.setLocalMatrix(matrix)
        canvas.drawRect(0f, 0f, w, h, veilPaint)
    }

    private companion object {
        /** The island's flow pace (IslandView.FLOW_TEMPO). */
        const val FLOW_TEMPO = 2f
        const val COLOR_FADE_S = 1.2f
        val executor = Executors.newSingleThreadExecutor { r ->
            Thread(r, "flow-glow-art").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 }
        }
        val colorCache = LruCache<String, IslandColors>(16)
    }

    private val loader by lazy {
        DataSourceBitmapLoader(
            com.google.common.util.concurrent.MoreExecutors.listeningDecorator(executor),
            DefaultDataSource.Factory(context.applicationContext), null, 256,
        )
    }
}
