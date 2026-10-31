package com.lyricflow.app.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Paint
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityEvent
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.customview.widget.ExploreByTouchHelper
import com.lyricflow.app.island.Spring
import com.lyricflow.app.views.SongActionsGeometry.Button
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * The round glass buttons at the end of Now Playing's title row, drawn in Kotlin: fullscreen lyrics, song options and
 * the like heart, with the React Native row's look and feel (`roundGlass`, `Tactile` at 0.88, `MorphIcon`'s turning
 * heart, `SavingPulse`'s breathing while a streamed song saves). The row stays React Native as the fallback (iOS,
 * builds without this view, and the Connect remote player's controls).
 *
 * The view decides nothing: a tap comes back through `onAction` (`fullscreen | more | like`) and JavaScript runs the
 * same handlers as before (the haptic tick, opening the sheet, toggling the like).
 *
 * The view is [slop] larger than the cluster on every side so the buttons' hit slop lies inside its bounds; the caller
 * gives it negative margins and makes sure its parents' bounds contain it.
 */
class NativeSongActionsView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onAction by EventDispatcher<Map<String, Any>>()

    private val density = resources.displayMetrics.density
    private val main = Handler(Looper.getMainLooper())
    private val glyphs = GlyphPainter(density)

    // ── Props, applied in one batch (commit) ────────────────────────────────
    private var fullscreen = "none"
    private var hasMore = false
    private var liked = false
    private var saving = false
    private var slop = 8f
    private var likeLabel = "Like"
    private var reduceMotion = false
    private var propsDirty = false
    private var appliedLiked: Boolean? = null
    private var appliedPulsing = false
    private var buttons: List<Button> = listOf(Button.LIKE)

    // ── Press state ─────────────────────────────────────────────────────────
    private var pressed = -1
    private var active = false
    private var downAt = 0L
    private val press = Array(MAX_BUTTONS) { Spring(0f, SPRING_K, SPRING_ZETA) }
    private val releases = arrayOfNulls<Runnable>(MAX_BUTTONS)

    // ── Like: the glyph morph and the saving pulse ──────────────────────────
    private val morph = Spring(0f, SPRING_K, SPRING_ZETA)
    private var pulse = 1f
    private var pulseMode = Pulse.REST
    private var pulseStart = 0L
    private var pulseFrom = 1f

    private enum class Pulse { REST, LOOP, RETURN }

    // ── Frame loop ──────────────────────────────────────────────────────────
    private var visible = true
    private var framePosted = false
    private var lastFrameNanos = 0L
    private val frame = Choreographer.FrameCallback { nanos ->
        framePosted = false
        val dt = if (lastFrameNanos == 0L) 0f else min(0.05f, (nanos - lastFrameNanos) / 1e9f)
        lastFrameNanos = nanos
        var busy = false
        for (s in press) if (s.step(dt)) busy = true
        if (morph.step(dt)) busy = true
        if (stepPulse(SystemClock.uptimeMillis())) busy = true
        invalidate()
        if (busy) wake() else lastFrameNanos = 0L
    }

    private val access = Access(this)

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setWillNotDraw(false)
        ViewCompat.setAccessibilityDelegate(this, access)
    }

    // ── Props ───────────────────────────────────────────────────────────────

    fun setFullscreen(mode: String?) { fullscreen = mode ?: "none"; propsDirty = true }
    fun setHasMore(on: Boolean?) { hasMore = on ?: false; propsDirty = true }
    fun setLiked(on: Boolean?) { liked = on ?: false; propsDirty = true }
    fun setSaving(on: Boolean?) { saving = on ?: false; propsDirty = true }
    fun setSlop(dp: Double?) { slop = (dp ?: 8.0).toFloat(); propsDirty = true }
    fun setLikeLabel(text: String?) { likeLabel = text ?: "Like"; propsDirty = true }
    fun setReduceMotion(on: Boolean?) { reduceMotion = on ?: false; propsDirty = true }

    fun commit() {
        if (!propsDirty) return
        propsDirty = false
        buttons = SongActionsGeometry.shown(fullscreen != "none", hasMore)
        if (appliedLiked != liked) {
            val first = appliedLiked == null
            appliedLiked = liked
            // MorphIcon: a spring, or an instant timing under Reduce Motion; the first draw has nothing to animate.
            if (first || reduceMotion) morph.snap(if (liked) 1f else 0f) else morph.target = if (liked) 1f else 0f
        }
        // SavingPulse's effect depends on both `saving` and Reduce Motion, so either changing re-decides the pulse.
        val pulsing = saving && !reduceMotion
        if (appliedPulsing != pulsing) {
            appliedPulsing = pulsing
            val now = SystemClock.uptimeMillis()
            if (pulsing) {
                // Start the breathing from where the heart is now (a restart during the return must not jump to full).
                pulseMode = Pulse.LOOP
                pulseStart = now - (phaseOf(pulse) * PULSE_HALF_MS).toLong()
            } else {
                // withTiming(1, 160) from the current value, Reduce Motion or not.
                pulseMode = if (pulse < 1f) Pulse.RETURN else Pulse.REST
                pulseFrom = pulse
                pulseStart = now
            }
        }
        access.invalidateRoot()
        invalidate()
        wake()
    }

    /** SavingPulse: the heart breathes 1 to 0.4 to 1 (600 ms each, quad in-out) while saving, and returns in 160 ms. */
    private fun stepPulse(now: Long): Boolean = when (pulseMode) {
        Pulse.REST -> false
        Pulse.LOOP -> {
            val t = ((now - pulseStart) % PULSE_CYCLE_MS) / PULSE_HALF_MS.toFloat()
            pulse = if (t < 1f) 1f - 0.6f * easeInOutQuad(t) else 0.4f + 0.6f * easeInOutQuad(t - 1f)
            true
        }
        Pulse.RETURN -> {
            val t = ((now - pulseStart) / PULSE_RETURN_MS.toFloat()).coerceIn(0f, 1f)
            pulse = pulseFrom + (1f - pulseFrom) * easeInOutQuad(t)
            if (t >= 1f) {
                pulseMode = Pulse.REST
                pulse = 1f
            }
            t < 1f
        }
    }

    private fun easeInOutQuad(t: Float) = if (t < 0.5f) 2f * t * t else 1f - (-2f * t + 2f).let { it * it } / 2f

    /** Where in the downward half of the breath (0..1) the heart is at opacity [v]: the inverse of the ease. */
    private fun phaseOf(v: Float): Float {
        val e = ((1f - v) / 0.6f).coerceIn(0f, 1f)
        return if (e < 0.5f) sqrt(e / 2f) else 1f - sqrt((1f - e) / 2f)
    }

    private fun wake() {
        if (framePosted || !isAttachedToWindow || !visible) return
        framePosted = true
        Choreographer.getInstance().postFrameCallback(frame)
    }

    override fun onVisibilityAggregated(isVisible: Boolean) {
        super.onVisibilityAggregated(isVisible)
        if (visible == isVisible) return
        visible = isVisible
        if (visible) {
            if (pulseMode == Pulse.LOOP) pulseStart = SystemClock.uptimeMillis()
            invalidate()
            wake()
        } else {
            Choreographer.getInstance().removeFrameCallback(frame)
            framePosted = false
            lastFrameNanos = 0L
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        wake()
    }

    override fun onDetachedFromWindow() {
        Choreographer.getInstance().removeFrameCallback(frame)
        framePosted = false
        lastFrameNanos = 0L
        for (r in releases) r?.let { main.removeCallbacks(it) }
        // A press cut short by the detach must not come back sunk and dimmed.
        pressed = -1
        active = false
        for (s in press) s.snap(0f)
        super.onDetachedFromWindow()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    override fun dispatchHoverEvent(event: MotionEvent): Boolean = access.dispatchHoverEvent(event) || super.dispatchHoverEvent(event)

    // ── Touch ───────────────────────────────────────────────────────────────

    private fun toDpX(x: Float) = x / density - slop
    private fun toDpY(y: Float) = y / density - slop

    private fun moveSpring(spring: Spring, on: Boolean) {
        // Reduce Motion: Reanimated's springs jump, and the press dims without scaling.
        if (reduceMotion) spring.snap(if (on) 1f else 0f) else spring.target = if (on) 1f else 0f
        wake()
    }

    /** Down springs in at once; up waits out what is left of MIN_PRESS_MS so a quick tap is still seen. */
    private fun pressTo(i: Int, down: Boolean) {
        releases[i]?.let { main.removeCallbacks(it) }
        if (down) {
            moveSpring(press[i], true)
            return
        }
        val held = SystemClock.uptimeMillis() - downAt
        val release = Runnable { moveSpring(press[i], false) }
        releases[i] = release
        main.postDelayed(release, max(0L, MIN_PRESS_MS - held))
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val i = SongActionsGeometry.hit(toDpX(event.x), toDpY(event.y), buttons.size, slop) ?: return false
                pressed = i
                active = true
                downAt = SystemClock.uptimeMillis()
                pressTo(i, true)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (pressed < 0) return false
                val now = SongActionsGeometry.within(pressed, toDpX(event.x), toDpY(event.y), slop)
                if (now != active) {
                    active = now
                    moveSpring(press[pressed], now)
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                if (pressed < 0) return false
                val i = pressed
                val fire = active
                pressed = -1
                pressTo(i, false)
                if (fire) emit(i)
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                val i = pressed
                pressed = -1
                if (i >= 0) pressTo(i, false)
                return true
            }
        }
        return pressed >= 0
    }

    private fun emit(index: Int) {
        val action = when (buttons.getOrNull(index)) {
            Button.FULLSCREEN -> "fullscreen"
            Button.MORE -> "more"
            Button.LIKE -> "like"
            null -> return
        }
        onAction(mapOf("action" to action))
    }

    // ── Drawing ─────────────────────────────────────────────────────────────

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)

    override fun onDraw(canvas: Canvas) {
        canvas.save()
        canvas.translate(slop * density, slop * density)
        for ((i, button) in buttons.withIndex()) drawButton(canvas, i, button)
        canvas.restore()
    }

    /** `Tactile` at pressScale 0.88: the whole button sinks and dims by 14% on one spring value, about its centre. */
    private fun drawButton(canvas: Canvas, i: Int, button: Button) {
        val p = press[i].value
        val box = SongActionsGeometry.BUTTON * density
        val x = SongActionsGeometry.left(i) * density
        val cxDp = SongActionsGeometry.left(i) + SongActionsGeometry.BUTTON / 2f
        val cyDp = SongActionsGeometry.BUTTON / 2f
        val layer = if (p >= 0.001f) canvas.saveLayerAlpha(x - 2, -2f, x + box + 2, box + 2, (255 * (1f - PRESS_DIM * p)).roundToInt()) else -1
        if (layer >= 0 && !reduceMotion) {
            val s = 1f + (PRESS_SCALE - 1f) * p
            canvas.scale(s, s, cxDp * density, cyDp * density)
        }
        // roundGlass: a 38 dp disc of white at 0.16.
        fill.color = Color.argb(41, 255, 255, 255)
        canvas.drawCircle(cxDp * density, cyDp * density, box / 2f, fill)
        when (button) {
            Button.FULLSCREEN -> glyphs.draw(canvas, if (fullscreen == "exit") IconGlyphs.MCI_FULLSCREEN_EXIT else IconGlyphs.MCI_FULLSCREEN, ICON_FULLSCREEN, cxDp, cyDp, Color.WHITE)
            Button.MORE -> glyphs.draw(canvas, IconGlyphs.ION_ELLIPSIS_VERTICAL, ICON_MORE, cxDp, cyDp, Color.WHITE)
            Button.LIKE -> drawLike(canvas, cxDp, cyDp)
        }
        if (layer >= 0) canvas.restoreToCount(layer)
    }

    /** `MorphIcon` inside `SavingPulse`: the outline turns away and shrinks as the filled heart turns in and grows. */
    private fun drawLike(canvas: Canvas, cxDp: Float, cyDp: Float) {
        val m = SongActionsGeometry.morph(morph.value)
        val box = ICON_LIKE * density
        val pulseLayer = if (pulse < 0.999f) {
            canvas.saveLayerAlpha(cxDp * density - box, cyDp * density - box, cxDp * density + box, cyDp * density + box, (255 * pulse).roundToInt())
        } else -1
        if (m.offAlpha > 0.001f) {
            glyphs.draw(canvas, IconGlyphs.ION_HEART_OUTLINE, ICON_LIKE, cxDp, cyDp, Color.argb((255 * m.offAlpha).roundToInt(), 255, 255, 255), m.offRotate, m.offScale)
        }
        if (m.onAlpha > 0.001f) {
            glyphs.draw(canvas, IconGlyphs.ION_HEART, ICON_LIKE, cxDp, cyDp, Color.argb((255 * m.onAlpha).roundToInt(), 255, 255, 255), m.onRotate, m.onScale)
        }
        if (pulseLayer >= 0) canvas.restoreToCount(pulseLayer)
    }

    // ── Accessibility ───────────────────────────────────────────────────────

    private inner class Access(host: View) : ExploreByTouchHelper(host) {
        override fun getVirtualViewAt(x: Float, y: Float): Int =
            SongActionsGeometry.hit(toDpX(x), toDpY(y), buttons.size, slop) ?: INVALID_ID

        override fun getVisibleVirtualViews(out: MutableList<Int>) {
            for (i in buttons.indices) out += i
        }

        override fun onPopulateNodeForVirtualView(id: Int, node: AccessibilityNodeInfoCompat) {
            val button = buttons.getOrNull(id)
            if (button == null) {
                node.contentDescription = ""
                node.setBoundsInParent(Rect(0, 0, 1, 1))
                return
            }
            val o = slop * density
            val left = (o + SongActionsGeometry.left(id) * density).roundToInt()
            node.setBoundsInParent(Rect(left, o.roundToInt(), left + (SongActionsGeometry.BUTTON * density).roundToInt(), (o + SongActionsGeometry.BUTTON * density).roundToInt()))
            node.className = "android.widget.Button"
            node.isClickable = true
            node.addAction(AccessibilityNodeInfoCompat.ACTION_CLICK)
            node.contentDescription = when (button) {
                Button.FULLSCREEN -> if (fullscreen == "exit") "Exit lyrics fullscreen" else "Open lyrics fullscreen"
                Button.MORE -> "Song options"
                Button.LIKE -> likeLabel
            }
        }

        override fun onPerformActionForVirtualView(id: Int, action: Int, arguments: Bundle?): Boolean {
            if (action != AccessibilityNodeInfoCompat.ACTION_CLICK || id !in buttons.indices) return false
            emit(id)
            sendEventForVirtualView(id, AccessibilityEvent.TYPE_VIEW_CLICKED)
            return true
        }
    }

    private companion object {
        const val MAX_BUTTONS = 3

        // Icon sizes in dp, as NowPlayingControls gives them.
        const val ICON_FULLSCREEN = 19f
        const val ICON_MORE = 18f
        const val ICON_LIKE = 20f

        const val PRESS_DIM = 0.14f
        const val PRESS_SCALE = 0.88f
        const val MIN_PRESS_MS = 70L
        const val PULSE_HALF_MS = 600L
        const val PULSE_CYCLE_MS = 1200L
        const val PULSE_RETURN_MS = 160L

        // Motion.spring.tactile: stiffness 700, damping 40, mass 0.8.
        const val SPRING_K = 875f
        const val SPRING_ZETA = 0.845f
    }
}
