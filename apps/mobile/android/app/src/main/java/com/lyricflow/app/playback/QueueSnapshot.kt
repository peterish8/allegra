package com.lyricflow.app.playback

import com.lyricflow.app.playback.QueueMath.RepeatKind
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * The queue as it is written to disk (Echo Music's persistent queue) so it can come back after the service or the
 * app is killed. [items] are in play order, so a shuffled queue returns in the order it was going to play.
 * Position is milliseconds here (Media3's unit); the screen deals in seconds and the module converts.
 */
data class QueueSnapshot(
    val tag: String?,
    val index: Int,
    val positionMs: Long,
    val shuffle: Boolean,
    val repeat: RepeatKind,
    val items: List<QueueItemSpec>,
) {
    fun encode(): String =
        JSONObject()
            .put("v", VERSION)
            .put("tag", tag ?: JSONObject.NULL)
            .put("index", index)
            .put("positionMs", positionMs)
            .put("shuffle", shuffle)
            .put("repeat", repeat.wire)
            .put("items", JSONArray(items.map { JSONObject(it.toMap()) }))
            .toString()

    companion object {
        const val VERSION = 1

        /** More than this is cut: nobody lines up more, and a runaway file must not stall the service. */
        const val MAX_ITEMS = 2_000

        /**
         * Null for anything that is not a complete, current-version snapshot with at least one playable song: a
         * file cut short by a kill mid-write, another version, or hand-edited nonsense. A bad file must never
         * stop the service from starting.
         */
        fun decode(text: String): QueueSnapshot? = try {
            val o = JSONObject(text)
            if (o.optInt("v", -1) != VERSION) {
                null
            } else {
                val array = o.getJSONArray("items")
                val items = ArrayList<QueueItemSpec>()
                for (i in 0 until minOf(array.length(), MAX_ITEMS)) {
                    val item = array.optJSONObject(i) ?: continue
                    val spec = QueueItemSpec.fromMap(
                        mapOf(
                            "id" to item.optString("id"),
                            "uri" to item.optString("uri"),
                            "title" to item.optString("title"),
                            "artist" to item.optString("artist"),
                            "album" to item.optString("album"),
                            "artworkUri" to item.optString("artworkUri"),
                        )
                    )
                    if (spec != null) items.add(spec)
                }
                if (items.isEmpty()) {
                    null
                } else {
                    QueueSnapshot(
                        tag = if (o.isNull("tag")) null else o.optString("tag"),
                        index = o.optInt("index", 0).coerceIn(0, items.lastIndex),
                        positionMs = o.optLong("positionMs", 0L).coerceAtLeast(0L),
                        shuffle = o.optBoolean("shuffle", false),
                        repeat = RepeatKind.fromWire(o.optString("repeat")),
                        items = items,
                    )
                }
            }
        } catch (_: JSONException) {
            null
        }
    }
}
