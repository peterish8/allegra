package com.lyricflow.app.island

/**
 * The rules of "Play here" that need no Android: where another app's song is right now, which of the phone's media
 * sessions is worth offering, and which are not songs at all. Pure, so the JVM tests cover them (OutsideMathTest);
 * `OutsideMedia` feeds them from the real sessions.
 */
object OutsideMath {
    /** A track shorter than this is an ad, a jingle or a voice-over (Spotify's DJ), never a song to take over. */
    const val MIN_DURATION_MS = 30_000L

    /** What `choose` needs to know about one media session. [durationMs] is 0 or negative when the app gave none. */
    class Session(
        val packageName: String,
        val title: String,
        val artist: String,
        val durationMs: Long,
        val mediaId: String,
        val playing: Boolean,
    )

    /**
     * Where the song is at [nowMs] (the clock `lastPositionUpdateTime` is on, SystemClock.elapsedRealtime):
     * the position the app reported plus the time since, at its speed, while it plays; the reported position alone
     * when it does not. Kept inside the song once its length is known. An unknown position ([positionMs] below 0)
     * reads as the start.
     */
    fun liveMs(positionMs: Long, updatedAtMs: Long, speed: Float, playing: Boolean, nowMs: Long, durationMs: Long = 0L): Long {
        var at = positionMs.coerceAtLeast(0L)
        // An app that never stamped its position (0) gives us nothing to measure the time since from.
        if (playing && updatedAtMs > 0L) {
            val elapsed = (nowMs - updatedAtMs).coerceAtLeast(0L)
            // A playing session that reports no speed is playing at normal speed.
            val rate = if (speed > 0f) speed else 1f
            at += (elapsed * rate).toLong()
        }
        return if (durationMs > 0L) at.coerceAtMost(durationMs) else at
    }

    /** [liveMs] in seconds, which is the unit JavaScript sees everywhere. */
    fun liveSeconds(positionMs: Long, updatedAtMs: Long, speed: Float, playing: Boolean, nowMs: Long, durationMs: Long = 0L): Double =
        liveMs(positionMs, updatedAtMs, speed, playing, nowMs, durationMs) / 1000.0

    /**
     * True when the session is not a song worth finding in LuvLyrics: no artist (an ad, a podcast, a video with
     * no music metadata), a known length under [MIN_DURATION_MS], or a media id that names an episode.
     */
    fun skip(artist: String, durationMs: Long, mediaId: String): Boolean {
        if (artist.isBlank()) return true
        if (durationMs in 1 until MIN_DURATION_MS) return true
        val id = mediaId.lowercase()
        return EPISODE_MARKS.any { id.contains(it) }
    }

    /**
     * The session to offer: the first (Android lists the most recently active first) that is playing, is not
     * [ownPackage]'s, has a title and is not skipped. Null when none is.
     */
    fun choose(sessions: List<Session>, ownPackage: String): Session? = sessions.firstOrNull {
        it.playing && it.packageName != ownPackage && it.title.isNotBlank() && !skip(it.artist, it.durationMs, it.mediaId)
    }

    /**
     * Whether the other app shows the song as liked: a heart rating it set on the song ([heart], null when it gave
     * none), or a custom action that undoes a like ("Remove from Liked Songs", "Unlike", "Remove like"), which the
     * app offers only for a song that is liked. ponytail: label matching, English labels only; a localised app
     * reads as not liked, which only skips the like.
     */
    fun isLiked(heart: Boolean?, actionNames: List<String>): Boolean {
        if (heart == true) return true
        return actionNames.any { LIKED_ACTION.containsMatchIn(it.trim()) }
    }

    /** The name to show for [packageName]: what Android resolved ([resolved]) if it did, else the known apps, else the package's last word. */
    fun appLabel(packageName: String, resolved: String?): String {
        if (!resolved.isNullOrBlank()) return resolved
        KNOWN_APPS[packageName]?.let { return it }
        val last = packageName.substringAfterLast('.')
        return last.replaceFirstChar { it.uppercase() }.ifEmpty { packageName }
    }

    private val EPISODE_MARKS = listOf("episode", "podcast")
    private val LIKED_ACTION = Regex("^(remove from (your )?(liked|favou?rites|library)|unlike|remove like)", RegexOption.IGNORE_CASE)
    private val KNOWN_APPS = mapOf(
        "com.spotify.music" to "Spotify",
        "com.google.android.apps.youtube.music" to "YouTube Music",
        "com.google.android.youtube" to "YouTube",
        "com.apple.android.music" to "Apple Music",
        "com.amazon.mp3" to "Amazon Music",
        "deezer.android.app" to "Deezer",
        "com.soundcloud.android" to "SoundCloud",
        "com.aspiro.tidal" to "TIDAL",
    )
}
