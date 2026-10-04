package com.lyricflow.app.recovery

import android.content.Context

/**
 * Counts starts that never reached a drawn screen. `MainActivity` notes every start; JavaScript calls
 * `Startup.markHealthy` once the app has drawn its first screen, which clears the count. After
 * [RESCUE_AFTER] starts in a row that never got there (a crash at start, React dying on every start, a boot that
 * hangs and is killed), the next start opens [RescueActivity] instead of React: About, the version and the way to
 * install the latest build, all native, so a broken build can always be replaced from the phone.
 */
object LaunchGuard {
    private const val PREFS = "launch-guard"
    private const val KEY_UNHEALTHY = "unhealthy-starts"
    const val RESCUE_AFTER = 3

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The application, set in `MainApplication.onCreate` (before any activity exists). */
    @Volatile
    private var app: Context? = null

    /** Whether the activity being created opens the rescue screen (decided once per activity, in its constructor). */
    @Volatile
    var rescueThisStart = false
        private set

    fun init(application: Context) {
        app = application
    }

    /** Called from `MainActivity`'s constructor, where it has no context of its own yet. */
    fun decideStart() {
        rescueThisStart = try {
            app?.let { shouldRescue(it) } ?: false
        } catch (e: Exception) {
            false
        }
    }

    /** True when the last [RESCUE_AFTER] starts never drew a screen. */
    fun shouldRescue(context: Context): Boolean = prefs(context).getInt(KEY_UNHEALTHY, 0) >= RESCUE_AFTER

    /** A start began; it counts against the app until [markHealthy]. Written at once: a crash may follow. */
    fun noteStart(context: Context) {
        val p = prefs(context)
        p.edit().putInt(KEY_UNHEALTHY, p.getInt(KEY_UNHEALTHY, 0) + 1).commit()
    }

    /** The app drew its first screen. */
    fun markHealthy(context: Context) {
        prefs(context).edit().putInt(KEY_UNHEALTHY, 0).apply()
    }

    /** "Open LuvLyrics again" from the rescue screen: give the app a fresh set of tries. */
    fun reset(context: Context) {
        rescueThisStart = false
        prefs(context).edit().putInt(KEY_UNHEALTHY, 0).commit()
    }
}
