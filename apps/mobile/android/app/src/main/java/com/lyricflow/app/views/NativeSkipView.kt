package com.lyricflow.app.views

import android.content.Context
import android.view.MotionEvent
import android.view.ViewConfiguration
import com.lyricflow.app.modules.PlayerBridge
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs

/**
 * A skip button that skips on the main thread, the way the island and the notification do: a tap goes straight to
 * the queue engine, so the next song starts even while JavaScript is busy drawing. The button's look and its press
 * animation stay React Native's (the children); JavaScript hears [onSkip] afterwards and moves the screen.
 *
 * [direction] 1 skips forward, -1 back, 0 leaves the tap to JavaScript (Listen together and remote playback route
 * skips elsewhere). React Native still sees the same touch, so the JavaScript press handler must not skip as well
 * while this is on.
 */
class NativeSkipView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    var direction = 0

    private val onSkip by EventDispatcher<Map<String, Any>>()
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private var downX = 0f
    private var downY = 0f
    private var tracking = false

    // React Native places the button (its children) itself, with the slop padding the wrapper asks for. ExpoView is a
    // LinearLayout, which would lay the child out again from its own origin and ignore that padding, leaving the icon
    // off-centre in its slot (a few dp left on the mini player). Like ReactViewGroup, leave the placement alone.
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        val handled = super.dispatchTouchEvent(ev)
        if (direction == 0) return handled
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                tracking = true
                downX = ev.x
                downY = ev.y
            }
            MotionEvent.ACTION_MOVE ->
                if (abs(ev.x - downX) > slop || abs(ev.y - downY) > slop) tracking = false
            MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_CANCEL -> tracking = false
            MotionEvent.ACTION_UP -> {
                val tap = tracking && ev.eventTime - ev.downTime < ViewConfiguration.getLongPressTimeout() &&
                    ev.x >= 0 && ev.y >= 0 && ev.x <= width && ev.y <= height
                tracking = false
                if (tap) skip()
            }
        }
        return true
    }

    private fun skip() {
        val engine = PlayerBridge.getEngine() ?: return
        val player = PlayerBridge.getPlayer()
        val dir = direction
        val before = player?.currentMediaItemIndex
        if (dir > 0) engine.skipToNext() else engine.skipToPrevious()
        // Back past 3 s starts the song over: the screen must not move then.
        val moved = player == null || player.currentMediaItemIndex != before
        onSkip(mapOf("direction" to dir, "moved" to moved))
    }
}
