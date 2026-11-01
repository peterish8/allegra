package com.lyricflow.app.workers

import org.json.JSONObject
import java.io.File

/**
 * What a finished download leaves on disk for JavaScript: the files are written, but the library row is added by
 * JavaScript, which may not be running (Android killed the app while WorkManager finished the download). At the next
 * start JavaScript reads every receipt, adds the rows it lacks, and clears them (`services/downloadReceipts.ts`).
 *
 * [meta] is the song's details as JavaScript handed them to the download (title, artist, …), kept as its JSON text:
 * the worker carries it, it never reads it.
 */
data class DownloadReceipt(
    val id: String,
    val audioUri: String,
    val coverUri: String?,
    val meta: String,
    val finishedAtMs: Long,
) {
    fun encode(): String =
        JSONObject()
            .put("v", VERSION)
            .put("id", id)
            .put("audioUri", audioUri)
            .put("coverUri", coverUri ?: JSONObject.NULL)
            .put("meta", meta)
            .put("finishedAtMs", finishedAtMs)
            .toString()

    companion object {
        const val VERSION = 1
        private const val DIR = "download-receipts"

        /** Null for a file that is not a complete receipt of this version: one cut short by a kill, or nonsense. */
        fun decode(text: String): DownloadReceipt? = try {
            val o = JSONObject(text)
            val id = o.optString("id")
            val audioUri = o.optString("audioUri")
            if (o.optInt("v", -1) != VERSION || id.isEmpty() || audioUri.isEmpty()) {
                null
            } else {
                DownloadReceipt(
                    id = id,
                    audioUri = audioUri,
                    coverUri = if (o.isNull("coverUri")) null else o.optString("coverUri").ifEmpty { null },
                    meta = o.optString("meta", "{}"),
                    finishedAtMs = o.optLong("finishedAtMs", 0L),
                )
            }
        } catch (_: Exception) {
            null
        }

        fun dir(filesDir: File) = File(filesDir, DIR)

        /** One file per song, named from its id with anything but a safe character replaced. */
        fun fileName(id: String) = id.replace(Regex("[^A-Za-z0-9._-]"), "_") + ".json"

        /** Written whole next to its place and renamed over it, so a kill mid-write leaves no half receipt. */
        fun write(dir: File, receipt: DownloadReceipt): Boolean {
            if (!dir.exists() && !dir.mkdirs()) return false
            val target = File(dir, fileName(receipt.id))
            val temp = File(dir, "${target.name}.tmp")
            temp.writeText(receipt.encode())
            if (temp.renameTo(target)) return true
            // Some file systems will not rename over an existing file.
            target.delete()
            return temp.renameTo(target)
        }

        /** Every complete receipt; temporary files and unreadable ones are skipped. */
        fun readAll(dir: File): List<DownloadReceipt> =
            dir.listFiles { file -> file.isFile && file.name.endsWith(".json") }
                .orEmpty()
                .mapNotNull { file -> try { decode(file.readText()) } catch (_: Exception) { null } }

        fun clear(dir: File, id: String): Boolean {
            val file = File(dir, fileName(id))
            return !file.exists() || file.delete()
        }
    }
}
