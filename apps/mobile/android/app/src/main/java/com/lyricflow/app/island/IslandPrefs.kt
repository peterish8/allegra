package com.lyricflow.app.island

import android.content.Context

/**
 * The island's own switches, kept natively so the accessibility service can read them with the app closed.
 * The app's Settings → Dynamic island writes them through `DynamicIslandModule`.
 */
class IslandPrefs(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("dynamic_island", Context.MODE_PRIVATE)

    /** The listener can switch the island off here without going back to Android's accessibility page. */
    var enabled: Boolean
        get() = prefs.getBoolean(KEY_ENABLED, true)
        set(value) = prefs.edit().putBoolean(KEY_ENABLED, value).apply()

    /** The small black pill stays round the camera with nothing loaded; off, it shows only while there is a song. */
    var showWhenIdle: Boolean
        get() = prefs.getBoolean(KEY_IDLE, true)
        set(value) = prefs.edit().putBoolean(KEY_IDLE, value).apply()

    /** The open card shows the sung line and the next one under its controls (full lyrics are a pull away either way). */
    var showLyricStrip: Boolean
        get() = prefs.getBoolean(KEY_LYRIC_STRIP, true)
        set(value) = prefs.edit().putBoolean(KEY_LYRIC_STRIP, value).apply()

    /** The island steps aside while LuvLyrics itself is on screen (it has its own player there). */
    var hideInApp: Boolean
        get() = prefs.getBoolean(KEY_HIDE_IN_APP, true)
        set(value) = prefs.edit().putBoolean(KEY_HIDE_IN_APP, value).apply()

    /** On a phone whose system already has an island (HyperOS 3, ColorOS 15, …) ours stays off unless this is on. */
    var allowOnNativeIslandPhones: Boolean
        get() = prefs.getBoolean(KEY_ALLOW_NATIVE, false)
        set(value) = prefs.edit().putBoolean(KEY_ALLOW_NATIVE, value).apply()

    private companion object {
        const val KEY_ENABLED = "enabled"
        const val KEY_IDLE = "show_when_idle"
        const val KEY_ALLOW_NATIVE = "allow_on_native_island"
        const val KEY_HIDE_IN_APP = "hide_in_app"
        const val KEY_LYRIC_STRIP = "lyric_strip"
    }
}
