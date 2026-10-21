package com.lyricflow.app.views

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextPaint
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.media3.common.C
import androidx.media3.common.Player
import com.lyricflow.app.island.IslandFonts
import com.lyricflow.app.island.IslandPlayback
import com.lyricflow.app.island.Spring
import com.lyricflow.app.scrubber.ScrubberMath
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Now Playing's song scrubber, drawn in Kotlin: the rounded track and its fill that swells under the finger, and the
 * elapsed / length labels under it. The same look and gestures as `AppleSlider` + `TimeLabels` in React Native, which
 * stay as the fallback for iOS, builds without this view and Connect's remote player (its clock is JavaScript's).
 *
 * One playback authority: the position is the Media3 player's own `currentPosition`, read here while the player is on
 * the song this view was given (media IDs are song IDs); otherwise it holds at the position JavaScript last knew. The
 * view never seeks: a drag or tap hands the chosen seconds back through `onCommit`, and JavaScript seeks through the
 * existing flow (which resumes playback if it was playing).
 *
 * The view is laid over an invisible React Native spacer that gives it exactly the old layout's height.
 */
class NativeScrubberView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onCommit by EventDispatcher<Map<String, Any>>()

    private val density = resources.displayMetrics.density
    private val main = Handler(Looper.getMainLooper())
    private val configuration = ViewConfiguration.get(context)

    // ── Props, applied in one batch (commit) ────────────────────────────────
    private var songId = ""
    private var seedSec = 0.0
    private var durationSeedSec = 0.0
    private var live = false
    private var trackDp = 10f
    private var label = "Song position"
    private var propsDirty = false
    private var appliedSong = ""

    // ── Clock ───────────────────────────────────────────────────────────────
    private var player: Player? = null
    private var unwatch: (() -> Unit)? = null
    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            checkSettled()
            invalidate()
            schedule()
        }
    }

    // ── Gesture state ───────────────────────────────────────────────────────
    private var downX = 0f
    private var downY = 0f
    private var downAt = 0L
    private var touching = false
    private var claimed = false
    private var yielded = false
    private var dragging = false
    private var settling = false
    private var settleTarget = 0.0
    private var settleSince = 0L
    private var dragValue = 0f
    // Motion.spring.tactile: stiffness 700, damping 40, mass 0.8.
    private val grow = Spring(0f, SPRING_K, SPRING_ZETA)

    // ── Frame loop ──────────────────────────────────────────────────────────
    private var framePosted = false
    private var tickPosted = false
    private var lastFrameNanos = 0L
    private val frame = Choreographer.FrameCallback { nanos ->
        framePosted = false
        val dt = if (lastFrameNanos == 0L) 0f else min(0.05f, (nanos - lastFrameNanos) / 1e9f)
        lastFrameNanos = nanos
        grow.step(dt)
        checkSettled()
        invalidate()
        if (busy()) postFrame() else {
            lastFrameNanos = 0L
            schedule()
        }
    }
    private val tick = Runnable {
        tickPosted = false
        checkSettled()
        if (changedSinceDrawn()) invalidate()
        schedule()
    }

    // ── Drawing ─────────────────────────────────────────────────────────────
    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(56, 255, 255, 255) }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val labelPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(219, 255, 255, 255)
        fontFeatureSettings = "tnum"
    }
    private val rect = RectF()
    private var shownFraction = -1f
    private var shownElapsed = -1
    private var shownLength = -1
    private var removeFonts: (() -> Unit)? = null

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setWillNotDraw(false)
        ViewCompat.setAccessibilityDelegate(this, Access())
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        applyFonts()
    }

    // ── Props ───────────────────────────────────────────────────────────────

    fun setSongId(id: String?) { songId = id.orEmpty(); propsDirty = true }
    fun setSeed(sec: Double?) { seedSec = (sec ?: 0.0).coerceAtLeast(0.0); propsDirty = true }
    fun setDuration(sec: Double?) { durationSeedSec = (sec ?: 0.0).coerceAtLeast(0.0); propsDirty = true }
    fun setLive(on: Boolean?) { live = on ?: false; propsDirty = true }
    fun setTrackHeight(dp: Double?) { trackDp = (dp ?: 10.0).toFloat(); propsDirty = true }
    fun setLabel(text: String?) { label = text ?: "Song position"; propsDirty = true }

    fun commit() {
        if (!propsDirty) return
        propsDirty = false
        if (songId != appliedSong) {
            // Another recording: nothing the finger chose belongs to it.
            appliedSong = songId
            cancelGesture()
            settling = false
        }
        invalidate()
        schedule()
    }

    private fun applyFonts() {
        labelPaint.typeface = IslandFonts.semibold
        labelPaint.textSize = LABEL_SP * density * resources.configuration.fontScale
    }

    // ── The clock ───────────────────────────────────────────────────────────

    private fun onSong(): Boolean = songId.isNotEmpty() && player?.currentMediaItem?.mediaId == songId

    private fun positionSec(): Double {
        val p = player
        // Only the recording this view was given moves it; anything else holds at the position JavaScript last knew.
        return if (p != null && onSong()) p.currentPosition.coerceAtLeast(0) / 1000.0 else seedSec
    }

    private fun durationSec(): Double {
        if (durationSeedSec > 0.0) return durationSeedSec
        val p = player
        if (p != null && onSong()) {
            val ms = p.duration
            if (ms != C.TIME_UNSET && ms > 0) return ms / 1000.0
        }
        return 0.0
    }

    private fun isPlaying(): Boolean = player?.let { it.isPlaying && onSong() } == true

    private fun shownValue(): Float =
        ScrubberMath.display(dragging, settling, dragValue, ScrubberMath.progress(positionSec(), durationSec()))

    private fun checkSettled() {
        if (!settling) return
        val landed = onSong() && ScrubberMath.settled(positionSec(), settleTarget)
        if (landed || SystemClock.uptimeMillis() - settleSince > ScrubberMath.SETTLE_MAX_MS) {
            settling = false
            invalidate()
        }
    }

    /** True when what is on screen would differ from what was last drawn (a pixel of fill or a changed label). */
    private fun changedSinceDrawn(): Boolean {
        val d = durationSec()
        val f = shownValue()
        return abs(f * width - shownFraction * width) >= 0.25f ||
            (f * d).toInt() != shownElapsed || d.toInt() != shownLength
    }

    private fun busy() = dragging || settling || !grow.atRest

    private fun postFrame() {
        if (framePosted || !isAttachedToWindow) return
        framePosted = true
        Choreographer.getInstance().postFrameCallback(frame)
    }

    /** Frames while something moves; a gentle tick while the song plays; nothing when it is paused and still. */
    private fun schedule() {
        if (!isAttachedToWindow || !live) return
        if (busy()) {
            postFrame()
            return
        }
        if (isPlaying() && !tickPosted) {
            tickPosted = true
            main.postDelayed(tick, TICK_MS)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        unwatch = IslandPlayback.watch { p ->
            player?.removeListener(listener)
            player = p
            p?.addListener(listener)
            invalidate()
            schedule()
        }
        if (removeFonts == null) removeFonts = IslandFonts.load(context) { main.post { applyFonts(); invalidate() } }
        schedule()
    }

    override fun onDetachedFromWindow() {
        unwatch?.invoke()
        unwatch = null
        player?.removeListener(listener)
        player = null
        Choreographer.getInstance().removeFrameCallback(frame)
        framePosted = false
        lastFrameNanos = 0L
        main.removeCallbacks(tick)
        tickPosted = false
        removeFonts?.invoke()
        removeFonts = null
        super.onDetachedFromWindow()
    }

    override fun onConfigurationChanged(newConfig: Configuration?) {
        super.onConfigurationChanged(newConfig)
        applyFonts()
        invalidate()
    }

    // ── Touch ───────────────────────────────────────────────────────────────

    private fun hitPx() = ScrubberMath.HIT_DP * density

    private fun cancelGesture() {
        touching = false
        claimed = false
        yielded = false
        dragging = false
        grow.target = 0f
        postFrame()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                // Only the strip around the track is the slider's; the labels below it take no touches.
                if (event.y > hitPx() || durationSec() <= 0.0) return false
                touching = true
                claimed = false
                yielded = false
                downX = event.x
                downY = event.y
                downAt = SystemClock.uptimeMillis()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (!touching) return false
                if (!claimed && !yielded) {
                    when (ScrubberMath.classify(event.x - downX, event.y - downY, ScrubberMath.ACTIVE_X_DP * density, ScrubberMath.FAIL_Y_DP * density)) {
                        ScrubberMath.Move.CLAIM -> {
                            claimed = true
                            dragging = true
                            settling = false
                            grow.target = 1f
                            // A sideways drag on the bar is the scrubber's: it cancels the gestures above it.
                            parent?.requestDisallowInterceptTouchEvent(true)
                            postFrame()
                        }
                        ScrubberMath.Move.YIELD -> yielded = true
                        ScrubberMath.Move.WAIT -> Unit
                    }
                }
                if (claimed) {
                    dragValue = ScrubberMath.fractionAt(event.x, width.toFloat())
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                if (!touching) return false
                val travel = Math.hypot((event.x - downX).toDouble(), (event.y - downY).toDouble()).toFloat()
                when {
                    claimed -> {
                        dragValue = ScrubberMath.fractionAt(event.x, width.toFloat())
                        dragging = false
                        grow.target = 0f
                        commitFraction(dragValue)
                    }
                    !yielded && ScrubberMath.isTap(SystemClock.uptimeMillis() - downAt, travel, configuration.scaledTouchSlop.toFloat()) -> {
                        commitFraction(ScrubberMath.fractionAt(event.x, width.toFloat()))
                    }
                }
                touching = false
                claimed = false
                yielded = false
                postFrame()
                invalidate()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                // A cancelled drag seeks nowhere: the song carries on from where it was.
                if (touching) cancelGesture()
                invalidate()
                return true
            }
        }
        return touching
    }

    /** The finger chose a place: hold it on screen and hand the seconds to JavaScript, which seeks. */
    private fun commitFraction(fraction: Float) {
        val d = durationSec()
        if (d <= 0.0) return
        commitSeconds(fraction * d)
    }

    private fun commitSeconds(seconds: Double) {
        val d = durationSec()
        if (d <= 0.0) return
        val s = seconds.coerceIn(0.0, d)
        dragValue = (s / d).toFloat()
        settleTarget = s
        settleSince = SystemClock.uptimeMillis()
        settling = true
        onCommit(mapOf("seconds" to s, "fraction" to dragValue.toDouble()))
        invalidate()
        schedule()
    }

    // ── Layout ──────────────────────────────────────────────────────────────

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    // ── Drawing ─────────────────────────────────────────────────────────────

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        if (w <= 0f) return
        val duration = durationSec()
        val shown = shownValue()
        shownFraction = shown
        val cy = hitPx() / 2f
        val th = trackDp * density
        rect.set(0f, cy - th / 2f, w, cy + th / 2f)

        // The track swells by scaleY about its centre (its corners go elliptical, as the React Native view's do).
        canvas.save()
        canvas.scale(1f, ScrubberMath.trackScale(grow.value), w / 2f, cy)
        canvas.drawRoundRect(rect, th / 2f, th / 2f, trackPaint)
        fillPaint.color = Color.argb((255 * ScrubberMath.fillAlpha(grow.value)).roundToInt(), 255, 255, 255)
        canvas.save()
        canvas.clipRect(0f, rect.top, shown * w, rect.bottom)
        canvas.drawRoundRect(rect, th / 2f, th / 2f, fillPaint)
        canvas.restore()
        canvas.restore()

        // Elapsed on the left, the song's length on the right; React Native's Text keeps the font padding (top..bottom).
        val metrics = labelPaint.fontMetrics
        val base = (ScrubberMath.HIT_DP + ScrubberMath.LABEL_GAP_DP) * density - metrics.top
        val pad = ScrubberMath.LABEL_PAD_DP * density
        shownElapsed = (shown * duration).toInt()
        shownLength = duration.toInt()
        labelPaint.textAlign = Paint.Align.LEFT
        canvas.drawText(ScrubberMath.formatTime(shown * duration), pad, base, labelPaint)
        labelPaint.textAlign = Paint.Align.RIGHT
        canvas.drawText(ScrubberMath.formatTime(duration), w - pad, base, labelPaint)
    }

    // ── Accessibility ───────────────────────────────────────────────────────

    private inner class Access : AccessibilityDelegateCompat() {
        override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
            super.onInitializeAccessibilityNodeInfo(host, info)
            val d = durationSec()
            val at = shownValue() * d
            info.className = "android.widget.SeekBar"
            info.contentDescription = label
            info.stateDescription = "${ScrubberMath.formatTime(at)} of ${ScrubberMath.formatTime(d)}"
            if (d > 0.0) {
                info.rangeInfo = AccessibilityNodeInfoCompat.RangeInfoCompat.obtain(
                    AccessibilityNodeInfoCompat.RangeInfoCompat.RANGE_TYPE_INT, 0f, d.toFloat(), at.toFloat(),
                )
                info.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_SET_PROGRESS)
            }
        }

        override fun performAccessibilityAction(host: View, action: Int, args: Bundle?): Boolean {
            if (action == AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_SET_PROGRESS.id) {
                val value = args?.getFloat(AccessibilityNodeInfoCompat.ACTION_ARGUMENT_PROGRESS_VALUE) ?: return false
                commitSeconds(value.toDouble())
                return true
            }
            return super.performAccessibilityAction(host, action, args)
        }
    }

    private companion object {
        const val LABEL_SP = 13f
        const val TICK_MS = 66L
        const val SPRING_K = 875f
        const val SPRING_ZETA = 0.845f
    }
}
