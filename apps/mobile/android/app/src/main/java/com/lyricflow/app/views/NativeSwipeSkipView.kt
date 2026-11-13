package com.lyricflow.app.views

import android.content.Context
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.animation.AccelerateInterpolator
import android.view.animation.DecelerateInterpolator
import com.facebook.react.uimanager.events.NativeGestureUtil
import com.lyricflow.app.modules.PlayerBridge
import com.lyricflow.app.playback.MiniSwipe
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * The mini player's sideways swipe, owned by Android's main thread like the island's (owner, 2026-11-13: playback
 * controls in Kotlin, not JavaScript). It wraps the cover and title: a horizontal drag moves them under the finger,
 * lifting decides with [MiniSwipe] (the same rule as miniSwipe.ts) and skips straight through the queue engine, so
 * the next song starts even while JavaScript is busy. JavaScript hears [onSkip] afterwards and moves its mirror.
 *
 * Taps and long presses reach the React Native children untouched; only a drag that has become clearly sideways
 * is taken (children are cancelled, React Native's and Gesture Handler's JavaScript sides are told). A vertical
 * drag is left alone, so swiping up still opens the player.
 *
 * Times mirror the Motion tokens (instant 100, fast 160) and the JavaScript pill's swipe (outgoing slide 32,
 * incoming 16, dim to 0.2) so the two feel the same. [songKey] changes when the new song's text has been drawn;
 * that is when the content slides back in.
 */
class NativeSwipeSkipView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    var enabled = false
    var rtl = false
    var reduceMotion = false
    var songKey: String? = null
        set(value) {
            val changed = field != null && field != value
            field = value
            if (changed && pendingDir != 0) settle(incoming = true)
        }

    private val onSkip by EventDispatcher<Map<String, Any>>()
    private val density = resources.displayMetrics.density
    private var downX = 0f
    private var downY = 0f
    private var armed = false
    private var dragging = false
    private var tracker: VelocityTracker? = null
    /** The finger's direction (-1 left, 1 right) of a skip waiting for the new song to draw; 0 when none. */
    private var pendingDir = 0
    private val fallback = Runnable { settle(incoming = false) }

    // React Native places the children itself (and the slop padding its parent asks for); like ReactViewGroup,
    // leave the placement alone instead of letting ExpoView's LinearLayout lay them out again from the origin.
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        if (!enabled) return false
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                armed = true
                dragging = false
                downX = ev.rawX
                downY = ev.rawY
                tracker?.recycle()
                tracker = VelocityTracker.obtain().also { it.addMovement(ev) }
                // A new touch while the last skip is still settling takes over from wherever the content is.
                removeCallbacks(fallback)
                animate().cancel()
            }
            MotionEvent.ACTION_MOVE -> {
                if (!armed) return false
                tracker?.addMovement(ev)
                val dx = (ev.rawX - downX) / density
                val dy = (ev.rawY - downY) / density
                if (MiniSwipe.isDrag(dx, dy)) {
                    dragging = true
                    NativeGestureUtil.notifyNativeGestureStarted(this, ev)
                    parent?.requestDisallowInterceptTouchEvent(true)
                    follow(dx)
                    return true
                }
            }
            MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_UP -> reset()
        }
        return false
    }

    override fun onTouchEvent(ev: MotionEvent): Boolean {
        if (!dragging) return false
        tracker?.addMovement(ev)
        val dx = (ev.rawX - downX) / density
        val dy = (ev.rawY - downY) / density
        when (ev.actionMasked) {
            MotionEvent.ACTION_MOVE -> follow(dx)
            MotionEvent.ACTION_UP -> {
                tracker?.computeCurrentVelocity(1000)
                val vx = (tracker?.xVelocity ?: 0f) / density
                NativeGestureUtil.notifyNativeGestureEnded(this, ev)
                finish(dx, dy, vx)
            }
            MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN -> {
                NativeGestureUtil.notifyNativeGestureEnded(this, ev)
                reset()
                returnHome()
            }
        }
        return true
    }

    private fun follow(dx: Float) {
        if (!reduceMotion) translationX = MiniSwipe.follow(dx) * density
        alpha = MiniSwipe.fade(dx)
    }

    private fun finish(dx: Float, dy: Float, vx: Float) {
        reset()
        val widthDp = width / density
        val which = MiniSwipe.decide(dx, dy, vx, widthDp, rtl)
        if (which == MiniSwipe.NONE) {
            returnHome()
            return
        }
        val engine = PlayerBridge.getEngine()
        if (engine == null) {
            returnHome()
            return
        }
        val player = PlayerBridge.getPlayer()
        val before = player?.currentMediaItemIndex
        if (which == MiniSwipe.NEXT) engine.skipToNext() else engine.skipToPrevious()
        // Back past 3 s starts the song over: the screen must not move then.
        val moved = player == null || player.currentMediaItemIndex != before
        onSkip(mapOf("direction" to which, "moved" to moved))
        // The outgoing slide, then wait for the new song's text; a restart (nothing to wait for) settles on a timer.
        pendingDir = if (dx < 0) -1 else 1
        animate().cancel()
        animate()
            .translationX(if (reduceMotion) 0f else pendingDir * OUT_DP * density)
            .alpha(DIMMED)
            .setDuration(INSTANT_MS)
            .setInterpolator(AccelerateInterpolator())
            .start()
        postDelayed(fallback, if (moved) SETTLE_MS else RESTART_MS)
    }

    /** The new song's text is drawn (or the wait ran out): slide the content back in from the other side. */
    private fun settle(incoming: Boolean) {
        removeCallbacks(fallback)
        val dir = pendingDir
        pendingDir = 0
        animate().cancel()
        if (incoming && !reduceMotion && dir != 0) {
            translationX = -dir * IN_DP * density
            alpha = DIMMED
        }
        animate().translationX(0f).alpha(1f).setDuration(FAST_MS).setInterpolator(DecelerateInterpolator()).start()
    }

    private fun returnHome() {
        pendingDir = 0
        animate().cancel()
        animate().translationX(0f).alpha(1f).setDuration(FAST_MS).setInterpolator(DecelerateInterpolator()).start()
    }

    private fun reset() {
        armed = false
        dragging = false
        tracker?.recycle()
        tracker = null
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(fallback)
        animate().cancel()
        translationX = 0f
        alpha = 1f
        reset()
        super.onDetachedFromWindow()
    }

    private companion object {
        /** Motion.duration.instant and .fast (src/constants/allegraTheme.ts). */
        const val INSTANT_MS = 100L
        const val FAST_MS = 160L
        /** The JavaScript pill's slide: 32 dp out, 16 dp in, dimmed to 0.2 between. */
        const val OUT_DP = 32f
        const val IN_DP = 16f
        const val DIMMED = 0.2f
        /** How long a skip waits for the new song's text before the content comes back anyway. */
        const val SETTLE_MS = 1200L
        const val RESTART_MS = 220L
    }
}
