package com.lyricflow.app.island

import android.os.Handler
import android.os.Looper

/**
 * The playing song's timed lyric lines, handed over by JavaScript once per song
 * (`DynamicIslandModule.setLyrics`). The island finds the sung line from the player's own position, so
 * the lines keep moving while JavaScript sleeps. Lines show only for the song they were sent for.
 */
object IslandLyrics {
    class Line(val atMs: Long, val text: String)

    /** One snapshot, swapped whole: a reader never sees one song's id with another song's lines. */
    private class Sheet(val songId: String, val lines: List<Line>)

    @Volatile private var sheet: Sheet? = null

    /** Told on the main thread whenever the lines change. The island's view sets it while attached. */
    @Volatile var onChange: (() -> Unit)? = null

    // Lazy, so the pure helpers below run in JVM unit tests without Android's main looper.
    private val main by lazy { Handler(Looper.getMainLooper()) }

    fun set(songId: String, atMs: List<Long>, texts: List<String>) {
        sheet = Sheet(songId, linesOf(atMs, texts))
        notifyChange()
    }

    fun clear() {
        sheet = null
        notifyChange()
    }

    fun linesFor(songId: String?): List<Line> {
        val current = sheet ?: return emptyList()
        return if (songId != null && songId == current.songId) current.lines else emptyList()
    }

    private fun notifyChange() {
        main.post { onChange?.invoke() }
    }

    /** Pairs times with texts, drops blank lines (an instrumental gap shows the next line instead), in time order. */
    fun linesOf(atMs: List<Long>, texts: List<String>): List<Line> =
        atMs.indices
            .mapNotNull { i -> texts.getOrNull(i)?.trim()?.takeIf { it.isNotEmpty() }?.let { Line(atMs[i], it) } }
            .sortedBy { it.atMs }

    /** The line being sung at [positionMs]: the last one that has started, or -1 before the first. */
    fun lineAt(lines: List<Line>, positionMs: Long): Int {
        var low = 0
        var high = lines.size - 1
        var found = -1
        while (low <= high) {
            val mid = (low + high) ushr 1
            if (lines[mid].atMs <= positionMs) {
                found = mid
                low = mid + 1
            } else {
                high = mid - 1
            }
        }
        return found
    }
}
