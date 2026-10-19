package com.lyricflow.app.island

import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/**
 * The playing song's timed lyric lines, handed over by JavaScript once per song
 * (`DynamicIslandModule.setLyrics`). The island finds the sung line from the player's own position, so
 * the lines keep moving while JavaScript sleeps. Lines show only for the song they were sent for.
 */
object IslandLyrics {
    class Segment(val from: Float, val to: Float, val startMs: Long, val endMs: Long)
    class Line(val atMs: Long, val text: String, val segments: List<Segment> = emptyList(), val letters: Boolean = false) {
        val instrumental = isInstrumental(text)
    }

    fun isInstrumental(text: String): Boolean = text.trim()
        .replace(Regex("^[\\s\\[(【♪🎵🎤]+|[\\s\\])】♪🎵🎤]+$"), "").trim()
        .matches(Regex("(?i)instrumental(?:\\s+(?:break|interlude|solo|outro|intro|section))?"))

    /** Character offset on the same native player clock as lineAt, including pauses and seeks. */
    fun highlightOffset(line: Line, positionMs: Long): Float {
        var offset = 0f
        for (segment in line.segments) {
            if (positionMs < segment.startMs) break
            if (positionMs >= segment.endMs) offset = segment.to
            else return segment.from + (segment.to - segment.from) *
                ((positionMs - segment.startMs).toFloat() / (segment.endMs - segment.startMs).coerceAtLeast(1))
        }
        return offset.coerceIn(0f, line.text.length.toFloat())
    }

    /**
     * Whether a line fills letter by letter: the sung one, in letters mode, with timings. Never under
     * Reduce Motion, which gets no redraw ticks, so a sweep would freeze mid-word; the line shows whole.
     */
    fun sweeps(line: Line, sung: Boolean, motionOff: Boolean): Boolean =
        sung && line.letters && line.segments.isNotEmpty() && !line.instrumental && !motionOff

    fun setTiming(songId: String, json: String) {
        val lines = parseTiming(json) ?: return
        sheet = Sheet(songId, lines)
        notifyChange()
    }

    /** The lines in [json] (islandLyricsTiming in dynamicIslandSetup.ts), or null when it is malformed. */
    fun parseTiming(json: String): List<Line>? {
        if (json.length > 1_000_000) return null
        return try {
            val root = JSONObject(json)
            val array = root.getJSONArray("lines")
            val letters = root.optString("highlight") == "letters"
            (0 until minOf(array.length(), 3000)).mapNotNull { i ->
                val row = array.getJSONObject(i)
                val text = row.getString("text").trim()
                if (text.isEmpty()) return@mapNotNull null
                val parts = row.optJSONArray("segments")
                val segments = (0 until minOf(parts?.length() ?: 0, 300)).mapNotNull { j ->
                    val part = parts!!.getJSONObject(j)
                    val from = part.getDouble("from").toFloat()
                    val to = part.getDouble("to").toFloat()
                    val start = part.getLong("startMs")
                    val end = part.getLong("endMs")
                    // Fractional offsets from JavaScript can land a hair past the end.
                    if (!from.isFinite() || !to.isFinite() || from < 0 || to <= from || to > text.length + 0.01f || start < 0 || end <= start) null
                    else Segment(from, to.coerceAtMost(text.length.toFloat()), start, end)
                }
                Line(row.getLong("atMs").coerceAtLeast(0), text, segments, letters)
            }.sortedBy { it.atMs }
        } catch (_: Exception) {
            null // Keep the previous valid sheet on malformed bridge input.
        }
    }

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
