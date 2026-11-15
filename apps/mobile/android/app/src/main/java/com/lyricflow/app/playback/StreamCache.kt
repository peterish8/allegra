package com.lyricflow.app.playback

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.SimpleCache
import java.io.File

/**
 * The one on-disk cache of streamed songs (1.69.0). A SimpleCache locks its folder, so the app opens exactly one, for
 * the life of the process: it is never released when PlaybackService is destroyed, because the service can be
 * recreated in the same process and a second instance on the folder would throw. Process death releases the lock.
 *
 * It lives in `cacheDir` (no backup; the OS may trim it, which SimpleCache tolerates). The ceiling is the listener's
 * Settings → Playback → Song cache, kept natively because the service starts before JavaScript.
 */
@OptIn(UnstableApi::class)
object StreamCache {
    const val DIR_NAME = "stream-cache"
    const val PREFS = "stream_cache"
    const val KEY_LIMIT_MB = "limit_mb"
    const val DEFAULT_LIMIT_MB = 512
    val ALLOWED_LIMITS_MB = intArrayOf(128, 256, 512, 1024, 2048)

    @Volatile private var cache: SimpleCache? = null
    @Volatile private var evictor: ReplayFriendlyLruEvictor? = null

    @Synchronized
    fun get(context: Context): SimpleCache {
        cache?.let { return it }
        val app = context.applicationContext
        val lru = ReplayFriendlyLruEvictor(limitMb(app) * MB)
        val opened = SimpleCache(File(app.cacheDir, DIR_NAME), lru, StandaloneDatabaseProvider(app))
        evictor = lru
        cache = opened
        return opened
    }

    /** The saved ceiling if it is one of the choices, else the default. */
    fun limitMb(context: Context): Int {
        val saved = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_LIMIT_MB, DEFAULT_LIMIT_MB)
        return if (saved in ALLOWED_LIMITS_MB) saved else DEFAULT_LIMIT_MB
    }

    /** The nearest choice at or below [mb] (never under the smallest). */
    fun clampLimit(mb: Int): Int = ALLOWED_LIMITS_MB.lastOrNull { it <= mb } ?: ALLOWED_LIMITS_MB.first()

    /** Saves the ceiling, applies it and trims at once. Off the main thread (disk). Returns the value applied. */
    fun setLimitMb(context: Context, mb: Int): Int {
        val applied = clampLimit(mb)
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_LIMIT_MB, applied).apply()
        val lru = evictor
        val open = cache
        if (lru != null && open != null) {
            lru.maxBytes = applied * MB
            lru.trim(open)
        }
        return applied
    }

    fun usedBytes(): Long = cache?.cacheSpace ?: 0L

    /** Removes every cached song but [keepKey] (the one playing). Off the main thread. */
    fun clear(keepKey: String?) {
        val open = cache ?: return
        for (key in open.keys.toList()) {
            if (key != keepKey) {
                try { open.removeResource(key) } catch (_: Exception) { /* a span in use stays until it is free */ }
            }
        }
    }

    private const val MB = 1024L * 1024
}
