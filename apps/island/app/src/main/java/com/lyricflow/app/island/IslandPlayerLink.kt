package com.lyricflow.app.island

import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture

/**
 * The island is its own app now, so it no longer shares a process with the player. It drives the LuvLyrics app's
 * player through a Media3 `MediaController` on the app's media session (`PlaybackService`): the controller is a
 * `Player`, which is what the island's views already listen to and command (IslandPlayback).
 *
 * The link is made while the island is wanted and remade a little later when LuvLyrics goes away (swiped from
 * recents, updated, killed), so the island comes back by itself when the app plays again. The app only lets this
 * add-on connect when it carries the same signature (PlaybackService's session callback).
 */
object IslandPlayerLink {
    /** The LuvLyrics app this add-on belongs to. */
    const val APP_PACKAGE = "com.lyricflow.app"
    private const val SESSION_SERVICE = "com.lyricflow.app.services.PlaybackService"
    private const val RETRY_MS = 5_000L
    private const val MAX_RETRY_MS = 60_000L

    private val main = Handler(Looper.getMainLooper())
    private var future: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var appContext: Context? = null
    private var wanted = false
    private var retryDelay = RETRY_MS
    private val retry = Runnable { connectNow() }

    /** Starts keeping the link up. Call on the main thread; calling again changes nothing. */
    fun connect(context: Context) {
        appContext = context.applicationContext
        wanted = true
        if (future == null) connectNow()
    }

    /** Lets the link go and stops retrying. */
    fun disconnect() {
        wanted = false
        main.removeCallbacks(retry)
        drop()
    }

    private fun connectNow() {
        val context = appContext ?: return
        if (!wanted || future != null) return
        val token = SessionToken(context, ComponentName(APP_PACKAGE, SESSION_SERVICE))
        val pending = MediaController.Builder(context, token)
            .setListener(object : MediaController.Listener {
                override fun onDisconnected(controller: MediaController) {
                    // The app's player is gone: hide what it drove, then look again later.
                    main.post { lost(controller) }
                }
            })
            .buildAsync()
        future = pending
        pending.addListener({
            if (future !== pending) return@addListener
            try {
                val connected = pending.get()
                controller = connected
                retryDelay = RETRY_MS
                IslandPlayback.attach(connected)
            } catch (_: Exception) {
                // The app is not installed, not running, or refused the link: try again later.
                future = null
                scheduleRetry()
            }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun lost(gone: MediaController) {
        if (controller !== gone) return
        drop()
        scheduleRetry()
    }

    private fun drop() {
        controller?.let { IslandPlayback.detach(it) }
        controller = null
        future?.let { MediaController.releaseFuture(it) }
        future = null
    }

    private fun scheduleRetry() {
        if (!wanted) return
        main.removeCallbacks(retry)
        main.postDelayed(retry, retryDelay)
        retryDelay = (retryDelay * 2).coerceAtMost(MAX_RETRY_MS)
    }
}
