package com.lyricflow.app.modules

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.lyricflow.app.island.IslandLyrics
import com.lyricflow.app.island.IslandPrefs
import com.lyricflow.app.island.IslandService
import com.lyricflow.app.island.NativeIsland
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Settings → Dynamic island. The island itself is native (island/); this only reads and writes its switches
 * and opens the Android pages the listener has to visit. JavaScript re-reads `status()` when the app returns
 * to the foreground, which is when a trip to Android's settings ends.
 */
class DynamicIslandModule : Module() {
    private val context: Context?
        get() = appContext.reactContext

    override fun definition() = ModuleDefinition {
        Name("DynamicIsland")

        Function("status") {
            val ctx = context ?: return@Function null
            val prefs = IslandPrefs(ctx)
            mapOf(
                "serviceEnabled" to IslandService.isEnabledInSettings(ctx),
                "serviceRunning" to IslandService.isRunning,
                "showing" to IslandService.isShowing,
                "enabled" to prefs.enabled,
                "showWhenIdle" to prefs.showWhenIdle,
                "allowOnNativeIsland" to prefs.allowOnNativeIslandPhones,
                "nativeIsland" to NativeIsland.onThisPhone(),
                // Android 13+ blocks accessibility for apps installed outside a store until the listener allows it.
                "restrictedSettings" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU),
            )
        }

        Function("setEnabled") { on: Boolean ->
            context?.let { IslandPrefs(it).enabled = on }
            IslandService.refresh()
        }

        Function("setShowWhenIdle") { on: Boolean ->
            context?.let { IslandPrefs(it).showWhenIdle = on }
            IslandService.refresh()
        }

        Function("setAllowOnNativeIsland") { on: Boolean ->
            context?.let { IslandPrefs(it).allowOnNativeIslandPhones = on }
            IslandService.refresh()
        }

        /** The playing song's timed lines (ms, already shifted by the lyrics delay), shown under the open card. */
        Function("setLyrics") { songId: String, atMs: List<Double>, texts: List<String> ->
            IslandLyrics.set(songId, atMs.map { it.toLong() }, texts)
        }

        Function("clearLyrics") {
            IslandLyrics.clear()
        }

        /** Our row in Android's accessibility settings where the phone can open it, else the accessibility page. */
        Function("openAccessibilitySettings") {
            val ctx = appContext.currentActivity ?: context ?: return@Function false
            val component = IslandService.component(ctx).flattenToString()
            val details = Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS")
                .putExtra(Intent.EXTRA_COMPONENT_NAME, component)
            val page = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            start(ctx, details) || start(ctx, page)
        }

        /** App info, where Android 13+ hides "Allow restricted settings" behind the ⋮ menu. */
        Function("openAppInfo") {
            val ctx = appContext.currentActivity ?: context ?: return@Function false
            start(ctx, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")))
        }
    }

    private fun start(ctx: Context, intent: Intent): Boolean = try {
        if (ctx !is android.app.Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
        true
    } catch (_: Exception) {
        false
    }
}
