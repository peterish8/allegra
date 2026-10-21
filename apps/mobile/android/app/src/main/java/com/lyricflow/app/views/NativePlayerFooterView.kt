package com.lyricflow.app.views

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextPaint
import android.util.TypedValue
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityEvent
import androidx.core.graphics.PathParser
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.customview.widget.ExploreByTouchHelper
import com.lyricflow.app.island.IslandFonts
import com.lyricflow.app.island.Spring
import com.lyricflow.app.views.FooterGeometry.Target
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Now Playing's bottom row, drawn in Kotlin: the queue button, the output / sleep timer segment and the lyrics button.
 * The same look and press feel as the React Native row in `NowPlayingControls.tsx` (the `Tactile` sink and dim, the
 * segment's half highlight, the lit lyrics button), which stays as the fallback for iOS and builds without this view.
 *
 * The view decides nothing: a tap or a long press comes back as an action name through `onAction`, and JavaScript runs
 * the same handlers as before (the haptic tick, opening the queue / timer / output switcher, the lyrics button's
 * single / triple tap and long press rules). Icons are the Ionicons / MaterialCommunityIcons glyph outlines
 * (`IconGlyphs`, generated from the fonts) centred where React Native centres the glyph.
 *
 * The view is `FooterGeometry.SLOP` larger than the row on every side (React Native gives it negative margins), so the
 * buttons' 10 dp hit slop is inside its bounds.
 */
class NativePlayerFooterView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onAction by EventDispatcher<Map<String, Any>>()

    private val density = resources.displayMetrics.density
    private val main = Handler(Looper.getMainLooper())

    // ── Props, applied in one batch (commit) ────────────────────────────────
    private var hasTimer = false
    private var sleepLabel = ""
    private var outputDevices = false
    private var outputActive = false
    private var showLyrics = false
    private var lyricsLongPress = false
    private var waveColor = Color.WHITE
    private var reduceMotion = false
    private var propsDirty = false

    // ── Geometry (dp, row coordinates) ──────────────────────────────────────
    private var labelDp = 0f
    private var outputW = FooterGeometry.HALF_MIN_W
    private var timerW = FooterGeometry.HALF_MIN_W
    private var row = FooterGeometry.row(0f, 0f)
    /** `StyleSheet.hairlineWidth`: one physical pixel. */
    private val hairlineDp = 1f / density

    // ── Press state ─────────────────────────────────────────────────────────
    private var pressed = Target.NONE
    private var active = false
    private var downAt = 0L
    private var longFired = false
    private val queuePress = Spring(0f, SPRING_K, SPRING_ZETA)
    private val lyricsPress = Spring(0f, SPRING_K, SPRING_ZETA)
    private val longRunnable = Runnable {
        if (pressed == Target.LYRICS && active) {
            longFired = true
            onAction(mapOf("action" to "lyricsLong"))
        }
    }
    private var releaseQueue: Runnable? = null
    private var releaseLyrics: Runnable? = null

    // ── Frame loop ──────────────────────────────────────────────────────────
    private var framePosted = false
    private var lastFrameNanos = 0L
    private val frame = Choreographer.FrameCallback { nanos ->
        framePosted = false
        val dt = if (lastFrameNanos == 0L) 0f else min(0.05f, (nanos - lastFrameNanos) / 1e9f)
        lastFrameNanos = nanos
        val a = queuePress.step(dt)
        val b = lyricsPress.step(dt)
        invalidate()
        if (a || b) wake() else lastFrameNanos = 0L
    }

    // ── Drawing ─────────────────────────────────────────────────────────────
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val labelPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val rect = RectF()
    private val clip = Path()
    private val matrix = Matrix()
    private var removeFonts: (() -> Unit)? = null
    private val access = Access(this)

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setWillNotDraw(false)
        ViewCompat.setAccessibilityDelegate(this, access)
        applyFonts()
    }

    // ── Props ───────────────────────────────────────────────────────────────

    fun setHasTimer(on: Boolean?) { hasTimer = on ?: false; propsDirty = true }
    fun setSleepLabel(text: String?) { sleepLabel = text.orEmpty(); propsDirty = true }
    fun setOutputDevices(on: Boolean?) { outputDevices = on ?: false; propsDirty = true }
    fun setOutputActive(on: Boolean?) { outputActive = on ?: false; propsDirty = true }
    fun setShowLyrics(on: Boolean?) { showLyrics = on ?: false; propsDirty = true }
    fun setLyricsLongPress(on: Boolean?) { lyricsLongPress = on ?: false; propsDirty = true }
    fun setReduceMotion(on: Boolean?) { reduceMotion = on ?: false; propsDirty = true }
    fun setWaveColor(hex: String?) {
        waveColor = runCatching { Color.parseColor(hex) }.getOrDefault(Color.WHITE)
        propsDirty = true
    }

    fun commit() {
        if (!propsDirty) return
        propsDirty = false
        measureContent()
        access.invalidateRoot()
        invalidate()
    }

    private fun applyFonts() {
        labelPaint.typeface = IslandFonts.semibold
        // `sfTracking(13)` is -0.08 dp of letter spacing on the label, in em.
        labelPaint.letterSpacing = -0.08f / LABEL_SP
        // React Native converts sp with the platform (nonlinear above 100% from Android 14), not density x fontScale.
        labelPaint.textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, LABEL_SP, resources.displayMetrics)
    }

    /** The segment's width follows its content, as the React Native halves do. */
    private fun measureContent() {
        labelDp = if (hasTimer && sleepLabel.isNotEmpty()) labelPaint.measureText(sleepLabel) / density else 0f
        outputW = FooterGeometry.halfWidth(if (outputDevices) ICON_DEVICES else ICON_SPEAKER, 0f)
        timerW = FooterGeometry.halfWidth(ICON_TIMER, labelDp)
        val segmentW = outputW + if (hasTimer) hairlineDp + timerW else 0f
        row = FooterGeometry.row(rowWidthDp(), segmentW)
    }

    private fun rowWidthDp() = max(0f, width / density - 2 * FooterGeometry.SLOP)

    // ── Frame loop ──────────────────────────────────────────────────────────

    private fun wake() {
        if (framePosted || !isAttachedToWindow) return
        framePosted = true
        Choreographer.getInstance().postFrameCallback(frame)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (removeFonts == null) removeFonts = IslandFonts.load(context) { main.post { applyFonts(); measureContent(); invalidate() } }
        measureContent()
    }

    override fun onDetachedFromWindow() {
        Choreographer.getInstance().removeFrameCallback(frame)
        framePosted = false
        lastFrameNanos = 0L
        main.removeCallbacks(longRunnable)
        releaseQueue?.let { main.removeCallbacks(it) }
        releaseLyrics?.let { main.removeCallbacks(it) }
        removeFonts?.invoke()
        removeFonts = null
        // A press cut short by the detach must not come back sunk and dimmed.
        pressed = Target.NONE
        active = false
        queuePress.snap(0f)
        lyricsPress.snap(0f)
        super.onDetachedFromWindow()
    }

    override fun onConfigurationChanged(newConfig: Configuration?) {
        super.onConfigurationChanged(newConfig)
        applyFonts()
        measureContent()
        invalidate()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        measureContent()
    }

    override fun dispatchHoverEvent(event: MotionEvent): Boolean = access.dispatchHoverEvent(event) || super.dispatchHoverEvent(event)

    // ── Touch ───────────────────────────────────────────────────────────────

    private fun target(x: Float, y: Float): Target =
        FooterGeometry.hit(x / density - FooterGeometry.SLOP, y / density - FooterGeometry.SLOP, row, outputW, timerW, hasTimer)

    /** Whether the press that began on [t] is still alive with the finger here (Pressable's retention around that item). */
    private fun stillOn(t: Target, x: Float, y: Float): Boolean =
        FooterGeometry.within(t, x / density - FooterGeometry.SLOP, y / density - FooterGeometry.SLOP, row, outputW, timerW)

    private fun setPress(which: Target, down: Boolean) {
        when (which) {
            Target.QUEUE -> pressTo(queuePress, down, true)
            Target.LYRICS -> pressTo(lyricsPress, down, false)
            else -> Unit
        }
        invalidate()
    }

    /** The press value to [on] (1) or off (0): a spring, or a jump under Reduce Motion (Reanimated's springs jump there). */
    private fun moveSpring(spring: Spring, on: Boolean) {
        if (reduceMotion) spring.snap(if (on) 1f else 0f) else spring.target = if (on) 1f else 0f
        wake()
    }

    /** Down springs in at once; up waits out what is left of MIN_PRESS_MS so a quick tap is still seen. */
    private fun pressTo(spring: Spring, down: Boolean, isQueue: Boolean) {
        val pending = if (isQueue) releaseQueue else releaseLyrics
        pending?.let { main.removeCallbacks(it) }
        if (down) {
            moveSpring(spring, true)
            return
        }
        val held = SystemClock.uptimeMillis() - downAt
        val release = Runnable { moveSpring(spring, false) }
        if (isQueue) releaseQueue = release else releaseLyrics = release
        main.postDelayed(release, max(0L, MIN_PRESS_MS - held))
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val t = target(event.x, event.y)
                if (t == Target.NONE) return false
                pressed = t
                active = true
                longFired = false
                downAt = SystemClock.uptimeMillis()
                setPress(t, true)
                if (t == Target.LYRICS && lyricsLongPress) main.postDelayed(longRunnable, LONG_PRESS_MS)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (pressed == Target.NONE) return false
                // The press stays alive while the finger is near the item (Pressable's retention) and lights again on return.
                val now = stillOn(pressed, event.x, event.y)
                if (now != active) {
                    active = now
                    // Leaving the item cancels a long press that was still counting down (as Pressable does).
                    if (!now) main.removeCallbacks(longRunnable)
                    when (pressed) {
                        Target.QUEUE -> moveSpring(queuePress, now)
                        Target.LYRICS -> moveSpring(lyricsPress, now)
                        else -> Unit
                    }
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                if (pressed == Target.NONE) return false
                main.removeCallbacks(longRunnable)
                val t = pressed
                val fire = active && !longFired
                pressed = Target.NONE
                setPress(t, false)
                if (fire) emit(t)
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                main.removeCallbacks(longRunnable)
                val t = pressed
                pressed = Target.NONE
                if (t != Target.NONE) setPress(t, false)
                return true
            }
        }
        return pressed != Target.NONE
    }

    private fun emit(t: Target) {
        val action = when (t) {
            Target.QUEUE -> "queue"
            Target.OUTPUT -> "output"
            Target.TIMER -> "timer"
            Target.LYRICS -> "lyrics"
            Target.NONE -> return
        }
        onAction(mapOf("action" to action))
    }

    // ── Drawing ─────────────────────────────────────────────────────────────

    override fun onDraw(canvas: Canvas) {
        if (width <= 0) return
        canvas.save()
        canvas.translate(FooterGeometry.SLOP * density, FooterGeometry.SLOP * density)
        drawQueue(canvas)
        drawSegment(canvas)
        drawLyrics(canvas)
        canvas.restore()
    }

    /** `Tactile`: sinks to `pressScale` and dims by 14% on one spring value, about the box's centre. */
    private inline fun tactile(canvas: Canvas, x: Float, press: Float, scale: Float, draw: () -> Unit) {
        // At rest nothing is scaled or dimmed, so no offscreen layer is needed.
        if (press < 0.001f) {
            draw()
            return
        }
        val box = FooterGeometry.BUTTON * density
        // Reduce Motion: it dims only, never moves.
        val s = if (reduceMotion) 1f else 1f + (scale - 1f) * press
        val layer = canvas.saveLayerAlpha(x * density - 2, -2f, x * density + box + 2, box + 2, (255 * (1f - PRESS_DIM * press)).roundToInt())
        canvas.scale(s, s, x * density + box / 2f, box / 2f)
        draw()
        canvas.restoreToCount(layer)
    }

    private fun drawQueue(canvas: Canvas) {
        tactile(canvas, row.queueX, queuePress.value, BUTTON_PRESS_SCALE) {
            icon(canvas, IconGlyphs.ION_LIST, ICON_LIST, (row.queueX + FooterGeometry.BUTTON / 2f), FooterGeometry.ROW_H / 2f, INK_SOFT)
        }
    }

    private fun drawLyrics(canvas: Canvas) {
        tactile(canvas, row.lyricsX, lyricsPress.value, BUTTON_PRESS_SCALE) {
            val cx = (row.lyricsX + FooterGeometry.BUTTON / 2f) * density
            val cy = FooterGeometry.ROW_H / 2f * density
            if (showLyrics) {
                fill.color = Color.argb(230, 255, 255, 255)
                canvas.drawCircle(cx, cy, FooterGeometry.BUTTON / 2f * density, fill)
            }
            icon(canvas, IconGlyphs.MCI_COMMENT_QUOTE_OUTLINE, ICON_LYRICS, row.lyricsX + FooterGeometry.BUTTON / 2f, FooterGeometry.ROW_H / 2f, if (showLyrics) LYRICS_ON_INK else INK_SOFT)
        }
    }

    private fun drawSegment(canvas: Canvas) {
        val h = FooterGeometry.ROW_H * density
        val x = row.segmentX * density
        val w = row.segmentW * density
        rect.set(x, 0f, x + w, h)
        fill.color = Color.argb(36, 255, 255, 255)
        canvas.drawRoundRect(rect, h / 2f, h / 2f, fill)

        // Pressed halves are lit inside the segment's rounded rectangle (overflow hidden).
        val lit = if (active) pressed else Target.NONE
        if (lit == Target.OUTPUT || lit == Target.TIMER) {
            canvas.save()
            clip.reset()
            clip.addRoundRect(rect, h / 2f, h / 2f, Path.Direction.CW)
            canvas.clipPath(clip)
            fill.color = Color.argb(31, 255, 255, 255)
            if (lit == Target.OUTPUT) canvas.drawRect(x, 0f, x + outputW * density, h, fill)
            else canvas.drawRect(x + (outputW + hairlineDp) * density, 0f, x + w, h, fill)
            canvas.restore()
        }

        val cy = FooterGeometry.ROW_H / 2f
        // The output half: Connect's device picker (lit while another device plays) or the phone's output switcher.
        if (outputDevices) {
            icon(canvas, IconGlyphs.MCI_DEVICES, ICON_DEVICES, row.segmentX + outputW / 2f, cy, if (outputActive) waveColor else INK_SOFT)
        } else {
            icon(canvas, IconGlyphs.MCI_SPEAKER, ICON_SPEAKER, row.segmentX + outputW / 2f, cy, INK_SOFT)
        }
        if (!hasTimer) return

        val dividerX = (row.segmentX + outputW) * density
        fill.color = Color.argb(77, 255, 255, 255)
        val dh = FooterGeometry.DIVIDER_H * density
        canvas.drawRect(dividerX, (h - dh) / 2f, dividerX + hairlineDp * density, (h + dh) / 2f, fill)

        val timerX = row.segmentX + outputW + hairlineDp
        val ink = if (sleepLabel.isNotEmpty()) Color.WHITE else INK_SOFT
        val content = ICON_TIMER + if (labelDp > 0f) FooterGeometry.HALF_GAP + labelDp else 0f
        val left = timerX + (timerW - content) / 2f
        icon(canvas, IconGlyphs.MCI_TIMER_OUTLINE, ICON_TIMER, left + ICON_TIMER / 2f, cy, ink)
        if (labelDp > 0f) {
            val m = labelPaint.fontMetrics
            // React Native's Text keeps the font padding: the line is top..bottom, centred on the row.
            val baseline = cy * density - (m.top + m.bottom) / 2f
            canvas.drawText(sleepLabel, (left + ICON_TIMER + FooterGeometry.HALF_GAP) * density, baseline, labelPaint)
        }
    }

    // ── Icons ───────────────────────────────────────────────────────────────

    /** A glyph [sizeDp] big, centred on ([cxDp], [cyDp]); its outline is on a 512 grid centred on (0, 0). */
    private fun icon(canvas: Canvas, data: String, sizeDp: Float, cxDp: Float, cyDp: Float, color: Int) {
        val path = paths.getOrPut(data) { runCatching { PathParser.createPathFromPathData(data) }.getOrNull() } ?: return
        val k = sizeDp * density / IconGlyphs.GRID
        matrix.setScale(k, k)
        matrix.postTranslate(cxDp * density, cyDp * density)
        val out = scratch
        out.reset()
        path.transform(matrix, out)
        iconPaint.color = color
        canvas.drawPath(out, iconPaint)
    }

    private val scratch = Path()

    // ── Accessibility ───────────────────────────────────────────────────────

    private inner class Access(host: View) : ExploreByTouchHelper(host) {
        private fun ids() = buildList {
            add(QUEUE_ID); add(OUTPUT_ID)
            if (hasTimer) add(TIMER_ID)
            add(LYRICS_ID)
        }

        override fun getVirtualViewAt(x: Float, y: Float): Int = when (target(x, y)) {
            Target.QUEUE -> QUEUE_ID
            Target.OUTPUT -> OUTPUT_ID
            Target.TIMER -> TIMER_ID
            Target.LYRICS -> LYRICS_ID
            Target.NONE -> INVALID_ID
        }

        override fun getVisibleVirtualViews(out: MutableList<Int>) { out += ids() }

        override fun onPopulateNodeForVirtualView(id: Int, node: AccessibilityNodeInfoCompat) {
            val (left, width) = when (id) {
                QUEUE_ID -> row.queueX to FooterGeometry.BUTTON
                OUTPUT_ID -> row.segmentX to outputW
                TIMER_ID -> row.segmentX + outputW + hairlineDp to timerW
                else -> row.lyricsX to FooterGeometry.BUTTON
            }
            val ox = FooterGeometry.SLOP * density
            node.setBoundsInParent(Rect((ox + left * density).roundToInt(), ox.roundToInt(), (ox + (left + width) * density).roundToInt(), (ox + FooterGeometry.ROW_H * density).roundToInt()))
            node.className = "android.widget.Button"
            node.isClickable = true
            node.addAction(AccessibilityNodeInfoCompat.ACTION_CLICK)
            when (id) {
                QUEUE_ID -> node.contentDescription = "Up next"
                OUTPUT_ID -> node.contentDescription = "Play on another device"
                TIMER_ID -> node.contentDescription = "Sleep timer"
                else -> {
                    node.contentDescription = if (showLyrics) "Hide lyrics" else "Show lyrics"
                    node.hintText = "Long press to choose from every lyrics source. Triple tap to switch letter by letter and line by line."
                    if (lyricsLongPress) {
                        node.addAction(AccessibilityNodeInfoCompat.ACTION_LONG_CLICK)
                        node.isLongClickable = true
                    }
                }
            }
        }

        override fun onPerformActionForVirtualView(id: Int, action: Int, arguments: Bundle?): Boolean {
            val t = when (id) {
                QUEUE_ID -> Target.QUEUE
                OUTPUT_ID -> Target.OUTPUT
                TIMER_ID -> Target.TIMER
                else -> Target.LYRICS
            }
            return when (action) {
                AccessibilityNodeInfoCompat.ACTION_CLICK -> {
                    emit(t)
                    sendEventForVirtualView(id, AccessibilityEvent.TYPE_VIEW_CLICKED)
                    true
                }
                AccessibilityNodeInfoCompat.ACTION_LONG_CLICK ->
                    if (t == Target.LYRICS && lyricsLongPress) { onAction(mapOf("action" to "lyricsLong")); true } else false
                else -> false
            }
        }
    }

    private companion object {
        const val QUEUE_ID = 0
        const val OUTPUT_ID = 1
        const val TIMER_ID = 2
        const val LYRICS_ID = 3

        // Icon sizes in dp, as NowPlayingControls gives them.
        const val ICON_LIST = 26f
        const val ICON_SPEAKER = 22f
        const val ICON_DEVICES = 21f
        const val ICON_TIMER = 21f
        const val ICON_LYRICS = 24f

        const val LABEL_SP = 13f
        const val PRESS_DIM = 0.14f
        const val BUTTON_PRESS_SCALE = 0.86f
        const val MIN_PRESS_MS = 70L
        const val LONG_PRESS_MS = 420L

        // Motion.spring.tactile: stiffness 700, damping 40, mass 0.8.
        const val SPRING_K = 875f
        const val SPRING_ZETA = 0.845f

        val INK_SOFT = Color.argb(158, 255, 255, 255)
        val LYRICS_ON_INK = Color.parseColor("#15151A")

        val paths = HashMap<String, Path?>()
    }
}
