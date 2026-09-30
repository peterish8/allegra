package com.lyricflow.app.workers

import android.content.Context
import android.content.pm.PackageManager
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/** APK updates are separate from music downloads and survive leaving the app. */
class AppUpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val dir = File(applicationContext.filesDir, "updates").apply { mkdirs() }
        val partial = File(dir, "LuvLyrics.apk.part")
        val target = File(dir, "LuvLyrics.apk")
        try {
            val url = inputData.getString("url") ?: error("Missing update URL")
            require(url.startsWith("https://github.com/peterish8/allegra/releases/download/") && url.endsWith(".apk")) { "Invalid update source" }
            val client = OkHttpClient.Builder().connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS).callTimeout(9, TimeUnit.MINUTES).build()
            client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                check(response.isSuccessful) { "Could not download the update (${response.code})" }
                val body = response.body ?: error("Empty download")
                val total = body.contentLength()
                var downloaded = 0L
                var lastProgress = -1
                body.byteStream().use { input -> partial.outputStream().use { output ->
                    val buffer = ByteArray(65536)
                    while (true) {
                        check(!isStopped) { "Download cancelled" }
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        downloaded += count
                        val progress = if (total > 0) ((downloaded * 100 / total).toInt()).coerceIn(0, 100) else 0
                        if (progress != lastProgress) {
                            setProgress(workDataOf("progress" to progress))
                            lastProgress = progress
                        }
                    }
                } }
                check(downloaded > 0 && (total <= 0 || downloaded == total)) { "Incomplete download" }
            }
            // Reject a wrong app or signing key before offering an install.
            @Suppress("DEPRECATION")
            val archive = applicationContext.packageManager.getPackageArchiveInfo(partial.path, PackageManager.GET_SIGNATURES)
                ?: error("The downloaded file is not a valid APK")
            check(archive.packageName == applicationContext.packageName) { "This update belongs to another app" }
            @Suppress("DEPRECATION")
            val installed = applicationContext.packageManager.getPackageInfo(applicationContext.packageName, PackageManager.GET_SIGNATURES)
            @Suppress("DEPRECATION")
            check(archive.signatures?.toSet() == installed.signatures?.toSet() && !archive.signatures.isNullOrEmpty()) { "This update uses a different signing key" }
            check(partial.renameTo(target)) { "Could not save the update" }
            Result.success()
        } catch (e: Exception) {
            partial.delete()
            Result.failure(workDataOf("error" to (e.message ?: "Download failed. Try again.")))
        }
    }
}
