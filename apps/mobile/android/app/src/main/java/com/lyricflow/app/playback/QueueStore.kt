package com.lyricflow.app.playback

import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException

/**
 * The one owner of the saved queue file. Saves and erases go through the same single writer, in the order
 * they were asked for, so an erase (the queue was cleared, or its last song was removed) can never be undone
 * by a save that was queued before it and ran after it — the bug that brought a cleared queue back at launch.
 *
 * A save is written whole next to the real file and renamed over it, so a kill mid-write leaves the last good
 * file, never half of a new one. [writer] must run tasks one at a time, in order (a single-thread executor).
 */
class QueueStore(
    private val file: File,
    private val writer: Executor,
    private val warn: (String) -> Unit = {},
) {
    /** Queues a whole-file save of [text]. */
    fun save(text: String) = submit {
        val temp = File(file.parentFile, file.name + ".tmp")
        temp.writeText(text)
        if (!temp.renameTo(file)) {
            temp.delete()
            warn("queue not saved: could not replace the saved file")
        }
    }

    /** Queues removing the saved queue, behind every save already queued. */
    fun erase() = submit {
        File(file.parentFile, file.name + ".tmp").delete()
        if (file.exists() && !file.delete()) warn("saved queue not removed")
    }

    private fun submit(task: () -> Unit) {
        try {
            writer.execute {
                try {
                    task()
                } catch (e: Exception) {
                    warn("queue store: ${e.message}")
                }
            }
        } catch (_: RejectedExecutionException) {
            // The service is going away and the writer is already shut down: the last request went out.
        }
    }
}
