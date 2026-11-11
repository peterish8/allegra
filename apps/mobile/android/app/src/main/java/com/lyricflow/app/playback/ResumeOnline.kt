package com.lyricflow.app.playback

/**
 * Music that stopped because the connection dropped starts again when it comes back (1.41.2).
 *
 * The service retries a network error four times (1, 2, 4, 8 s) and then pauses, so the transport tells the truth.
 * A lift, a tunnel or a train between stations outlasts that, and the music used to stay stopped until the listener
 * pressed play: JavaScript's own retry needs the app awake and a working connection. Now the service remembers that
 * a lost connection paused it and, when Android reports a network again within [WINDOW_MS], plays on from the same
 * spot — unless the listener pressed play or pause since, or the song changed.
 */
object ResumeOnline {
    /** How long after the give-up a returning connection still resumes the music on its own. */
    const val WINDOW_MS = 10 * 60_000L

    /**
     * Whether a connection that came back at [now] should resume playback armed at [armedAt] (null when not armed).
     * [wantsToPlay] is the player's playWhenReady: true means the listener (or something else) already resumed it.
     *
     * 2026-11-11: it is a real episode, not any network callback. Android reports the network that is already up
     * the moment the watch starts, so a stream that failed while the phone stayed online used to "come back" at
     * once. [sawLoss] says the connection was really gone during the episode (no network when the watch started,
     * or a loss reported since); [usable] says the network now reported can reach the internet (validated).
     */
    fun shouldResume(
        armedAt: Long?,
        now: Long,
        wantsToPlay: Boolean,
        hasSong: Boolean,
        sawLoss: Boolean,
        usable: Boolean,
    ): Boolean =
        armedAt != null && now >= armedAt && now - armedAt <= WINDOW_MS && !wantsToPlay && hasSong && sawLoss && usable

    /** Whether an armed resume is past its window and should be dropped. */
    fun expired(armedAt: Long?, now: Long): Boolean = armedAt != null && now - armedAt > WINDOW_MS
}
