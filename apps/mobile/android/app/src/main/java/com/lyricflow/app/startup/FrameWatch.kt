package com.lyricflow.app.startup

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.FrameMetrics
import android.view.Window

/**
 * Notices a phone that cannot keep up with the full visuals, so the next start takes the light path
 * (src/utils/performanceTier.ts reads [isSlow] through `Startup.deviceProfile`).
 *
 * Frame times come from the platform's own FrameMetrics, read on a background thread. Every 10 s of drawing is
 * judged on its own: a window counts against the phone when it drew enough frames to mean something moved and more
 * than one frame in ten took over 18 ms (a 90th percentile above 18 ms). Two bad windows in a row mark the phone
 * slow, once and for good; the listener can still pick Settings → Reduce effects → Off.
 */
object FrameWatch {
    private const val PREFS = "performance"
    private const val KEY_SLOW = "slowFrames"
    private const val WINDOW_MS = 10_000L
    private const val SETTLE_MS = 10_000L
    private const val MIN_FRAMES = 120
    private const val SLOW_NS = 18_000_000L
    private const val BAD_WINDOWS = 2

    private val thread by lazy { HandlerThread("FrameWatch").apply { start() } }
    private var listener: Window.OnFrameMetricsAvailableListener? = null
    private var window: Window? = null

    fun isSlow(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_SLOW, false)

    /** The pure judgement of one window, for tests. */
    fun badWindow(frames: Int, slowFrames: Int): Boolean = frames >= MIN_FRAMES && slowFrames * 10 > frames

    fun start(activity: Activity) {
        if (listener != null || isSlow(activity)) return
        val prefs = activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val startedAt = SystemClock.uptimeMillis()
        var windowStart = startedAt + SETTLE_MS
        var frames = 0
        var slow = 0
        var badInARow = 0
        val watch = Window.OnFrameMetricsAvailableListener { _, metrics, _ ->
            val now = SystemClock.uptimeMillis()
            if (now < windowStart) return@OnFrameMetricsAvailableListener
            if (now - windowStart >= WINDOW_MS) {
                badInARow = if (badWindow(frames, slow)) badInARow + 1 else 0
                if (badInARow >= BAD_WINDOWS) {
                    prefs.edit().putBoolean(KEY_SLOW, true).apply()
                    Handler(activity.mainLooper).post { stop() }
                }
                windowStart = now
                frames = 0
                slow = 0
            }
            frames += 1
            if (metrics.getMetric(FrameMetrics.TOTAL_DURATION) > SLOW_NS) slow += 1
        }
        listener = watch
        window = activity.window
        activity.window.addOnFrameMetricsAvailableListener(watch, Handler(thread.looper))
    }

    fun stop() {
        val watch = listener ?: return
        try {
            window?.removeOnFrameMetricsAvailableListener(watch)
        } catch (_: IllegalArgumentException) {
            // Already removed with its window.
        }
        listener = null
        window = null
    }
}
