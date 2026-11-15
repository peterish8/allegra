package com.lyricflow.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamCacheKeyTest {

    private val first = "https://aac.saavncdn.com/123/abc_320.mp4?Expires=1&Signature=x"

    @Test
    fun `same path with a refreshed signed query gives the same key`() {
        assertEquals(StreamCacheKey.of("stream:saavn:AbC1", first), StreamCacheKey.of("stream:saavn:AbC1", "https://aac.saavncdn.com/123/abc_320.mp4?Expires=2&Signature=y"))
    }

    @Test
    fun `another file of the same song gets another key`() {
        assertNotEquals(StreamCacheKey.of("stream:saavn:AbC1", first), StreamCacheKey.of("stream:saavn:AbC1", "https://aac.saavncdn.com/123/abc_160.mp4?Expires=1"))
    }

    @Test
    fun `files and content are not cached`() {
        assertNull(StreamCacheKey.of("a", "file:///music/a.mp3"))
        assertNull(StreamCacheKey.of("a", "content://media/external/audio/3"))
        assertNull(StreamCacheKey.of("a", "http://plain.example/a.mp3"))
    }

    @Test
    fun `a blank media id is not cached`() {
        assertNull(StreamCacheKey.of(" ", first))
    }

    @Test
    fun `the key has its version and sixteen hex characters`() {
        val key = StreamCacheKey.of("stream:saavn:AbC1", first)!!
        assertTrue(key, Regex("^v1\\|stream:saavn:AbC1\\|[0-9a-f]{16}$").matches(key))
    }

    @Test
    fun `the key matches the one JavaScript computes`() {
        // Same literal as src/playback/streamCacheKey.test.ts.
        assertEquals(JS_KEY, StreamCacheKey.of("stream:saavn:AbC1", first))
    }

    companion object {
        const val JS_KEY = "v1|stream:saavn:AbC1|2e495ae43869cfe1"
    }
}
