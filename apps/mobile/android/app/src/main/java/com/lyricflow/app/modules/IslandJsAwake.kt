package com.lyricflow.app.modules

import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.common.LifecycleState
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/**
 * Keeps JavaScript's timers running for a few seconds while the island is used from another app.
 *
 * React Native holds JS timers while no activity of ours is resumed, unless a headless task runs
 * (`JavaTimerManager.onHostPause`). The island lives over other apps, so a search or a pick handed to JavaScript
 * waited on a timer (a request's timeout, a race with a delay) until the app was opened again — an online search
 * from the island never answered. Each search and pick starts a short task (`islandJsAwake.ts` only waits); one
 * already covering most of the time is reused.
 */
object IslandJsAwake {
    /** Same key as `ISLAND_JS_AWAKE_TASK` in JavaScript. */
    const val TASK = "IslandJsAwake"
    /** Long enough for a search's slowest provider or a pick's queue to land; renewed by every new one. */
    const val HOLD_MS = 20_000L
    /** Android ends the task this long after JavaScript should have, in case JavaScript never says it is done. */
    private const val GRACE_MS = 5_000L
    private const val TAG = "LyrFlowIsland"

    private var until = 0L

    /** Keeps timers running for [ms] from now. Call from any thread; a no-op while the app is in front. */
    fun hold(context: ReactContext?, ms: Long = HOLD_MS) {
        val ctx = context ?: return
        UiThreadUtil.runOnUiThread {
            // In front, timers run anyway (and a task there would need allowing).
            if (ctx.lifecycleState == LifecycleState.RESUMED || !ctx.hasActiveReactInstance()) return@runOnUiThread
            val now = SystemClock.uptimeMillis()
            if (now + ms / 2 < until) return@runOnUiThread
            try {
                val data = Arguments.createMap().apply { putDouble("ms", ms.toDouble()) }
                HeadlessJsTaskContext.getInstance(ctx).startTask(HeadlessJsTaskConfig(TASK, data, ms + GRACE_MS, true))
                until = now + ms
            } catch (e: Exception) {
                // The context went away under us: the island still works, only a slow answer may wait for the app.
                Log.w(TAG, "could not keep JavaScript awake", e)
            }
        }
    }
}
