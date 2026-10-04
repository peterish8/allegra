package com.lyricflow.app.playback

import com.lyricflow.app.playback.QueueMath.RepeatKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class QueueSnapshotTest {

    private val songs = listOf(
        QueueItemSpec("a", "file:///a.mp3", "A", "Artist", "Album", "https://img/a.jpg"),
        QueueItemSpec("b", "https://cdn.example/b.m4a", "B"),
        QueueItemSpec("c", "content://media/external/audio/3", "C", "Artist C"),
    )

    private fun snapshot() = QueueSnapshot(
        tag = "library#7", index = 1, positionMs = 12_345L, shuffle = true, repeat = RepeatKind.ONE, items = songs,
    )

    @Test
    fun `a snapshot survives being written and read back`() {
        assertEquals(snapshot(), QueueSnapshot.decode(snapshot().encode()))
    }

    @Test
    fun `a missing tag stays missing`() {
        val back = QueueSnapshot.decode(snapshot().copy(tag = null).encode())!!
        assertNull(back.tag)
    }

    @Test
    fun `a file cut short by a kill mid-write is refused, not half-read`() {
        val text = snapshot().encode()
        for (cut in listOf(0, 1, text.length / 3, text.length / 2, text.length - 1)) {
            assertNull("cut at $cut", QueueSnapshot.decode(text.substring(0, cut)))
        }
    }

    @Test
    fun `another version or nonsense is refused`() {
        assertNull(QueueSnapshot.decode("""{"v":2,"items":[{"id":"a","uri":"file:///a.mp3"}]}"""))
        assertNull(QueueSnapshot.decode("""{"items":[{"id":"a","uri":"file:///a.mp3"}]}"""))
        assertNull(QueueSnapshot.decode("not json"))
        assertNull(QueueSnapshot.decode("""{"v":1,"items":"nope"}"""))
    }

    @Test
    fun `a queue with nothing playable in it is refused`() {
        assertNull(QueueSnapshot.decode("""{"v":1,"index":0,"items":[]}"""))
        assertNull(QueueSnapshot.decode("""{"v":1,"index":0,"items":[{"id":"a","uri":"http://insecure/a.mp3"},{"id":"","uri":"file:///x"}]}"""))
    }

    @Test
    fun `songs that cannot play are dropped and the index is kept inside the list`() {
        val back = QueueSnapshot.decode(
            """{"v":1,"index":9,"positionMs":-5,"shuffle":false,"repeat":"sideways","items":[
                {"id":"a","uri":"file:///a.mp3"},{"id":"x","uri":"ftp://nope"},{"id":"b","uri":"https://b/b.mp3"}]}"""
        )
        assertNotNull(back)
        assertEquals(listOf("a", "b"), back!!.items.map { it.id })
        assertEquals(1, back.index)
        assertEquals(0L, back.positionMs)
        assertEquals(RepeatKind.ALL, back.repeat)
    }

    @Test
    fun `a runaway file is cut to the limit`() {
        val many = (0 until QueueSnapshot.MAX_ITEMS + 50).map { QueueItemSpec("id$it", "file:///$it.mp3") }
        val back = QueueSnapshot.decode(snapshot().copy(index = 0, items = many).encode())!!
        assertEquals(QueueSnapshot.MAX_ITEMS, back.items.size)
    }
}
