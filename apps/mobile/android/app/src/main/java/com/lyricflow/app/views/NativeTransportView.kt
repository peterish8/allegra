package com.lyricflow.app.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.SystemClock
import android.util.Log
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.accessibility.AccessibilityNodeInfo
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.lyricflow.app.BuildConfig
import com.lyricflow.app.modules.PlayerBridge
import com.lyricflow.app.playback.resumePlayback
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs

/** App transport uses the same main-thread player as the island, including its icon and accessibility state. */
class NativeTransportView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    var plain = false
        set(value) { field = value; invalidate() }
    var tint = android.graphics.Color.WHITE
        set(value) { field = value; invalidate() }
    var surface = android.graphics.Color.TRANSPARENT
        set(value) { field = value; invalidate() }
    var glyphDp = 26f
        set(value) { field = value; invalidate() }
    var pressDuration = 100L
    var reduceMotion = false
    private var observed: ExoPlayer? = null
    private var playing = false
    private var downX = 0f
    private var downY = 0f
    private var tracking = false
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val onFallback by EventDispatcher<Map<String, Any>>()
    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) { updateState() }
    }

    init {
        setWillNotDraw(false)
        isClickable = true
        isFocusable = true
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    }

    fun refresh() {
        val player = PlayerBridge.getPlayer()
        if (observed !== player) {
            observed?.removeListener(listener)
            observed = player
            observed?.addListener(listener)
        }
        updateState()
    }
    private fun updateState() {
        playing = observed?.let { it.playWhenReady && it.playbackState != Player.STATE_ENDED } ?: false
        contentDescription = if (playing) "Pause" else "Play"
        invalidate()
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); refresh() }
    override fun onDetachedFromWindow() { observed?.removeListener(listener); observed = null; animate().cancel(); super.onDetachedFromWindow() }
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f
        val cy = height / 2f
        if (!plain) {
            paint.color = surface
            canvas.drawCircle(cx, cy, minOf(cx, cy), paint)
        }
        paint.color = tint
        val size = glyphDp * resources.displayMetrics.density
        if (playing) {
            val bar = size * 0.2f
            val gap = size * 0.12f
            canvas.drawRoundRect(RectF(cx - gap - bar, cy - size * 0.38f, cx - gap, cy + size * 0.38f), bar * 0.15f, bar * 0.15f, paint)
            canvas.drawRoundRect(RectF(cx + gap, cy - size * 0.38f, cx + gap + bar, cy + size * 0.38f), bar * 0.15f, bar * 0.15f, paint)
        } else {
            val path = Path()
            path.moveTo(cx - size * 0.26f, cy - size * 0.4f)
            path.lineTo(cx + size * 0.42f, cy)
            path.lineTo(cx - size * 0.26f, cy + size * 0.4f)
            path.close()
            canvas.drawPath(path, paint)
        }
    }
    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        info.className = "android.widget.Button"
        info.isClickable = true
        info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_CLICK)
    }
    override fun performClick(): Boolean {
        super.performClick()
        val started = SystemClock.uptimeMillis()
        refresh()
        val player = observed
        if (player == null) { onFallback(emptyMap()); return true }
        if (player.playWhenReady && player.playbackState != Player.STATE_ENDED) player.pause() else resumePlayback(player)
        updateState()
        performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        if (BuildConfig.DEBUG) Log.d("NativeTransport", "toggle applied in ${SystemClock.uptimeMillis() - started}ms")
        return true
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                tracking = true; downX = event.x; downY = event.y
                if (!reduceMotion) animate().scaleX(0.94f).scaleY(0.94f).setDuration(pressDuration).start()
                return true
            }
            MotionEvent.ACTION_MOVE -> if (abs(event.x - downX) > slop || abs(event.y - downY) > slop) tracking = false
            MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_CANCEL -> { tracking = false; animate().scaleX(1f).scaleY(1f).setDuration(pressDuration).start() }
            MotionEvent.ACTION_UP -> {
                val tap = tracking && event.eventTime - event.downTime < ViewConfiguration.getLongPressTimeout() && event.x >= 0 && event.y >= 0 && event.x <= width && event.y <= height
                tracking = false
                animate().scaleX(1f).scaleY(1f).setDuration(pressDuration).start()
                if (tap) performClick()
            }
        }
        return true
    }
}
