package com.lyricflow.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class QueueStoreTest {

    @get:Rule
    val folder = TemporaryFolder()

    /** Holds tasks until [runAll], in the order they arrived, like the engine's single writer under load. */
    private class HeldWriter : Executor {
        val tasks = ArrayDeque<Runnable>()
        override fun execute(command: Runnable) { tasks.addLast(command) }
        fun runAll() { while (tasks.isNotEmpty()) tasks.removeFirst().run() }
    }

    private fun file(): File = File(folder.root, "native-queue.json")

    @Test
    fun `a save queued before a clear cannot bring the cleared queue back`() {
        val writer = HeldWriter()
        val store = QueueStore(file(), writer)
        store.save("old queue")
        store.erase() // the listener cleared the queue while the save was still waiting to be written
        writer.runAll()
        assertFalse(file().exists())
    }

    @Test
    fun `a save after a clear is the queue that is kept`() {
        val writer = HeldWriter()
        val store = QueueStore(file(), writer)
        store.save("old queue")
        store.erase()
        store.save("new queue")
        writer.runAll()
        assertEquals("new queue", file().readText())
    }

    @Test
    fun `removing the last song erases a queue saved earlier`() {
        val writer = HeldWriter()
        val store = QueueStore(file(), writer)
        store.save("one song")
        writer.runAll()
        assertTrue(file().exists())
        store.erase()
        writer.runAll()
        assertFalse(file().exists())
        assertFalse(File(folder.root, "native-queue.json.tmp").exists())
    }

    @Test
    fun `a real single writer keeps the order under many interleaved requests`() {
        val writer = Executors.newSingleThreadExecutor()
        val store = QueueStore(file(), writer)
        repeat(50) { store.save("queue $it"); store.erase() }
        store.save("final")
        writer.shutdown()
        assertTrue(writer.awaitTermination(5, TimeUnit.SECONDS))
        assertEquals("final", file().readText())
    }

    @Test
    fun `requests after the writer shut down are dropped quietly`() {
        val writer = Executors.newSingleThreadExecutor()
        val store = QueueStore(file(), writer)
        writer.shutdown()
        store.save("late")
        store.erase()
        assertFalse(file().exists())
    }
}
