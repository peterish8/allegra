package com.lyricflow.app

import android.os.SystemClock
import android.util.Log

/**
 * Timing marks for the low-end performance runs (docs/perf-low-end.md): the lift of a finger and the moment audio
 * starts, both on the uptime clock MotionEvent uses, so a script subtracts them for tap-to-audible. Silent unless
 * switched on with `adb shell setprop log.tag.LLPerf DEBUG`; a listener's build logs nothing.
 */
object PerfMarks {
    private const val TAG = "LLPerf"

    private fun enabled(): Boolean = Log.isLoggable(TAG, Log.DEBUG)

    fun tapUp(eventTimeMs: Long) {
        if (enabled()) Log.d(TAG, "tapUp $eventTimeMs")
    }

    fun playing() {
        if (enabled()) Log.d(TAG, "playing ${SystemClock.uptimeMillis()}")
    }
}
