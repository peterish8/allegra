package com.lyricflow.app.modules

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.ReactContext
import com.lyricflow.app.island.IslandLibrary
import com.lyricflow.app.island.IslandLyrics
import com.lyricflow.app.island.IslandPrefs
import com.lyricflow.app.island.IslandService
import com.lyricflow.app.island.NativeIsland
import com.lyricflow.app.island.OutsideMedia
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

        // A song picked in the island, and what is typed in its search drawer: JavaScript plays and searches.
        // "Play here" tapped on a song another app plays: JavaScript finds it and starts it at the same moment.
        Events("onIslandPick", "onIslandSearch", "onIslandTakeOver")

        OnStartObserving {
            IslandLibrary.onPick = pick
            IslandLibrary.onSearch = search
            IslandLibrary.onWake = wake
            OutsideMedia.onTakeOver = takeOver
        }

        // Only this instance's own: after a reload, the old instance stopping must not cut off the new one.
        OnStopObserving { letGo() }
        OnDestroy { letGo() }

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
                "hideInApp" to prefs.hideInApp,
                "showLyricStrip" to prefs.showLyricStrip,
                "showOnLockScreen" to prefs.showOnLockScreen,
                "style" to prefs.style,
                "widthPercent" to prefs.widthPercent,
                "heightPercent" to prefs.heightPercent,
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

        /** The island's width and height in percent of its own size; the island resizes at once. */
        Function("setSize") { widthPercent: Int, heightPercent: Int ->
            context?.let {
                val prefs = IslandPrefs(it)
                prefs.widthPercent = widthPercent.coerceIn(80, 150)
                prefs.heightPercent = heightPercent.coerceIn(85, 130)
            }
            IslandService.refresh()
        }

        /** "pill" (floating below the top edge) or "notch" (hanging from it). */
        Function("setStyle") { style: String ->
            context?.let { IslandPrefs(it).style = style }
            IslandService.refresh()
        }

        Function("setShowOnLockScreen") { on: Boolean ->
            context?.let { IslandPrefs(it).showOnLockScreen = on }
            IslandService.refresh()
        }

        Function("setShowLyricStrip") { on: Boolean ->
            context?.let { IslandPrefs(it).showLyricStrip = on }
            IslandService.refresh()
        }

        Function("setHideInApp") { on: Boolean ->
            context?.let { IslandPrefs(it).hideInApp = on }
            IslandService.refresh()
        }

        /** The playlists with their songs, as JSON (`IslandLibrary.parse`), whenever they change. */
        Function("setPlaylists") { json: String ->
            IslandLibrary.set(json)
        }

        /** The downloaded songs, as JSON (`IslandLibrary.parseSongs`), for the island's offline list. */
        Function("setDownloads") { json: String ->
            IslandLibrary.setDownloads(json)
        }

        /**
         * The answers to a search typed in the island, as they are found; [done] false while more may come.
         * Answers to an older query are dropped.
         */
        Function("setSearchResults") { query: String, json: String, done: Boolean? ->
            IslandLibrary.setSearchResults(query, json, done ?: true)
        }

        /** The playing song's timed lines (ms, already shifted by the lyrics delay), shown under the open card. */
        Function("setLyrics") { songId: String, atMs: List<Double>, texts: List<String> ->
            IslandLyrics.set(songId, atMs.map { it.toLong() }, texts)
        }

        Function("clearLyrics") {
            IslandLyrics.clear()
        }

        Function("setLyricsTiming") { songId: String, json: String ->
            IslandLyrics.setTiming(songId, json)
        }

        /** Now Playing, opened from the island, is on screen: the island's growing overlay fades off it. */
        Function("appShown") {
            IslandService.appShown()
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

        /** "Play here": the listener's switch, and whether Android has our notification listener on. */
        Function("takeOverStatus") {
            val ctx = context ?: return@Function mapOf("enabled" to false, "listenerEnabled" to false)
            mapOf(
                "enabled" to IslandPrefs(ctx).takeOver,
                "listenerEnabled" to OutsideMedia.isListenerEnabled(ctx),
            )
        }

        Function("setTakeOverEnabled") { on: Boolean ->
            val ctx = context ?: return@Function false
            IslandPrefs(ctx).takeOver = on
            IslandService.refresh()
            true
        }

        /** Our row in Android's notification access where the phone can open it (API 30+), else the list page. */
        Function("openTakeOverSettings") {
            val ctx = appContext.currentActivity ?: context ?: return@Function false
            val details = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                    .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, OutsideMedia.component(ctx).flattenToString())
            } else null
            val page = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            (details != null && start(ctx, details)) || start(ctx, page)
        }

        /** That app's live position in seconds right now, or null if its session is gone. */
        Function("outsideNow") { packageName: String ->
            OutsideMedia.now(packageName)?.let { (positionS, playing) ->
                mapOf("positionS" to positionS, "playing" to playing)
            }
        }

        Function("pauseOutside") { packageName: String ->
            OutsideMedia.pause(packageName)
        }

        /** JavaScript is done with a take-over: the island leaves "Finding…" and shows [message] for a moment. */
        Function("takeOverDone") { ok: Boolean, message: String ->
            OutsideMedia.finish(ok, message)
            true
        }

        /** The island opens its search drawer with [query] typed in. */
        Function("showTakeOverSearch") { query: String ->
            OutsideMedia.showSearch(query)
        }

        /** App info, where Android 13+ hides "Allow restricted settings" behind the ⋮ menu. */
        Function("openAppInfo") {
            val ctx = appContext.currentActivity ?: context ?: return@Function false
            start(ctx, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")))
        }
    }

    // Picks, searches and song changes arrive while LuvLyrics is behind another app, where JavaScript's timers are
    // held: each keeps them running while it is answered (IslandJsAwake).
    private val wake: () -> Unit = { IslandJsAwake.hold(context as? ReactContext) }
    private val pick: (String, String) -> Unit = { playlistId, songId ->
        wake()
        sendEvent("onIslandPick", mapOf("playlistId" to playlistId, "songId" to songId))
    }
    private val search: (String) -> Unit = { query ->
        wake()
        sendEvent("onIslandSearch", mapOf("query" to query))
    }

    private val takeOver: (OutsideMedia.TakeOver) -> Unit = { tap ->
        wake()
        val song = tap.song
        sendEvent("onIslandTakeOver", mapOf(
            "packageName" to song.packageName,
            "appLabel" to song.appLabel,
            "title" to song.title,
            "artist" to song.artist,
            "album" to song.album,
            "durationS" to song.durationMs.coerceAtLeast(0L) / 1000.0,
            "positionS" to tap.positionS,
            "playing" to tap.playing,
        ))
    }

    private fun letGo() {
        if (OutsideMedia.onTakeOver === takeOver) OutsideMedia.onTakeOver = null
        if (IslandLibrary.onPick === pick) IslandLibrary.onPick = null
        if (IslandLibrary.onSearch === search) IslandLibrary.onSearch = null
        if (IslandLibrary.onWake === wake) IslandLibrary.onWake = null
    }

    private fun start(ctx: Context, intent: Intent): Boolean = try {
        if (ctx !is android.app.Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
        true
    } catch (_: Exception) {
        false
    }
}
