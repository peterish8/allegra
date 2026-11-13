package com.lyricflow.app.modules

import androidx.work.*
import com.lyricflow.app.saf.SafLibrary
import com.lyricflow.app.workers.DownloadReceipt
import com.lyricflow.app.workers.DownloadWorker
import com.lyricflow.app.workers.ProgressBus
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.filter

class DownloaderModule : Module() {
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    override fun definition() = ModuleDefinition {
        Name("Downloader")

        Events("onDownloadProgress")

        // [meta]: the song's details as JSON, carried into the download's receipt (DownloadReceipt).
        AsyncFunction("enqueue") { id: String, audioUrl: String, coverUrl: String?, songDir: String, lyrics: String?, safDir: String?, meta: String? ->
            val context = appContext.reactContext ?: throw Exception("React context not available")
            val workManager = WorkManager.getInstance(context)

            val inputData = workDataOf(
                "id" to id,
                "audioUrl" to audioUrl,
                "coverUrl" to coverUrl,
                "songDir" to songDir,
                "lyrics" to lyrics,
                "safDir" to safDir,
                "meta" to meta
            )

            val workRequest = OneTimeWorkRequestBuilder<DownloadWorker>()
                .setInputData(inputData)
                .addTag(id)
                .build()

            workManager.enqueueUniqueWork(id, ExistingWorkPolicy.REPLACE, workRequest)

            // ProgressBus delivers real-time updates directly from the worker thread,
            // bypassing WorkManager's database-backed flow which batches/coalesces updates.
            scope.launch {
                ProgressBus.events
                    .filter { it.id == id }
                    .collect { event ->
                        sendEvent("onDownloadProgress", mapOf(
                            "id" to event.id,
                            "progress" to event.progress,
                            "status" to event.status,
                            "audioUri" to event.audioUri,
                            "coverUri" to event.coverUri,
                            "error" to event.error
                        ))
                        if (event.status == "succeeded" || event.status == "failed" || event.status == "cancelled") {
                            this.cancel()
                        }
                    }
            }

            workRequest.id.toString()
        }

        Function("cancel") { id: String ->
            val context = appContext.reactContext ?: return@Function
            WorkManager.getInstance(context).cancelUniqueWork(id)
        }

        /** Every finished download's receipt (DownloadReceipt), as its JSON text. */
        Function("pendingReceipts") {
            val context = appContext.reactContext ?: return@Function emptyList<String>()
            DownloadReceipt.readAll(DownloadReceipt.dir(context.filesDir)).map { it.encode() }
        }

        /** The song's row is in the library: its receipt is done with. */
        Function("clearReceipt") { id: String ->
            val context = appContext.reactContext ?: return@Function false
            DownloadReceipt.clear(DownloadReceipt.dir(context.filesDir), id)
        }

        // The listener's downloads folder (services/folder/): one tree they granted, All songs/ and Playlists/<name>/ inside.

        /** Writes one file into the folder: the bytes of [sourceUri], or [text]. Returns the new document's uri. */
        AsyncFunction("exportToFolder") { treeUri: String, path: List<String>, name: String, mime: String, sourceUri: String?, text: String? ->
            val context = appContext.reactContext ?: throw Exception("React context not available")
            SafLibrary.write(context, treeUri, path, name, mime, sourceUri, text)
        }

        /** What a folder holds: name, uri and whether it is itself a folder. Empty when it does not exist. */
        AsyncFunction("listFolder") { treeUri: String, path: List<String> ->
            val context = appContext.reactContext ?: throw Exception("React context not available")
            SafLibrary.list(context, treeUri, path).map {
                mapOf("name" to it.name, "uri" to it.uri, "isDirectory" to it.isDirectory)
            }
        }

        /** Whether the app still holds write access to the chosen folder (uninstalling drops it). */
        Function("folderWritable") { treeUri: String ->
            val context = appContext.reactContext ?: return@Function false
            SafLibrary.canWrite(context, treeUri)
        }
    }
}
