package com.lyricflow.app.island

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ComposeShader
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.RectF
import android.graphics.Shader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Choreographer
import android.view.Gravity
import android.view.RoundedCorner
import android.view.View
import android.view.WindowManager
import kotlin.math.max
import kotlin.math.min

/**
 * LuvLyrics growing out of the island, the way an iPhone app grows out of its Dynamic Island: one shape that
 * becomes the app, never one picture fading out while another fades in.
 *
 * Android's launch animations (`makeScaleUpAnimation`, clip reveal) are run by the system, and many ROMs ignore or
 * replace them for a start that comes from a service; they also showed the app's last screen before Now Playing
 * mounted. So the island plays the morph itself, in a full-screen overlay of its own that no touch reaches:
 * 1. Its first frame is the island exactly as it was: a picture of the card, at its place, in its shape.
 * 2. The shape grows to the whole screen on one spring (Apple's feel, about 0.45 s), its corners easing into the
 *    screen's own. The card's contents dissolve over the first third while its cover travels to where Now Playing
 *    shows it, over the island's own light, so the end of the motion already looks like the player.
 * 3. LuvLyrics starts underneath with no system animation once the first frame is up. When it has drawn Now
 *    Playing (it says so through [appShown], or a moment after it resumed), the overlay fades off it and goes.
 *
 * What it draws per frame depends on the phone (IslandBudget): an old phone grows a plain shape over the cover's
 * colours with the cover in it; a capable one adds the island's flowing light and melts the cover into it.
 */
