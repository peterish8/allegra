package com.lyricflow.app.island

import androidx.annotation.MainThread
import androidx.media3.common.Player

/**
 * Hands the island the media session's player. `PlaybackService` attaches it in `onCreate` and detaches it in
 * `onDestroy`; the island (same process) listens to it and drives it directly, like the notification does:
 * skips go to the queue engine through `QueueForwardingPlayer`, so they work with JavaScript asleep.
 *
 * The island does not bind a MediaController on purpose: binding would create the service when nothing plays
 * and keep it alive after the app is swiped away (PlaybackService.onTaskRemoved ends it).
 */
object IslandPlayback {
    private var player: Player? = null
    private val watchers = LinkedHashSet<(Player?) -> Unit>()

    @MainThread
    fun attach(sessionPlayer: Player) {
        player = sessionPlayer
        watchers.toList().forEach { it(sessionPlayer) }
    }

    @MainThread
    fun detach(sessionPlayer: Player) {
        if (player !== sessionPlayer) return
        player = null
        watchers.toList().forEach { it(null) }
    }

    /** Calls [onChange] now and whenever the player comes or goes; the returned function stops watching. */
    @MainThread
    fun watch(onChange: (Player?) -> Unit): () -> Unit {
        watchers += onChange
        onChange(player)
        return { watchers -= onChange }
    }
}
