package com.lyricflow.app.views

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Shader
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import com.facebook.react.uimanager.util.ReactFindViewUtil
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import kotlin.math.min

/**
 * The wash in the bottom half of Now Playing while the animated canvas plays: the video's own colours, so the room
 * under the controls moves with the clip instead of keeping the cover's still palette.
 *
 * It reads the colours off the canvas's `TextureView` (the video is drawn into one on Android, see
 * `CanvasVideoLayer.tsx`) a few times a second into a tiny bitmap: there is no second decoder and the video is not
 * touched. The sampled colours ease from one reading to the next every display frame and are drawn filtered large,
 * which is all smooth light. It samples only while [active] (the canvas is on screen and the song plays); paused, it
 * holds the last colours, and with nothing to show it draws nothing.
 */
class NativeCanvasWashView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val main = Handler(Looper.getMainLooper())
    private val sample = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)
    private val shown = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)
    private val target = FloatArray(W * H * 3)
    private val current = FloatArray(W * H * 3)
    private val scratch = FloatArray(W * H * 3)
    private val row = IntArray(W * H)
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG).apply {
        shader = BitmapShader(shown, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    }
    private val shadePaint = Paint()
    private val meltPaint = Paint().apply {
        xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
        shader = LinearGradient(
            0f, 0f, 0f, 1f,
            intArrayOf(Color.TRANSPARENT, Color.argb(200, 0, 0, 0), Color.BLACK),
            floatArrayOf(0f, 0.3f, 0.5f),
            Shader.TileMode.CLAMP,
        )
    }
    private val matrix = Matrix()

    private var targetId: String? = null
    private var haveColors = false
    private var converging = false
    private var looping = false
    private var lastFrameNs = 0L
    private var video: TextureView? = null

    var active = false
        set(value) {
            if (field == value) return
            field = value
            if (value) scheduleSample(0L) else main.removeCallbacks(sampler)
            updateLoop()
        }

    init {
        setWillNotDraw(false)
        // The same shade the room sits under (AppleBackdrop): black from 25 % at the top to 40 % at the bottom, so
        // white text reads, then a ramp that lets the video's own dissolve above melt into the wash.
        shadePaint.shader = LinearGradient(
            0f, 0f, 0f, 1f,
            intArrayOf(Color.argb(64, 0, 0, 0), Color.argb(102, 0, 0, 0)),
            null,
            Shader.TileMode.CLAMP,
        )
    }

    // React Native gives the view its size; it has no children to place.
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    fun setTargetId(id: String?) {
        if (id == targetId) return
        targetId = id
        video = null
    }

    private val sampler = object : Runnable {
        override fun run() {
            if (!active || !isAttachedToWindow) return
            readVideo()
            scheduleSample(SAMPLE_MS)
        }
    }

    private fun scheduleSample(delayMs: Long) {
        main.removeCallbacks(sampler)
        main.postDelayed(sampler, delayMs)
    }

    /** The canvas's video surface, found by the native ID the canvas layer's wrapper carries. */
    private fun findVideo(): TextureView? {
        video?.let { if (it.isAttachedToWindow) return it }
        val id = targetId ?: return null
        val wrapper = try {
            ReactFindViewUtil.findView(rootView, id)
        } catch (_: Throwable) {
            null
        } ?: return null
        return firstTexture(wrapper).also { video = it }
    }

    private fun firstTexture(view: View): TextureView? {
        if (view is TextureView) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) firstTexture(view.getChildAt(i))?.let { return it }
        }
        return null
    }

    private fun readVideo() {
        val texture = findVideo() ?: return
        if (!texture.isAvailable || texture.width == 0 || texture.height == 0) return
        try {
            texture.getBitmap(sample)
        } catch (_: Throwable) {
            return
        }
        sample.getPixels(row, 0, W, 0, 0, W, H)
        // The lower half of the picture is what the room under the controls should carry, stretched over the wash.
        var any = false
        for (y in 0 until H) {
            val srcY = H / 2 + y / 2
            for (x in 0 until W) {
                val c = row[srcY.coerceAtMost(H - 1) * W + x]
                val i = (y * W + x) * 3
                target[i] = Color.red(c).toFloat()
                target[i + 1] = Color.green(c).toFloat()
                target[i + 2] = Color.blue(c).toFloat()
                if (c != Color.TRANSPARENT && c != Color.BLACK) any = true
            }
        }
        // A frame that is still black (the surface not filled yet) says nothing about the clip's colours.
        if (!any) return
        soften()
        if (!haveColors) {
            System.arraycopy(target, 0, current, 0, target.size)
            haveColors = true
            render()
        }
        converging = true
        updateLoop()
    }

    /**
     * Turns the reading into soft light: a few passes of blur melt a bright detail (a white stroke in the clip) into
     * its neighbours instead of a block, and no colour is let past [MAX_LEVEL], so the room stays a room under the
     * controls however bright the picture is.
     */
    private fun soften() {
        repeat(BLUR_PASSES) {
            for (y in 0 until H) {
                for (x in 0 until W) {
                    val i = (y * W + x) * 3
                    for (c in 0 until 3) {
                        var sum = 0f
                        var n = 0
                        for (dy in -1..1) {
                            val yy = y + dy
                            if (yy < 0 || yy >= H) continue
                            for (dx in -1..1) {
                                val xx = x + dx
                                if (xx < 0 || xx >= W) continue
                                sum += target[(yy * W + xx) * 3 + c]
                                n++
                            }
                        }
                        scratch[i + c] = sum / n
                    }
                }
            }
            System.arraycopy(scratch, 0, target, 0, target.size)
        }
        for (i in 0 until W * H) {
            val j = i * 3
            val peak = maxOf(target[j], target[j + 1], target[j + 2])
            if (peak > MAX_LEVEL) {
                val k = MAX_LEVEL / peak
                target[j] *= k
                target[j + 1] *= k
                target[j + 2] *= k
            }
        }
    }

    private fun updateLoop() {
        val wanted = isAttachedToWindow && converging
        if (wanted && !looping) {
            looping = true
            lastFrameNs = 0L
            Choreographer.getInstance().postFrameCallback(frame)
        }
    }

    private val frame = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!isAttachedToWindow || !converging) {
                looping = false
                return
            }
            val dt = if (lastFrameNs == 0L) 0f else min(0.1f, (frameTimeNanos - lastFrameNs) / 1e9f)
            lastFrameNs = frameTimeNanos
            // The colours ease toward the latest reading, so the wash glides between samples instead of stepping.
            val k = min(1f, dt * EASE_PER_S)
            var moving = false
            for (i in current.indices) {
                val d = target[i] - current[i]
                if (d > 0.5f || d < -0.5f) {
                    current[i] += d * k
                    moving = true
                } else {
                    current[i] = target[i]
                }
            }
            if (moving) render()
            // Stops when settled (a paused clip), and starts again with the next reading.
            if (!moving && !active) converging = false
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    private fun render() {
        if (!haveColors) return
        for (i in 0 until W * H) {
            val j = i * 3
            row[i] = Color.rgb(
                current[j].toInt().coerceIn(0, 255),
                current[j + 1].toInt().coerceIn(0, 255),
                current[j + 2].toInt().coerceIn(0, 255),
            )
        }
        shown.setPixels(row, 0, W, 0, 0, W, H)
        invalidate()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (active) scheduleSample(0L)
        updateLoop()
    }

    override fun onDetachedFromWindow() {
        main.removeCallbacks(sampler)
        Choreographer.getInstance().removeFrameCallback(frame)
        looping = false
        video = null
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        if (!haveColors) return
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return
        // Drawn in a layer so the top can melt into what is above it (the video's own dissolve) instead of ending in an edge.
        val layer = canvas.saveLayer(0f, 0f, w, h, null)
        matrix.setScale(w / (W - 1), h / (H - 1))
        paint.shader?.setLocalMatrix(matrix)
        canvas.drawRect(0f, 0f, w, h, paint)
        matrix.setScale(1f, h)
        shadePaint.shader?.setLocalMatrix(matrix)
        canvas.drawRect(0f, 0f, w, h, shadePaint)
        meltPaint.shader?.setLocalMatrix(matrix)
        canvas.drawRect(0f, 0f, w, h, meltPaint)
        canvas.restoreToCount(layer)
    }

    private companion object {
        /** The sampled picture: small enough that reading it back is cheap, and already as soft as the room it feeds. */
        const val W = 16
        const val H = 24
        const val SAMPLE_MS = 250L
        const val EASE_PER_S = 4f
        const val BLUR_PASSES = 3
        /** The brightest any channel of the wash may be (of 255): light, but a room, not a lamp. */
        const val MAX_LEVEL = 150f
    }
}
