package com.lyricflow.app.playback

import kotlin.random.Random

/**
 * The queue rules of Echo Music's player (MusicService.kt, PlayerConnection.kt), with no Android types in
 * them so they run as plain JVM tests. [QueueEngine] applies the answers to the ExoPlayer playlist.
 */
object QueueMath {
    /** Echo (PlayerConnection.seekToPrevious): past this much of a song, "previous" restarts it instead. */
    const val PREVIOUS_RESTART_MS = 3_000L

    /** Echo (MusicService.onMediaItemTransition): load more when the playing song plus those after it are this many or fewer. */
    const val LOAD_MORE_AT = 5

    enum class PreviousAction { RESTART, GO_BACK }

    /** Past 3 s, or with nothing before it, the song starts over; otherwise the player goes back one. */
    fun previousAction(positionMs: Long, hasPrevious: Boolean): PreviousAction =
        if (positionMs > PREVIOUS_RESTART_MS || !hasPrevious) PreviousAction.RESTART else PreviousAction.GO_BACK

    /** True once the playing song and those queued after it are [LOAD_MORE_AT] or fewer. [after] counts only the songs after it. */
    fun runningLow(after: Int): Boolean = after + 1 <= LOAD_MORE_AT

    enum class RepeatKind(val wire: String) {
        OFF("off"),
        ALL("all"),
        ONE("one");

        companion object {
            fun fromWire(value: String?): RepeatKind = values().firstOrNull { it.wire == value } ?: ALL
        }
    }

    enum class EndAction { NONE, RESTART_AND_PLAY, RESET_AND_PAUSE }

    /**
     * What to do when the last song has finished (Echo: onPlaybackStateChanged). Repeat-all starts over and keeps
     * playing; otherwise the queue goes back to its first song and waits, like Spotify.
     */
    fun endAction(repeat: RepeatKind, itemCount: Int): EndAction = when {
        itemCount <= 0 -> EndAction.NONE
        repeat == RepeatKind.ALL -> EndAction.RESTART_AND_PLAY
        else -> EndAction.RESET_AND_PAUSE
    }

    /**
     * A play order for [count] songs with [current] first and the rest shuffled (Echo: applyShuffleOrder).
     * The result lists playlist indices in the order they will play.
     */
    fun shuffledOrder(count: Int, current: Int, random: Random = Random.Default): IntArray {
        if (count <= 0) return IntArray(0)
        val rest = (0 until count).filter { it != current }.toMutableList()
        rest.shuffle(random)
        val order = IntArray(count)
        var at = 0
        if (current in 0 until count) order[at++] = current
        for (i in rest) order[at++] = i
        return order
    }

    /**
     * Songs just inserted to play next, with shuffle on (Echo: playNext): the playing song, then the new songs in
     * the order given, then everything else in the order it already had. [order] is the full play order after the
     * insert, as playlist indices.
     */
    fun orderWithNextBlock(order: List<Int>, current: Int, inserted: List<Int>): IntArray {
        val block = inserted.toSet()
        val result = ArrayList<Int>(order.size)
        result.add(current)
        for (i in inserted) if (i != current) result.add(i)
        for (i in order) if (i != current && i !in block) result.add(i)
        return result.toIntArray()
    }

    /**
     * Songs just added to the end, with shuffle on: they join the end of the play order instead of being mixed
     * into what is already lined up (the queue on screen does not rearrange under the listener).
     */
    fun orderWithAppended(order: List<Int>, appended: List<Int>): IntArray {
        val added = appended.toSet()
        val result = ArrayList<Int>(order.size)
        for (i in order) if (i !in added) result.add(i)
        for (i in appended) result.add(i)
        return result.toIntArray()
    }

    /** Playlist indices holding any of [incoming], highest first, so removing them one by one keeps the rest in place. [keep] is never listed. */
    fun duplicateIndices(existing: List<String>, incoming: Set<String>, keep: Int): List<Int> =
        existing.indices.filter { it != keep && existing[it] in incoming }.sortedDescending()

    /**
     * Where the playing song sits in a replacement queue, or -1 when the replacement leaves it out. The first
     * match wins when a song is in the list twice.
     */
    fun locateCurrent(ids: List<String>, currentId: String?): Int = if (currentId == null) -1 else ids.indexOf(currentId)
}
