package com.lyricflow.app.island

import android.os.Handler
import android.os.Looper

/**
 * The playing song's timed lyric lines, handed over by JavaScript once per song
 * (`DynamicIslandModule.setLyrics`). The island finds the sung line from the player's own position, so
 * the lines keep moving while JavaScript sleeps. Lines show only for the song they were sent for.
 */
object IslandLyrics {
    /**
     * [marks], letter by letter only: `[charEnd, startMs, endMs]` per word, flattened, where charEnd is where the
     * word (and the space after it) ends in [text]. Null draws the line whole, as line by line does.
     */
    class Line(val atMs: Long, val text: String, val marks: FloatArray? = null)

    /** One snapshot, swapped whole: a reader never sees one song's id with another song's lines. */
    private class Sheet(val songId: String, val lines: List<Line>)

    @Volatile private var sheet: Sheet? = null

    /** Told on the main thread whenever the lines change. The island's view sets it while attached. */
    @Volatile var onChange: (() -> Unit)? = null

    // Lazy, so the pure helpers below run in JVM unit tests without Android's main looper.
    private val main by lazy { Handler(Looper.getMainLooper()) }

    fun set(songId: String, atMs: List<Long>, texts: List<String>, marks: List<List<Double>> = emptyList()) {
        sheet = Sheet(songId, linesOf(atMs, texts, marks))
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
    fun linesOf(atMs: List<Long>, texts: List<String>, marks: List<List<Double>> = emptyList()): List<Line> =
        atMs.indices
            .mapNotNull { i ->
                // Marks index into the text exactly as sent, so a line with marks is never trimmed.
                val raw = texts.getOrNull(i) ?: return@mapNotNull null
                val own = marks.getOrNull(i)?.takeIf { it.isNotEmpty() && it.size % 3 == 0 }
                if (own != null && raw.isNotBlank()) Line(atMs[i], raw, FloatArray(own.size) { k -> own[k].toFloat() })
                else raw.trim().takeIf { it.isNotEmpty() }?.let { Line(atMs[i], it) }
            }
            .sortedBy { it.atMs }

    /**
     * How many characters of [line] are lit at [positionMs], with a fraction for the letter being sung: the app's
     * letter-by-letter sweep. -1 for a line with no marks (it is drawn whole).
     */
    fun litChars(line: Line, positionMs: Long): Float {
        val marks = line.marks ?: return -1f
        val at = positionMs.toFloat()
        var litEnd = 0f
        var i = 0
        while (i + 2 < marks.size) {
            val charEnd = marks[i]
            val start = marks[i + 1]
            val end = marks[i + 2]
            if (at < start) return litEnd
            if (at < end && end > start) return litEnd + (charEnd - litEnd) * (at - start) / (end - start)
            litEnd = charEnd
            i += 3
        }
        return litEnd.coerceAtMost(line.text.length.toFloat())
    }

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
