package com.lyricflow.app.recovery

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.lyricflow.app.MainActivity
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactNativeHostHandler
import java.io.File

/**
 * When React Native's instance dies, the screen comes back instead of staying a dead grey window.
 *
 * A fatal JavaScript error, an error thrown by a UI-thread worklet, or a failure mounting views reaches
 * `ReactHostImpl.handleHostException`. With any host handler registered (Sentry's Expo package is one) Expo hands
 * the error to the handlers instead of crashing, and React Native destroys the instance: the window is left
 * empty and deaf to touches while `PlaybackService`, in the same process, plays on. That was the grey screen
 * after opening Now Playing or its lyrics.
 *
 * Here the error is written down (`ui-crash.txt`, read once by JavaScript at the next start through
 * `Startup.takeUiCrash`, which shows it so it can be reported) and the activity is started again, which starts a
 * fresh React instance. The music is not touched: the service keeps its queue and JavaScript reads it back.
 * A run of failures stops the restarts, so a screen that fails on every start cannot loop: the rescue screen
 * ([RescueActivity], native) opens instead, with the version and a way to install the latest build.
 */
object UiRecovery {
    private const val TAG = "UiRecovery"
    private const val FILE = "ui-crash.txt"
    /** Restarts allowed inside [WINDOW_MS]; past that the app stays where it is. */
    private const val MAX_RESTARTS = 3
    private const val WINDOW_MS = 120_000L
    /** Lets React Native finish tearing the old instance down before the activity is started again. */
    private const val RESTART_DELAY_MS = 800L

    private val main = Handler(Looper.getMainLooper())
    private val restarts = ArrayDeque<Long>()

    /** The rescue screen is up (or React was started only on the way to it): nothing may restart over it. */
    @Volatile
    var rescuing = false

    fun onReactLost(context: Context, error: Exception) {
        Log.e(TAG, "React instance lost; restarting the screen", error)
        record(context, error)
        if (rescuing) return
        val now = System.currentTimeMillis()
        val restart = synchronized(restarts) {
            while (restarts.isNotEmpty() && now - restarts.first() > WINDOW_MS) restarts.removeFirst()
            if (restarts.size >= MAX_RESTARTS) {
                false
            } else {
                restarts.addLast(now)
                true
            }
        }
        if (!restart) {
            Log.e(TAG, "React instance lost $MAX_RESTARTS times in ${WINDOW_MS / 1000}s; opening the rescue screen")
            rescuing = true
            main.postDelayed({
                try {
                    RescueActivity.open(context)
                } catch (e: Exception) {
                    Log.e(TAG, "could not open the rescue screen", e)
                }
            }, RESTART_DELAY_MS)
            return
        }
        main.postDelayed({
            try {
                val intent = Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                context.startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "could not restart the screen", e)
            }
        }, RESTART_DELAY_MS)
    }

    /** "Open LuvLyrics again" from the rescue screen: a fresh budget of restarts. */
    fun resetRestarts() {
        rescuing = false
        synchronized(restarts) { restarts.clear() }
    }

    /** The last lost instance's error, left in place (the rescue screen shows it). Null when there is none. */
    fun peek(context: Context): String? {
        val file = File(context.filesDir, FILE)
        if (!file.isFile) return null
        return try {
            file.readText().lines().drop(1).joinToString("\n").trim().ifEmpty { null }
        } catch (e: Exception) {
            null
        }
    }

    /** The last lost instance's error, once: the file is removed as it is read. Null when there is none. */
    fun take(context: Context): String? {
        val file = File(context.filesDir, FILE)
        if (!file.isFile) return null
        return try {
            file.readText().also { file.delete() }
        } catch (e: Exception) {
            null
        }
    }

    private fun record(context: Context, error: Exception) {
        try {
            val text = buildString {
                append(System.currentTimeMillis()).append('\n')
                var cause: Throwable? = error
                var depth = 0
                while (depth < 4) {
                    val current = cause ?: break
                    if (depth > 0) append("Caused by: ")
                    append(current.javaClass.name).append(": ").append(current.message.orEmpty().take(4_000)).append('\n')
                    for (frame in current.stackTrace.take(12)) append("  at ").append(frame).append('\n')
                    val next = current.cause
                    cause = if (next === current) null else next
                    depth++
                }
            }
            File(context.filesDir, FILE).writeText(text)
        } catch (e: Exception) {
            Log.w(TAG, "could not record the error: ${e.message}")
        }
    }
}

/** Registers [UiRecovery] with Expo's host (listed in `ExpoModulesPackageList.getPackageList`). */
class UiRecoveryPackage : Package {
    // Called while MainApplication is being constructed, before Android has attached its base context: the
    // context must only be kept here, never used (`applicationContext` on it threw and the app could not start).
    override fun createReactNativeHostHandlers(context: Context): List<ReactNativeHostHandler> =
        listOf(UiRecoveryHandler(context))
}

private class UiRecoveryHandler(private val context: Context) : ReactNativeHostHandler {
    override fun onReactInstanceException(useDeveloperSupport: Boolean, exception: Exception) {
        // A development build shows the red box instead.
        if (useDeveloperSupport) return
        try {
            UiRecovery.onReactLost(context.applicationContext ?: context, exception)
        } catch (e: Exception) {
            // Recovery must never be the thing that takes the app down.
            android.util.Log.e("UiRecovery", "recovery failed", e)
        }
    }
}
