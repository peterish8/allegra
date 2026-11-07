package com.lyricflow.app.island

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import androidx.core.content.ContextCompat

/**
 * Keeps LuvLyrics' island on screen over every app. Android only lets an accessibility service put a window
 * above the status bar, so that is what this is; it reads no screen content and asks for no events
 * (res/xml/island_accessibility.xml). The listener turns it on in Settings → Accessibility → LuvLyrics island.
 *
 * It runs in the app's process, where `PlaybackService` hands it the player (IslandPlayback). When the phone's
 * own system already has an island (NativeIsland) or the listener switched ours off (IslandPrefs), the service
 * stays connected and shows nothing.
 */
class IslandService : AccessibilityService() {
    private var window: IslandWindow? = null
    private val retryHandler = Handler(Looper.getMainLooper())

    // ── Coming back after a restart (IslandRecovery) ──────────────────────────────────────────────────────
    private var retryAttempt = 0
    private val retry = Runnable { refreshNow() }
    private var screenWatched = false

    /**
     * Heard by the service itself, not only by a window that exists: after a reboot the window may have been refused
     * (or never built) before anything listened, and the next unlock or screen-on brings it back.
     */
    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val w = window
            if (w != null && w.isAdded) {
                w.recheck()
            } else {
                retryAttempt = 0
                refreshNow()
            }
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        watchScreen()
        retryAttempt = 0
        refreshNow()
    }

    private fun watchScreen() {
        if (screenWatched) return
        try {
            ContextCompat.registerReceiver(
                this,
                screenReceiver,
                IntentFilter().apply {
                    addAction(Intent.ACTION_USER_PRESENT)
                    addAction(Intent.ACTION_SCREEN_ON)
                    addAction(Intent.ACTION_USER_UNLOCKED)
                },
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            screenWatched = true
        } catch (e: Exception) {
            Log.w("LyrFlowIsland", "island could not watch the screen", e)
        }
    }

    private fun unwatchScreen() {
        if (!screenWatched) return
        screenWatched = false
        try { unregisterReceiver(screenReceiver) } catch (_: IllegalArgumentException) { /* Never registered. */ }
    }

    /** The island is wanted but not on screen: try again a little later, backing off (IslandRecovery). */
    private fun scheduleRetry() {
        retryHandler.removeCallbacks(retry)
        val delay = IslandRecovery.retryDelayMs(retryAttempt) ?: return
        retryAttempt++
        retryHandler.postDelayed(retry, delay)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        window?.onConfigurationChanged()
    }

    override fun onUnbind(intent: Intent?): Boolean {
        tearDown()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        tearDown()
        super.onDestroy()
    }

    private fun tearDown() {
        if (instance === this) instance = null
        retryHandler.removeCallbacks(retry)
        unwatchScreen()
        window?.destroy()
        window = null
    }

    private fun refreshNow() {
        retryHandler.removeCallbacks(retry)
        var wanted = false
        try {
            val prefs = IslandPrefs(this)
            val nativeIsland = NativeIsland.onThisPhone()
            wanted = prefs.enabled && (nativeIsland == null || prefs.allowOnNativeIslandPhones)
            if (wanted) {
                val w = window ?: IslandWindow(this).also { window = it }
                w.show(prefs)
                w.setAppInFront(appInFront)
            } else {
                window?.destroy()
                window = null
            }
        } catch (e: Exception) {
            // A crash here would make Android switch the service off; log it and try again shortly instead.
            Log.w("LyrFlowIsland", "island refresh failed", e)
            try { window?.destroy() } catch (_: Exception) { /* Half-built: drop it. */ }
            window = null
        }
        if (IslandRecovery.needsRetry(wanted, window?.isAdded == true)) {
            // Refused (often right after a reboot, before the overlay is accepted): build it afresh next time.
            if (window?.isAdded == false) {
                try { window?.destroy() } catch (_: Exception) { /* Nothing on screen. */ }
                window = null
            }
            scheduleRetry()
        } else {
            retryAttempt = 0
        }
    }

    companion object {
        @Volatile
        private var instance: IslandService? = null
        private val main = Handler(Looper.getMainLooper())

        /** The service is connected (the listener turned it on and Android bound it). */
        val isRunning get() = instance != null

        /** The island is on screen right now. */
        val isShowing get() = instance?.window?.isShowing == true

        /** LuvLyrics' own screen is in front (MainActivity resumed): the island may step aside (IslandPrefs.hideInApp). */
        @Volatile
        var appInFront = false
            private set

        fun setAppInFront(inFront: Boolean) {
            appInFront = inFront
            main.post { instance?.window?.setAppInFront(inFront) }
        }

        /** LuvLyrics has drawn the screen the island opened: the overlay growing it out of the island lets go. */
        fun appShown() {
            main.post { instance?.window?.appShown() }
        }

        /** Applies the switches in [IslandPrefs] (from the app's Settings). */
        fun refresh() {
            main.post { instance?.refreshNow() }
        }

        fun component(context: Context) = ComponentName(context, IslandService::class.java)

        /** Whether the listener turned the service on in Android's accessibility settings. */
        fun isEnabledInSettings(context: Context): Boolean {
            val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
                ?: return false
            val ours = component(context)
            return enabled.split(':').any { ComponentName.unflattenFromString(it) == ours }
        }
    }
}
