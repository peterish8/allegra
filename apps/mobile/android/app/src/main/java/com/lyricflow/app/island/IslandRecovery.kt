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

    // ── 1.44.0: a window Android accepted can still be wrong after a restart ──────────────────────────────────
    //
    // Reported again on 1.41.2+ (owner's sister's phone): after a restart the island stayed gone until switched off and
    // on in the app. That switch throws the window away and builds a new one, and that is what fixes it: a window built
    // while the phone is still starting up can be accepted by Android yet hold a screen size, rotation or lock read
    // before the display and keyguard settled, and nothing later re-reads all of it. After a restart the PIN is also
    // entered before Android starts the service, so the unlock that 1.41.2 listens for has already happened.
    //
    // So the service now does what the switch does, by itself:
    //  - a service started soon after boot builds its window again at [BOOT_REBUILD_MS] after it connects;
    //  - the first unlock or screen-on after it connects builds the window again too (once);
    //  - any screen-on or unlock finding a window Android dropped (not attached, never measured) builds it again;
    //  - every recheck measures the screen again, not only the lock.
    // Never while the island is open in the listener's hand: that rebuild waits for the next event.

    /** A service that connected within this long of boot is a restart's: its window is rebuilt once things settle. */
    const val BOOT_WINDOW_MS: Long = 5 * 60_000L

    /** After a boot-time connect, when (ms after connecting) the window is built again. */
    val BOOT_REBUILD_MS: LongArray = longArrayOf(8_000L, 30_000L)

    /** Whether a service that connected [msSinceBootAtConnect] after boot is a restart's. */
    fun connectedAtBoot(msSinceBootAtConnect: Long): Boolean = msSinceBootAtConnect in 0 until BOOT_WINDOW_MS

    enum class Action { NOTHING, BUILD, REBUILD, RECHECK }

    /** What the screen coming on, or the phone being unlocked, should do to the island. */
    fun onScreenEvent(
        wanted: Boolean,
        windowAdded: Boolean,
        windowHealthy: Boolean,
        inUse: Boolean,
        firstSinceConnect: Boolean,
    ): Action = when {
        !wanted -> Action.NOTHING
        !windowAdded -> Action.BUILD
        inUse -> Action.RECHECK
        !windowHealthy -> Action.REBUILD
        firstSinceConnect -> Action.REBUILD
        else -> Action.RECHECK
    }

    /**
     * Whether this action used up "the first screen event since connecting". A rebuild or build does; a recheck does
     * not, so a first unlock deferred because the island was open still rebuilds on the next one.
     */
    fun consumesFirstEvent(action: Action): Boolean = action == Action.REBUILD || action == Action.BUILD

    /** What a boot-time rebuild timer should do: rebuild a wanted island unless it is open in the listener's hand. */
    fun onBootRebuild(wanted: Boolean, windowAdded: Boolean, inUse: Boolean): Action = when {
        !wanted -> Action.NOTHING
        !windowAdded -> Action.BUILD
        inUse -> Action.RECHECK
        else -> Action.REBUILD
    }
}
