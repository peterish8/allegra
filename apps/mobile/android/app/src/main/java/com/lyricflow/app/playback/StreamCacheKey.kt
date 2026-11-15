package com.lyricflow.app.playback

import java.net.URI
import java.security.MessageDigest

/**
 * The disk-cache key for one song's bytes, or null when the address is not cached (anything but https).
 *
 * Keyed by the song id plus a hash of host and path, never the full URL: a refreshed signed link changes only its
 * query string, so it keeps the cached bytes, while another file (another quality) gets another key and two
 * renditions can never mix. `src/playback/streamCacheKey.ts` computes the same key in JavaScript.
 */
object StreamCacheKey {
    const val VERSION = "v1"

    fun of(mediaId: String, uri: String): String? {
        if (mediaId.isBlank()) return null
        val parsed = try { URI(uri) } catch (_: Exception) { return null }
        if (!parsed.scheme.equals("https", ignoreCase = true)) return null
        val host = parsed.host?.lowercase() ?: return null
        val path = parsed.rawPath ?: ""
        val digest = MessageDigest.getInstance("SHA-256").digest((host + path).toByteArray(Charsets.UTF_8))
        val hex = digest.joinToString("") { "%02x".format(it) }.substring(0, 16)
        return "$VERSION|$mediaId|$hex"
    }
}
