package com.lyricflow.app.island

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class OutsideMathTest {
    private fun session(
        pkg: String = "com.spotify.music", title: String = "Halo", artist: String = "Beyonce",
        durationMs: Long = 261_000L, mediaId: String = "spotify:track:1", playing: Boolean = true,
    ) = OutsideMath.Session(pkg, title, artist, durationMs, mediaId, playing)

    @Test
    fun `a playing song moves on from its last report at its speed`() {
        // Reported 42.0 s in, 1.5 s ago, at normal speed.
        assertEquals(43_500L, OutsideMath.liveMs(42_000L, 10_000L, 1f, true, 11_500L))
        assertEquals(43.5, OutsideMath.liveSeconds(42_000L, 10_000L, 1f, true, 11_500L), 0.0001)
        // At 1.5x it covers more of the song in the same time.
        assertEquals(44_250L, OutsideMath.liveMs(42_000L, 10_000L, 1.5f, true, 11_500L))
    }

    @Test
    fun `a paused song stays where it was reported`() {
        assertEquals(42_000L, OutsideMath.liveMs(42_000L, 10_000L, 0f, false, 99_000L))
    }

    @Test
    fun `a playing session with no speed counts at normal speed`() {
        assertEquals(43_000L, OutsideMath.liveMs(42_000L, 10_000L, 0f, true, 11_000L))
    }

    @Test
    fun `an unknown position reads as the start and a missing stamp adds nothing`() {
        assertEquals(0L, OutsideMath.liveMs(-1L, 0L, 1f, false, 5_000L))
        assertEquals(30_000L, OutsideMath.liveMs(30_000L, 0L, 1f, true, 9_000_000L))
        // A stamp from the future (clock skew) never runs the song backwards.
        assertEquals(42_000L, OutsideMath.liveMs(42_000L, 20_000L, 1f, true, 10_000L))
    }

    @Test
    fun `the position stays inside a song of known length`() {
        assertEquals(180_000L, OutsideMath.liveMs(179_000L, 1_000L, 1f, true, 60_000L, durationMs = 180_000L))
        assertEquals(500_000L, OutsideMath.liveMs(179_000L, 1_000L, 1f, true, 322_000L, durationMs = 0L))
    }

    @Test
    fun `an ad, a jingle and a podcast are not songs`() {
        assertTrue("no artist", OutsideMath.skip("", 200_000L, "spotify:track:1"))
        assertTrue("blank artist", OutsideMath.skip("  ", 200_000L, "spotify:track:1"))
        assertTrue("under 30 s", OutsideMath.skip("DJ", 29_999L, "spotify:track:1"))
        assertTrue("episode id", OutsideMath.skip("Joe", 3_600_000L, "spotify:episode:abc"))
        assertTrue("podcast id", OutsideMath.skip("Joe", 3_600_000L, "https://x/Podcast/9"))
    }

    @Test
    fun `a song with an unknown length is kept and 30 seconds exactly is a song`() {
        assertFalse(OutsideMath.skip("Beyonce", 0L, "spotify:track:1"))
        assertFalse(OutsideMath.skip("Beyonce", -1L, ""))
        assertFalse(OutsideMath.skip("Beyonce", 30_000L, "spotify:track:1"))
    }

    @Test
    fun `the first playing outside song is offered`() {
        val paused = session(pkg = "com.apple.android.music", title = "Old", playing = false)
        val first = session(pkg = "com.google.android.apps.youtube.music", title = "Halo")
        val second = session(title = "Other")
        assertSame(first, OutsideMath.choose(listOf(paused, first, second), "com.lyricflow.app"))
    }

    @Test
    fun `our own session, untitled and skipped sessions are never offered`() {
        val own = session(pkg = "com.lyricflow.app")
        val untitled = session(title = " ")
        val ad = session(title = "Advertisement", artist = "")
        val episode = session(mediaId = "spotify:episode:1")
        val song = session(title = "Halo")
        assertNull(OutsideMath.choose(listOf(own, untitled, ad, episode), "com.lyricflow.app"))
        assertSame(song, OutsideMath.choose(listOf(own, untitled, ad, episode, song), "com.lyricflow.app"))
    }

    @Test
    fun `nothing is offered when nothing plays`() {
        assertNull(OutsideMath.choose(emptyList(), "com.lyricflow.app"))
        assertNull(OutsideMath.choose(listOf(session(playing = false)), "com.lyricflow.app"))
    }

    @Test
    fun `an app is named as Android resolved it, else as we know it, else by its package`() {
        assertEquals("Spotify Lite", OutsideMath.appLabel("com.spotify.music", "Spotify Lite"))
        assertEquals("Spotify", OutsideMath.appLabel("com.spotify.music", null))
        assertEquals("YouTube Music", OutsideMath.appLabel("com.google.android.apps.youtube.music", " "))
        assertEquals("Newplayer", OutsideMath.appLabel("org.example.newplayer", null))
    }

    @Test
    fun `a song is liked by a set heart or an action that undoes a like`() {
        assertTrue(OutsideMath.isLiked(true, emptyList()))
        assertTrue(OutsideMath.isLiked(null, listOf("Shuffle", "Remove from Liked Songs")))
        assertTrue(OutsideMath.isLiked(null, listOf(" unlike ")))
        assertTrue(OutsideMath.isLiked(false, listOf("Remove like")))
    }

    @Test
    fun `a song is not liked when the app offers to like it or says nothing`() {
        assertFalse(OutsideMath.isLiked(null, emptyList()))
        assertFalse(OutsideMath.isLiked(false, listOf("Add to Liked Songs", "Like", "Shuffle")))
        assertFalse(OutsideMath.isLiked(null, listOf("Liked by 3 friends")))
    }
}
