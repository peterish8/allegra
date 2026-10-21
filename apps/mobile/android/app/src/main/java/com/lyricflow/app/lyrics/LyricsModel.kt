package com.lyricflow.app.lyrics

import org.json.JSONObject

/**
 * What JavaScript hands the native lyrics (`nativeLyricsPayload.ts`): the lines with when each is sung and, for the
 * letter sweep, which characters are sung between which two moments, all on the player's own clock with the
 * listener's lyrics delay already taken off. Nothing here is invented: a line without usable timing has no segments
 * and lights as a whole.
 */
class LyricsRow(
    /** When the line is sung on the player's clock, ms. */
    val atMs: Long,
    /** The line's own timestamp in seconds, what a tap hands back to the playback flow. */
    val timestamp: Double,
    val text: String,
    /** A music break: drawn as the moving equalizer instead of text. */
    val instrumental: Boolean,
    val from: FloatArray,
    val to: FloatArray,
    val startMs: LongArray,
    val endMs: LongArray,
) {
    val hasSegments: Boolean get() = from.isNotEmpty()
}

class LyricsSheet(val songId: String, val letters: Boolean, val rows: List<LyricsRow>) {
    val atMs = LongArray(rows.size) { rows[it].atMs }

    /** Whether [other] has the same lines to draw (timings may differ: a delay change keeps the layouts). */
    fun sameText(other: LyricsSheet): Boolean {
        if (rows.size != other.rows.size) return false
        for (i in rows.indices) {
            if (rows[i].text != other.rows[i].text || rows[i].instrumental != other.rows[i].instrumental) return false
        }
        return true
    }
}

enum class LyricsAlign { LEFT, CENTER, RIGHT }

/** Text style and geometry, in dp / sp as JavaScript knows them. */
class LyricsConfig(
    val fontSize: Float,
    val lineHeight: Float,
    /** SF Pro tracking in points, from `sfTracking(fontSize)`. */
    val tracking: Float,
    /** The space above and below each line. */
    val gap: Float,
    val align: LyricsAlign,
    val padH: Float,
    /** Where the sung line's centre rides, 0 top .. 1 bottom. */
    val activePos: Float,
    val topSpacer: Float,
    val bottomSpacer: Float,
    /** Soft dissolve at the top and bottom edges, dp (0 = none). */
    val edgeFade: Float,
    val title: String?,
    /** Copies that make the sweep's soft edge: 1 under Reduce Motion, 2 on a low-end phone, else 3. */
    val featherCount: Int,
    val reduceMotion: Boolean,
) {
    /** The part of the style that decides how lines are laid out. */
    fun layoutKey(): String = "$fontSize|$lineHeight|$tracking|$gap|$align|$padH|$title"
}

object LyricsParser {
    private const val MAX_ROWS = 3000
    private const val MAX_SEGMENTS = 300
    private const val MAX_JSON = 4_000_000

    /** The sheet in [json], or null when it is malformed (the previous one stays). */
    fun sheet(json: String): LyricsSheet? {
        if (json.length > MAX_JSON) return null
        return try {
            val root = JSONObject(json)
            val songId = root.getString("songId")
            if (songId.isEmpty()) return null
            val letters = root.optBoolean("letters", false)
            val array = root.getJSONArray("rows")
            val rows = ArrayList<LyricsRow>(minOf(array.length(), MAX_ROWS))
            for (i in 0 until minOf(array.length(), MAX_ROWS)) {
                val row = array.getJSONObject(i)
                val text = row.getString("text")
                val atMs = row.getLong("atMs").coerceAtLeast(0)
                val timestamp = row.getDouble("ts")
                if (!timestamp.isFinite()) continue
                val instrumental = row.optBoolean("instrumental", false)
                val parts = row.optJSONArray("segments")
                val from = ArrayList<Float>()
                val to = ArrayList<Float>()
                val start = ArrayList<Long>()
                val end = ArrayList<Long>()
                if (!instrumental && parts != null) {
                    for (j in 0 until minOf(parts.length(), MAX_SEGMENTS)) {
                        val part = parts.getJSONObject(j)
                        val f = part.getDouble("from").toFloat()
                        val t = part.getDouble("to").toFloat()
                        val s = part.getLong("startMs")
                        val e = part.getLong("endMs")
                        // Fractional offsets from JavaScript can land a hair past the end.
                        if (!f.isFinite() || !t.isFinite() || f < 0f || t <= f || t > text.length + 0.01f || s < 0 || e <= s) continue
                        from += f
                        to += t.coerceAtMost(text.length.toFloat())
                        start += s
                        end += e
                    }
                }
                rows += LyricsRow(atMs, timestamp, text, instrumental, from.toFloatArray(), to.toFloatArray(), start.toLongArray(), end.toLongArray())
            }
            LyricsSheet(songId, letters, rows)
        } catch (_: Exception) {
            null
        }
    }

    fun config(json: String): LyricsConfig? = try {
        val o = JSONObject(json)
        val fontSize = o.getDouble("fontSize").toFloat().coerceIn(8f, 120f)
        LyricsConfig(
            fontSize = fontSize,
            lineHeight = o.optDouble("lineHeight", fontSize * 1.22).toFloat().coerceIn(fontSize * 0.8f, fontSize * 3f),
            tracking = o.optDouble("tracking", 0.0).toFloat().coerceIn(-10f, 10f),
            gap = o.optDouble("gap", 16.0).toFloat().coerceIn(0f, 80f),
            align = when (o.optString("align", "left")) {
                "center" -> LyricsAlign.CENTER
                "right" -> LyricsAlign.RIGHT
                else -> LyricsAlign.LEFT
            },
            padH = o.optDouble("padH", 28.0).toFloat().coerceIn(0f, 80f),
            activePos = o.optDouble("activePos", 0.35).toFloat().coerceIn(0f, 1f),
            topSpacer = o.optDouble("topSpacer", 24.0).toFloat().coerceIn(0f, 2000f),
            bottomSpacer = o.optDouble("bottomSpacer", 0.0).toFloat().coerceIn(0f, 4000f),
            edgeFade = o.optDouble("edgeFade", 0.0).toFloat().coerceIn(0f, 400f),
            title = o.optString("title", "").takeIf { it.isNotBlank() },
            featherCount = o.optInt("featherCount", 3).coerceIn(1, 3),
            reduceMotion = o.optBoolean("reduceMotion", false),
        )
    } catch (_: Exception) {
        null
    }
}
