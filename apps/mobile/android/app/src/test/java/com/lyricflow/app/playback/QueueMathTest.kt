package com.lyricflow.app.playback

import com.lyricflow.app.playback.QueueMath.EndAction
import com.lyricflow.app.playback.QueueMath.PreviousAction
import com.lyricflow.app.playback.QueueMath.RepeatKind
import kotlin.random.Random
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueMathTest {

    @Test
    fun `previous restarts a song that is more than 3 seconds in`() {
        assertEquals(PreviousAction.RESTART, QueueMath.previousAction(3_001, hasPrevious = true))
        assertEquals(PreviousAction.RESTART, QueueMath.previousAction(60_000, hasPrevious = true))
    }

    @Test
    fun `previous goes back inside the first 3 seconds`() {
        assertEquals(PreviousAction.GO_BACK, QueueMath.previousAction(0, hasPrevious = true))
        assertEquals(PreviousAction.GO_BACK, QueueMath.previousAction(3_000, hasPrevious = true))
    }

    @Test
    fun `previous restarts when there is nothing before the song`() {
        assertEquals(PreviousAction.RESTART, QueueMath.previousAction(500, hasPrevious = false))
    }

    @Test
    fun `running low counts the playing song and four after it`() {
        assertTrue(QueueMath.runningLow(after = 0))
        assertTrue(QueueMath.runningLow(after = 4))
        assertFalse(QueueMath.runningLow(after = 5))
    }

    @Test
    fun `repeat wire names round trip and unknown means all`() {
        for (kind in RepeatKind.values()) assertEquals(kind, RepeatKind.fromWire(kind.wire))
        assertEquals(RepeatKind.ALL, RepeatKind.fromWire(null))
        assertEquals(RepeatKind.ALL, RepeatKind.fromWire("sideways"))
    }

    @Test
    fun `finishing the queue restarts it under repeat all and rests otherwise`() {
        assertEquals(EndAction.RESTART_AND_PLAY, QueueMath.endAction(RepeatKind.ALL, 3))
        assertEquals(EndAction.RESET_AND_PAUSE, QueueMath.endAction(RepeatKind.OFF, 3))
        assertEquals(EndAction.NONE, QueueMath.endAction(RepeatKind.ALL, 0))
    }

    @Test
    fun `shuffled order starts with the current song and holds every song once`() {
        for (current in 0 until 8) {
            val order = QueueMath.shuffledOrder(8, current, Random(42 + current))
            assertEquals(current, order[0])
            assertEquals((0 until 8).toList(), order.sorted())
        }
    }

    @Test
    fun `shuffled order of nothing is empty and an unknown current just shuffles`() {
        assertEquals(0, QueueMath.shuffledOrder(0, 0).size)
        assertEquals((0 until 5).toList(), QueueMath.shuffledOrder(5, -1, Random(1)).sorted())
    }

    @Test
    fun `play next puts the new songs right after the playing one and keeps the rest in order`() {
        // Playlist 0..5, play order 3 (playing), 0, 5, 1, 4, 2; songs 6 and 7 were just inserted somewhere.
        val order = listOf(3, 0, 6, 5, 7, 1, 4, 2)
        val result = QueueMath.orderWithNextBlock(order, current = 3, inserted = listOf(6, 7))
        assertArrayEquals(intArrayOf(3, 6, 7, 0, 5, 1, 4, 2), result)
    }

    @Test
    fun `appended songs go to the end of the play order`() {
        val order = listOf(2, 6, 0, 7, 1)
        assertArrayEquals(intArrayOf(2, 0, 1, 6, 7), QueueMath.orderWithAppended(order, listOf(6, 7)))
    }

    @Test
    fun `duplicates are listed highest first and never include the song to keep`() {
        val existing = listOf("a", "b", "c", "b", "d", "b")
        assertEquals(listOf(5, 3), QueueMath.duplicateIndices(existing, setOf("b"), keep = 1))
        assertEquals(listOf(5, 3, 1), QueueMath.duplicateIndices(existing, setOf("b"), keep = 0))
        assertEquals(emptyList<Int>(), QueueMath.duplicateIndices(existing, emptySet(), keep = 0))
    }

    @Test
    fun `current song is found in a replacement queue or reported missing`() {
        assertEquals(2, QueueMath.locateCurrent(listOf("x", "y", "z", "z"), "z"))
        assertEquals(-1, QueueMath.locateCurrent(listOf("x", "y"), "z"))
        assertEquals(-1, QueueMath.locateCurrent(listOf("x", "y"), null))
    }

    @Test
    fun `only file, content and https addresses are allowed`() {
        assertTrue(QueueItemSpec.isAllowedUri("file:///music/a.mp3"))
        assertTrue(QueueItemSpec.isAllowedUri("content://media/external/audio/1"))
        assertTrue(QueueItemSpec.isAllowedUri("HTTPS://cdn.example/a.m4a"))
        assertFalse(QueueItemSpec.isAllowedUri("http://cdn.example/a.m4a"))
        assertFalse(QueueItemSpec.isAllowedUri("javascript:alert(1)"))
        assertFalse(QueueItemSpec.isAllowedUri(""))
        assertEquals(null, QueueItemSpec.fromMap(mapOf("id" to "a", "uri" to "http://cdn.example/a.m4a")))
    }

    @Test
    fun `a spec needs an id and an address`() {
        assertEquals(null, QueueItemSpec.fromMap(mapOf("id" to "a")))
        assertEquals(null, QueueItemSpec.fromMap(mapOf("uri" to "file:///a.mp3")))
        val spec = QueueItemSpec.fromMap(mapOf("id" to "a", "uri" to "file:///a.mp3", "title" to "T"))!!
        assertEquals("T", spec.title)
        assertEquals("", spec.artist)
        assertEquals(spec, QueueItemSpec.fromMap(spec.toMap()))
    }
}
