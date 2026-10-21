package com.lyricflow.app.queue

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** A generated cover's inputs (artworkSeed.ts): the colours and the glyph the song's title seeds. */
data class QueueTile(val base: Int, val mid: Int, val spark: Int, val glyph: String, val variant: Int)

/** One row of the Up next list. [index] is its place in the whole queue (the list may be filtered). */
data class QueueRow(
    val index: Int,
    val id: String,
    val title: String,
    val subtitle: String,
    val cover: String?,
    val tile: QueueTile,
)

/** The list's props: `rows` JSON from `nativeQueuePayload.ts`. Pure, so it can be tested on the JVM. */
object QueueParser {
    fun rows(json: String?): List<QueueRow> {
        if (json.isNullOrEmpty()) return emptyList()
        return try {
            val array = JSONArray(json)
            val out = ArrayList<QueueRow>(array.length())
            for (n in 0 until array.length()) {
                val o: JSONObject = array.getJSONObject(n)
                out += QueueRow(
                    index = o.getInt("i"),
                    id = o.optString("id"),
                    title = o.optString("title"),
                    subtitle = o.optString("sub"),
                    cover = if (o.isNull("cover")) null else o.optString("cover").takeIf { it.isNotEmpty() },
                    tile = QueueTile(
                        base = hex(o.optString("base")),
                        mid = hex(o.optString("mid")),
                        spark = hex(o.optString("spark")),
                        glyph = o.optString("glyph", "♪"),
                        variant = o.optInt("variant", 0),
                    ),
                )
            }
            out
        } catch (_: Exception) {
            emptyList()
        }
    }

    /** `#rrggbb` to an opaque ARGB int; anything else is a dark grey. */
    fun hex(value: String): Int {
        val s = value.trim().removePrefix("#")
        if (s.length != 6) return 0xFF282828.toInt()
        val rgb = s.toIntOrNull(16) ?: return 0xFF282828.toInt()
        return (0xFF shl 24) or rgb
    }
}

/** The list's geometry and the reorder rules, the same as `coverStage.ts` (dropIndex, rowShift). */
object QueueMath {
    /** Where a row dragged [dy] points lands, with rows [rowH] tall. */
    fun dropIndex(from: Int, dy: Float, rowH: Float, count: Int): Int =
        max(0, min(count - 1, from + (dy / rowH).roundToInt()))

    /**
     * How far row [i] steps aside while row [from] is dragged over [to], in rows: the rows in between shift one place
     * towards where the dragged row came from.
     */
    fun shiftRows(i: Int, from: Int, to: Int): Int = when {
        from < 0 || i == from -> 0
        from < to && i > from && i <= to -> -1
        to < from && i >= to && i < from -> 1
        else -> 0
    }

    /** The list opens on the playing song, one row of history above it: the offset of the first visible row, in rows. */
    fun startRow(currentRow: Int, count: Int, movable: Boolean): Int =
        if (movable) max(0, min(currentRow - 1, count - 1)) else 0

    fun maxScroll(contentH: Float, viewportH: Float): Float = max(0f, contentH - viewportH)

    /**
     * A drag that starts pulling down while the list is at its top is not the list's: it is the panel's swipe down to
     * close. The list must not claim it (claiming a touch cancels the gesture handlers above it), so the panel's pan
     * gets it. [dy] is the finger's travel since it touched down (down is positive).
     */
    fun yieldsToPanel(scrollY: Float, dy: Float, slack: Float): Boolean = dy > 0f && scrollY <= slack

    /**
     * Where the finger counts as having started a scroll, once it has travelled past [slop]: the slop itself is not
     * scrolled, as React Native's ScrollView does, so the list does not jump when the drag begins.
     */
    fun scrollOrigin(downY: Float, y: Float, slop: Float): Float = if (y < downY) downY - slop else downY + slop

    /** The queue after the row at [from] moves to [to] (moveItem in coverStage.ts), for the local settle. */
    fun <T> move(items: List<T>, from: Int, to: Int): List<T> {
        if (from < 0 || from >= items.size) return items
        val out = items.toMutableList()
        val target = max(0, min(out.size - 1, to))
        val item = out.removeAt(from)
        out.add(target, item)
        return out
    }
}
