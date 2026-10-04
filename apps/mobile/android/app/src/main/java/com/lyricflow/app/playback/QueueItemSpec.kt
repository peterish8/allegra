package com.lyricflow.app.playback

/**
 * One song as the engine needs it: enough to play it and to show it on the lock screen. The full song (lyrics,
 * likes, ...) stays in JavaScript, keyed by [id].
 */
data class QueueItemSpec(
    val id: String,
    val uri: String,
    val title: String = "",
    val artist: String = "",
    val album: String = "",
    val artworkUri: String = "",
) {
    companion object {
        /**
         * Trust boundary for anything that becomes a MediaItem address: the library and downloads are file or
         * content, streams and covers are https.
         */
        fun isAllowedUri(uri: String): Boolean {
            if (uri.isBlank() || uri.length > 4096) return false
            val scheme = uri.substringBefore(':', "").lowercase()
            return scheme == "file" || scheme == "content" || scheme == "https"
        }

        /** From the map React Native sends. Null for an item that has no id or no allowed, playable address. */
        fun fromMap(map: Map<String, String>): QueueItemSpec? {
            val id = map["id"].orEmpty()
            val uri = map["uri"].orEmpty()
            if (id.isBlank() || !isAllowedUri(uri)) return null
            return QueueItemSpec(id, uri, map["title"].orEmpty(), map["artist"].orEmpty(), map["album"].orEmpty(), map["artworkUri"].orEmpty())
        }
    }

    fun toMap(): Map<String, String> = mapOf("id" to id, "uri" to uri, "title" to title, "artist" to artist, "album" to album, "artworkUri" to artworkUri)
}
