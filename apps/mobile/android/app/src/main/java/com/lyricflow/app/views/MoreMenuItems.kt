package com.lyricflow.app.views

import org.json.JSONArray

/** One entry of the "More" menu as `moreItemsPayload` (TypeScript) hands it over. */
data class MoreMenuItem(val key: String, val label: String, val icon: String, val hint: String?, val tile: Boolean)

/** The props of the native More items: `items` JSON. Pure, so it is tested on the JVM. */
object MoreMenuItems {
    /** Tiles first, then rows; anything malformed gives an empty list (the view then draws nothing, never crashes). */
    fun parse(json: String?): List<MoreMenuItem> {
        if (json.isNullOrEmpty()) return emptyList()
        return try {
            val array = JSONArray(json)
            val out = ArrayList<MoreMenuItem>(array.length())
            for (n in 0 until array.length()) {
                val o = array.getJSONObject(n)
                out += MoreMenuItem(
                    key = o.getString("key"),
                    label = o.getString("label"),
                    icon = o.getString("icon"),
                    hint = if (o.isNull("hint")) null else o.optString("hint").takeIf { it.isNotEmpty() },
                    tile = o.optBoolean("tile", false),
                )
            }
            // The geometry has exactly MoreMenuGeometry.TILES tiles up front; anything else is not drawable.
            val tiles = out.count { it.tile }
            if (tiles != MoreMenuGeometry.TILES || out.take(tiles).any { !it.tile }) emptyList() else out
        } catch (_: Exception) {
            emptyList()
        }
    }
}
