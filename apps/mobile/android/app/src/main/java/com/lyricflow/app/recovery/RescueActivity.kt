package com.lyricflow.app.recovery

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.lyricflow.app.MainActivity
import com.lyricflow.app.workers.AppUpdateWorker
import java.io.File
import java.util.UUID

/**
 * The way out of a build that cannot open. Plain Android views, no React: it works when the JavaScript side does
 * not. It says what happened, which version is installed, and installs the latest build through the same updater
 * as About → Updates (`AppUpdateWorker`: the download checks the package and the signing key, then Android's
 * installer asks the listener). "Open LuvLyrics again" gives the app a fresh set of tries.
 *
 * Opened by `MainActivity` when [LaunchGuard] has counted too many starts that never drew a screen, and by
 * [UiRecovery] when the screen keeps dying.
 */
class RescueActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var updateButton: Button
    private var polling = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = BG
        window.navigationBarColor = BG

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(28), dp(64), dp(28), dp(40))
        }
        column.addView(text("LuvLyrics couldn't open", 26f, Color.WHITE, bold = true))
        column.addView(space(12))
        column.addView(text(
            "The app hit a problem while starting. Your library, playlists and downloads are safe.\n\n" +
                "Install the latest version below, or try opening the app again.",
            16f, SOFT,
        ))
        column.addView(space(20))
        column.addView(text("Installed: ${installedVersion()}", 14f, FAINT))
        column.addView(space(28))

        updateButton = button("Install the latest version", primary = true) { onUpdatePressed() }
        column.addView(updateButton)
        column.addView(space(8))
        status = text("", 14f, SOFT).apply { visibility = View.GONE }
        column.addView(status)
        column.addView(space(12))
        column.addView(button("Open LuvLyrics again", primary = false) { openApp() })

        val details = UiRecovery.peek(this)
        if (details != null) {
            column.addView(space(28))
            column.addView(text("What went wrong", 14f, FAINT, bold = true))
            column.addView(space(6))
            column.addView(text(details.lines().take(6).joinToString("\n"), 12f, FAINT).apply { typeface = Typeface.MONOSPACE })
            column.addView(space(8))
            column.addView(button("Copy details", primary = false) {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("LuvLyrics error", details))
                Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show()
            })
        }

        setContentView(ScrollView(this).apply {
            setBackgroundColor(BG)
            isFillViewport = true
            addView(column)
        })
        // A download started earlier (here or in About) is picked up where it is.
        refresh()
    }

    override fun onResume() {
        super.onResume()
        // Back from Android's "install unknown apps" setting or from the installer.
        refresh()
    }

    override fun onDestroy() {
        polling = false
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    // -- Updating (same work, file and provider as AppUpdaterModule) ----------------------------------------------

    private fun updateFile() = File(filesDir, "updates/LuvLyrics.apk")

    private fun currentWork(): WorkInfo? {
        val id = getSharedPreferences("app-updater", 0).getString("work-id", null) ?: return null
        return try { WorkManager.getInstance(this).getWorkInfoById(UUID.fromString(id)).get() } catch (e: Exception) { null }
    }

    private fun onUpdatePressed() {
        val work = currentWork()
        if (work?.state == WorkInfo.State.SUCCEEDED && updateFile().isFile) {
            install()
            return
        }
        if (work != null && !work.state.isFinished) {
            refresh()
            return
        }
        try {
            val request = OneTimeWorkRequestBuilder<AppUpdateWorker>()
                .setInputData(workDataOf("url" to LATEST_APK_URL))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(this).enqueueUniqueWork("app-update", ExistingWorkPolicy.REPLACE, request)
            getSharedPreferences("app-updater", 0).edit().putString("work-id", request.id.toString()).apply()
        } catch (e: Exception) {
            show("Couldn't start the download: ${e.message}")
            return
        }
        show("Downloading…")
        startPolling()
    }

    private fun install() {
        val file = updateFile()
        if (!file.isFile) {
            show("Download the update first")
            return
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
                show("Allow LuvLyrics to install updates, then come back and tap Install")
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                return
            }
            val uri = FileProvider.getUriForFile(this, "$packageName.updates", file)
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            show("Couldn't open the installer: ${e.message}")
        }
    }

    private fun startPolling() {
        if (polling) return
        polling = true
        main.post(object : Runnable {
            override fun run() {
                if (!polling) return
                if (refresh()) main.postDelayed(this, 500) else polling = false
            }
        })
    }

    /** Shows where the update is. True while a download is still running. */
    private fun refresh(): Boolean {
        val work = currentWork() ?: return false
        return when (work.state) {
            WorkInfo.State.RUNNING, WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> {
                show("Downloading… ${work.progress.getInt("progress", 0)}%")
                updateButton.text = "Downloading…"
                startPolling()
                true
            }
            WorkInfo.State.SUCCEEDED -> {
                if (updateFile().isFile) {
                    show("Downloaded. Tap Install.")
                    updateButton.text = "Install"
                }
                false
            }
            WorkInfo.State.FAILED, WorkInfo.State.CANCELLED -> {
                show(work.outputData.getString("error") ?: "Download stopped. Try again.")
                updateButton.text = "Try the download again"
                false
            }
            else -> false
        }
    }

    private fun openApp() {
        LaunchGuard.reset(this)
        UiRecovery.resetRestarts()
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }

    // -- Views ------------------------------------------------------------------------------------------------------

    private fun installedVersion(): String = try {
        val info = packageManager.getPackageInfo(packageName, 0)
        "LuvLyrics ${info.versionName}"
    } catch (e: Exception) {
        "LuvLyrics"
    }

    private fun show(message: String) {
        status.text = message
        status.visibility = View.VISIBLE
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    private fun space(heightDp: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(heightDp)) }

    private fun text(value: String, sizeSp: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = value
        setTextColor(color)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        setLineSpacing(0f, 1.2f)
    }

    private fun button(label: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = label
        setAllCaps(false)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setTextColor(if (primary) Color.BLACK else Color.WHITE)
        background = GradientDrawable().apply {
            cornerRadius = dp(26).toFloat()
            setColor(if (primary) Color.WHITE else Color.parseColor("#26FFFFFF"))
        }
        gravity = Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52))
        setOnClickListener { onClick() }
    }

    companion object {
        /** The public build the in-app updater reads (src/services/appUpdate.ts LATEST_APK_URL). */
        const val LATEST_APK_URL = "https://github.com/peterish8/allegra/releases/download/apk-latest/LuvLyrics.apk"
        private val BG = Color.parseColor("#0B0B0F")
        private val SOFT = Color.parseColor("#C8FFFFFF")
        private val FAINT = Color.parseColor("#8CFFFFFF")

        fun open(context: Context) {
            context.startActivity(Intent(context, RescueActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        }
    }
}
