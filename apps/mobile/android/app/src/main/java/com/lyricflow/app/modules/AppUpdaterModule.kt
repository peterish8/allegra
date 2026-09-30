package com.lyricflow.app.modules

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.work.*
import com.lyricflow.app.workers.AppUpdateWorker
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

class AppUpdaterModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("AppUpdater")
        AsyncFunction("download") { url: String ->
            val context = appContext.reactContext ?: error("App is unavailable")
            val manager = WorkManager.getInstance(context)
            val prefs = context.getSharedPreferences("app-updater", 0)
            val previousId = prefs.getString("work-id", null)
            val previous = previousId?.let { manager.getWorkInfoById(UUID.fromString(it)).get() }
            if (previous != null && !previous.state.isFinished) return@AsyncFunction
            val work = OneTimeWorkRequestBuilder<AppUpdateWorker>()
                .setInputData(workDataOf("url" to url))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            manager.enqueueUniqueWork("app-update", ExistingWorkPolicy.REPLACE, work).result.get()
            prefs.edit().putString("work-id", work.id.toString()).apply()
        }
        AsyncFunction("status") {
            val context = appContext.reactContext ?: error("App is unavailable")
            val id = context.getSharedPreferences("app-updater", 0).getString("work-id", null)
            val work = id?.let { WorkManager.getInstance(context).getWorkInfoById(UUID.fromString(it)).get() }
            val file = File(context.filesDir, "updates/LuvLyrics.apk")
            // After a successful app update, discard the APK so the next update can be checked.
            val installedAt = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
            if (work?.state == WorkInfo.State.SUCCEEDED && file.exists() && file.lastModified() <= installedAt) file.delete()
            val state = when (work?.state) {
                WorkInfo.State.RUNNING, WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> "downloading"
                WorkInfo.State.SUCCEEDED -> if (file.exists()) "ready" else "idle"
                WorkInfo.State.FAILED, WorkInfo.State.CANCELLED -> "error"
                else -> "idle"
            }
            mapOf("kind" to state, "progress" to (work?.progress?.getInt("progress", 0) ?: 0),
                "message" to (work?.outputData?.getString("error") ?: "Download stopped. Try again."))
        }
        Function("canInstall") {
            val context = appContext.reactContext ?: error("App is unavailable")
            Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()
        }
        AsyncFunction("install") {
            val context = appContext.reactContext ?: error("App is unavailable")
            val file = File(context.filesDir, "updates/LuvLyrics.apk")
            check(file.isFile) { "Download the update first" }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
                context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                "permission"
            } else {
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
                context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
                "installer"
            }
        }
    }
}