class IslandLaunch(
    private val context: Context,
    private val wm: WindowManager,
    private val budget: IslandBudget,
    /** The overlay's first frame is on screen: start the app now and fold the island away under it. */
    private val onShown: () -> Unit,
    /** The overlay is gone. */
    private val onDone: () -> Unit,
) {
    /** The island as it was when tapped, in screen pixels. */
    class Look(
        val outline: RectF,
        val outlineRadius: Float,
        /** The island drawn as it was, filling [outline]; null to start from the bare shape. */
        val snapshot: Bitmap?,
        val cover: Bitmap?,
        /** Where the cover was on the island (null: it was not showing, so it rises in place). */
        val coverFrom: RectF?,
        val coverRadius: Float,
        /** The island's light (IslandFlow's small field), copied; null on a phone that does not draw it. */
        val flow: Bitmap?,
        val colors: IslandColors,
    )

    private val main = Handler(Looper.getMainLooper())
    private var look: Look? = null
    private var view: Surface? = null
    private var added = false

    private val screen = RectF()
    private var screenRadius = 0f
    private val heroRect = RectF()

    private val grow = if (budget == IslandBudget.LOW) Spring(0f, stiffness = 260f, dampingRatio = 1f)
        else Spring(0f, stiffness = 200f, dampingRatio = 0.9f)
    private var fadeStartMs = 0L
    private var startedMs = 0L
    private var shownSent = false
    private var resumedMs = 0L
    private var appShown = false
    private var finished = false

    private var looping = false
    private var lastFrameNanos = 0L
    private var drewOnce = false
    private val frame = Choreographer.FrameCallback { onFrame(it) }
    /** Grown and waiting on the app: looks again shortly, drawing nothing meanwhile. */
    private val checkReady = object : Runnable {
        override fun run() {
            if (finished || looping) return
            val now = SystemClock.uptimeMillis()
            if (fadeStartMs == 0L && readyToFade(now)) {
                fadeStartMs = now
                kick()
            } else if (fadeStartMs == 0L) {
                main.removeCallbacks(this)
                main.postDelayed(this, WAIT_POLL_MS)
            }
        }
    }

    // Drawing, built once per launch so no frame allocates.
    private val shape = RectF()
    private val shapeClip = Path()
    private val coverRect = RectF()
    private val snapRect = RectF()
    private val matrix = Matrix()
    private val black = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK }
    private val washPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val flowPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
    private val veilPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val coverPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val meltPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val snapPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private var coverShader: BitmapShader? = null
    private var meltShader: Shader? = null
    private var meltMask: LinearGradient? = null

    @SuppressLint("ViewConstructor")
    private inner class Surface : View(context) {
        override fun onDraw(canvas: Canvas) = drawLaunch(canvas)
        // Each part takes the fade in its own paint: no offscreen layer for the whole screen.
        override fun hasOverlappingRendering() = false
    }

    /** Starts the morph; false when it could not (the caller then just opens the app). */
    fun play(look: Look, screenWidth: Int, screenHeight: Int): Boolean {
        if (screenWidth <= 0 || screenHeight <= 0 || look.outline.isEmpty) return false
        this.look = look
        screen.set(0f, 0f, screenWidth.toFloat(), screenHeight.toFloat())
        screenRadius = displayCornerRadius()
        // Now Playing's hero (Apple's layout): the cover full-bleed across the top 65% of the screen.
        heroRect.set(0f, 0f, screen.width(), screen.height() * HERO_HEIGHT)
        buildPaints(look)
        val v = Surface()
        val params = WindowManager.LayoutParams().apply {
            type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
            format = PixelFormat.TRANSLUCENT
            flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
            gravity = Gravity.TOP or Gravity.START
            x = 0
            y = 0
            width = screenWidth
            height = screenHeight
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                } else {
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) fitInsetsTypes = 0
            windowAnimations = 0
            title = "LuvLyrics island launch"
        }
        return try {
            wm.addView(v, params)
            view = v
            added = true
            startedMs = SystemClock.uptimeMillis()
            grow.snap(0f)
            grow.target = 1f
            kick()
            true
        } catch (e: Exception) {
            Log.w(TAG, "island launch overlay refused: ${e.message}")
            release()
            false
        }
    }

    /** LuvLyrics' activity came to the front. */
    fun appResumed() {
        if (resumedMs == 0L) resumedMs = SystemClock.uptimeMillis()
        main.post(checkReady)
    }

    /** LuvLyrics has drawn the screen the island opened (JavaScript says so once Now Playing is up). */
    fun appShown() {
        appShown = true
        main.post(checkReady)
    }

    /** Gone at once (the screen turned off, the island was switched off). */
    fun finishNow() {
        if (finished) return
        release()
    }

    private fun buildPaints(look: Look) {
        val c = look.colors
        // The room behind everything: the cover's colour pooling down into a near-black, built one unit tall and
        // stretched to the shape each frame.
        washPaint.shader = LinearGradient(0f, 0f, 0f, 1f,
            intArrayOf(Color.BLACK, c.top, Color.rgb(4, 4, 9)), floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP)
        look.flow?.let { flowPaint.shader = BitmapShader(it, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
        veilPaint.shader = LinearGradient(0f, 0f, 0f, 1f,
            intArrayOf(Color.argb(150, 0, 0, 0), Color.argb(40, 0, 0, 0), Color.TRANSPARENT),
            floatArrayOf(0f, 0.5f, 0.85f), Shader.TileMode.CLAMP)
        val cover = look.cover ?: return
        coverShader = BitmapShader(cover, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
        coverPaint.shader = coverShader
        // The melted cover (capable phones, Android 10+, where a child's matrix may change under a composed
        // shader): the same picture fading out along its lower edge, as Now Playing's hero does.
        if (budget.richLaunch && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val mask = LinearGradient(0f, 0f, 0f, 1f,
                intArrayOf(Color.BLACK, Color.BLACK, Color.argb(102, 0, 0, 0), Color.TRANSPARENT),
                floatArrayOf(0f, 0.75f, 0.92f, 1f), Shader.TileMode.CLAMP)
            val picture = BitmapShader(cover, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
            meltMask = mask
            meltShader = ComposeShader(picture, mask, PorterDuff.Mode.DST_IN)
            meltPaint.shader = meltShader
            meltCover = picture
        }
    }

    private var meltCover: BitmapShader? = null

    private fun kick() {
        if (looping || finished) return
        looping = true
        lastFrameNanos = 0L
        Choreographer.getInstance().postFrameCallback(frame)
    }

    /** Grows, then waits on the app (no frames), then fades off it and goes. */
    private fun onFrame(nowNanos: Long) {
        if (finished) return
        val dt = if (lastFrameNanos == 0L) 1f / 60f else (nowNanos - lastFrameNanos) / 1_000_000_000f
        lastFrameNanos = nowNanos
        // The first presented frame must be the island itself, before the spring advances.
        val moving = if (drewOnce) grow.step(dt) else true
        // This callback comes a frame after the first one was drawn: that frame is on screen now.
        if (!shownSent && drewOnce) {
            shownSent = true
            onShown()
        }
        val now = SystemClock.uptimeMillis()
        if (fadeStartMs == 0L && readyToFade(now)) fadeStartMs = now
        if (fadeStartMs != 0L && now - fadeStartMs >= FADE_MS) {
            release()
            return
        }
        view?.invalidate()
        if (moving || fadeStartMs != 0L || !shownSent) {
            Choreographer.getInstance().postFrameCallback(frame)
        } else {
            looping = false
            main.removeCallbacks(checkReady)
            main.postDelayed(checkReady, WAIT_POLL_MS)
        }
    }

    /** Grown and the app has drawn (or long enough after it resumed), or held as long as it ever is. */
    private fun readyToFade(now: Long): Boolean {
        if (now - startedMs >= MAX_HOLD_MS) return true
        if (grow.value < 0.985f) return false
        return appShown || (resumedMs != 0L && now - max(resumedMs, startedMs) >= RESUME_GRACE_MS)
    }

    private fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t

    private fun drawLaunch(canvas: Canvas) {
        val l = look ?: return
        drewOnce = true
        val t = grow.value
        val e = t.coerceIn(0f, 1f)
        val fade = if (fadeStartMs == 0L) 1f else {
            val p = ((SystemClock.uptimeMillis() - fadeStartMs) / FADE_MS.toFloat()).coerceIn(0f, 1f)
            // Ease in-out: the overlay lets go gently and leaves without a tail.
            1f - p * p * (3f - 2f * p)
        }
        if (fade <= 0.002f) return

        // The shape: the island's outline growing to the screen, corners easing into the screen's own. A spring's
        // overshoot past the screen is held at its edges.
        shape.set(
            max(screen.left, lerp(l.outline.left, screen.left, t)),
            lerp(l.outline.top, screen.top, t),
            min(screen.right, lerp(l.outline.right, screen.right, t)),
            min(screen.bottom, lerp(l.outline.bottom, screen.bottom, t)),
        )
        val r = lerp(l.outlineRadius, screenRadius, e).coerceAtMost(min(shape.width(), shape.height()) / 2f)

        // Covers without a visible source and the scaled snapshot must stay inside the moving container.
        shapeClip.reset()
        shapeClip.addRoundRect(shape, r, r, Path.Direction.CW)
        canvas.save()
        canvas.clipPath(shapeClip)

        black.alpha = (255 * fade).toInt()
        canvas.drawRoundRect(shape, r, r, black)
        stretch(washPaint, shape)
        washPaint.alpha = (255 * fade * 0.85f).toInt()
        canvas.drawRoundRect(shape, r, r, washPaint)
        if (l.flow != null && budget.richLaunch) {
            matrix.setScale(shape.width() / (l.flow.width - 1), shape.height() / (l.flow.height - 1))
            matrix.postTranslate(shape.left, shape.top)
            flowPaint.shader?.setLocalMatrix(matrix)
            flowPaint.alpha = (255 * fade * FLOW_STRENGTH).toInt()
            canvas.drawRoundRect(shape, r, r, flowPaint)
            stretch(veilPaint, shape)
            veilPaint.alpha = (255 * fade).toInt()
            canvas.drawRoundRect(shape, r, r, veilPaint)
        }

        // The cover travels from its place on the island to Now Playing's hero, cropped to fill wherever it is.
        val cover = l.cover
        if (cover != null) {
            val from = l.coverFrom
            if (from != null) {
                coverRect.set(lerp(from.left, heroRect.left, t), lerp(from.top, heroRect.top, t),
                    lerp(from.right, heroRect.right, t), lerp(from.bottom, heroRect.bottom, t))
            } else {
                coverRect.set(heroRect)
            }
            // Never poking out of the shape's rounded corner as its edges meet the cover's.
            val inset = min(coverRect.left - shape.left, coverRect.top - shape.top).coerceAtLeast(0f)
            val cr = max(lerp(l.coverRadius, screenRadius, e), r - inset).coerceAtMost(min(coverRect.width(), coverRect.height()) / 2f)
            val appear = if (from == null) e else 1f
            centerCrop(cover, coverRect, matrix)
            val melt = meltShader
            if (melt != null) {
                // The plain cover gives way to the melted one as it grows into the hero.
                coverShader?.setLocalMatrix(matrix)
                meltCover?.setLocalMatrix(matrix)
                unit.setScale(1f, coverRect.height())
                unit.postTranslate(0f, coverRect.top)
                meltMask?.setLocalMatrix(unit)
                coverPaint.alpha = (255 * fade * appear * (1f - e)).toInt()
                if (coverPaint.alpha > 0) canvas.drawRoundRect(coverRect, cr, cr, coverPaint)
                meltPaint.alpha = (255 * fade * appear * e).toInt()
                if (meltPaint.alpha > 0) canvas.drawRoundRect(coverRect, cr, cr, meltPaint)
            } else {
                coverShader?.setLocalMatrix(matrix)
                coverPaint.alpha = (255 * fade * appear).toInt()
                canvas.drawRoundRect(coverRect, cr, cr, coverPaint)
            }
        }

        // The island as it was, on top at first: its title, controls and lyrics dissolve as the shape grows away
        // from them (scaled with the shape, its aspect kept, from the top).
        val snapshot = l.snapshot
        val dissolve = 1f - (e / SNAPSHOT_GONE_AT).coerceIn(0f, 1f)
        if (snapshot != null && dissolve > 0.004f) {
            val s = shape.width() / l.outline.width()
            val w = l.outline.width() * s
            val h = l.outline.height() * s
            snapRect.set(shape.centerX() - w / 2f, shape.top, shape.centerX() + w / 2f, shape.top + h)
            snapPaint.alpha = (255 * fade * dissolve * dissolve).toInt()
            canvas.drawBitmap(snapshot, null, snapRect, snapPaint)
        }
        canvas.restore()
    }

    private val unit = Matrix()

    /** A shader built one unit tall, stretched over [rect]'s height. */
    private fun stretch(paint: Paint, rect: RectF) {
        unit.setScale(1f, rect.height())
        unit.postTranslate(0f, rect.top)
        paint.shader?.setLocalMatrix(unit)
    }

    /** [out] maps [bitmap] onto [box] cropped to fill it, centred, as an image view's centerCrop does. */
    private fun centerCrop(bitmap: Bitmap, box: RectF, out: Matrix) {
        val bw = bitmap.width.toFloat()
        val bh = bitmap.height.toFloat()
        val s = max(box.width() / bw, box.height() / bh)
        out.setScale(s, s)
        out.postTranslate(box.centerX() - bw * s / 2f, box.centerY() - bh * s / 2f)
    }

    /** The screen's own corner radius where Android reports it (12+), else a phone's usual. */
    private fun displayCornerRadius(): Float {
        val density = context.resources.displayMetrics.density
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val corner = try {
                wm.maximumWindowMetrics.windowInsets.getRoundedCorner(RoundedCorner.POSITION_TOP_LEFT)
            } catch (_: Exception) {
                null
            }
            return corner?.radius?.toFloat() ?: 0f
        }
        return 24f * density
    }

    private fun release() {
        if (finished) return
        finished = true
        looping = false
        Choreographer.getInstance().removeFrameCallback(frame)
        main.removeCallbacks(checkReady)
        val v = view
        view = null
        if (added && v != null) {
            try {
                wm.removeViewImmediate(v)
            } catch (_: Exception) {
                // Already gone with the service.
            }
        }
        added = false
        look?.snapshot?.let { if (!it.isRecycled && it.config != Bitmap.Config.HARDWARE) it.recycle() }
        look = null
        onDone()
    }

    private companion object {
        const val TAG = "LyrFlowIsland"
        /** Now Playing's hero, as a share of the screen's height (player/AppleBackdrop). */
        const val HERO_HEIGHT = 0.65f
        /** Where the island's own contents have dissolved, along the growth. */
        const val SNAPSHOT_GONE_AT = 0.38f
        /** The island light's strength, as on the card (IslandView). */
        const val FLOW_STRENGTH = 1f
        /** The overlay's fade off the app. */
        const val FADE_MS = 220L
        /** Without word from JavaScript, the app is taken as drawn this long after it resumed. */
        const val RESUME_GRACE_MS = 650L
        /** Never covers the screen longer than this, whatever the app does. */
        const val MAX_HOLD_MS = 2_600L
        const val WAIT_POLL_MS = 40L
    }
}
