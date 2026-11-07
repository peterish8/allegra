package com.lyricflow.app.island

/**
 * How the island gets itself back after the phone restarts (1.41.2).
 *
 * After a reboot Android re-binds the accessibility service on its own, often while the lock screen is still on its
 * way out. Two things used to leave the island gone until the listener switched it off and on in the app:
 *  - the window read "locked" as it was built and only then started listening for the unlock, so an unlock that
 *    landed in between was never heard and the island stayed hidden for the lock;
 *  - a window Android refused that early (the overlay not accepted yet) was never tried again.
 *
 * The window now reads the lock again on [LOCK_RECHECK_MS] after it is built, and the service retries a refused or
 * failed window on [retryDelayMs]; an unlock or the screen coming on also brings back a missing island.
 */
object IslandRecovery {
    /** After the window is built, when (ms) the lock is read again: the keyguard's exit animation can outlast the first. */
    val LOCK_RECHECK_MS: LongArray = longArrayOf(300L, 900L, 2_000L, 5_000L)

    private val RETRY_MS = longArrayOf(1_000L, 2_000L, 4_000L, 8_000L, 15_000L, 30_000L, 30_000L, 60_000L, 60_000L)

    /** Delay before the [attempt]-th retry (0-based) of a window that could not be shown, or null once it is time to stop. */
    fun retryDelayMs(attempt: Int): Long? = if (attempt in RETRY_MS.indices) RETRY_MS[attempt] else null

    /** Whether the service should try again: the island is wanted and its window is not on screen. */
    fun needsRetry(wanted: Boolean, windowAdded: Boolean): Boolean = wanted && !windowAdded
}
