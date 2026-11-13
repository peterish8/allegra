package com.lyricflow.app.addon

import android.content.Context
import android.content.Intent

/**
 * The island is an optional add-on app (apps/island, package `com.lyricflow.island`), not part of this app: this app
 * declares no accessibility service, so Play Protect and Google Pay leave it alone. When the add-on is installed it
 * shows the song this app plays by connecting to this app's media session (PlaybackService), and it steps aside while
 * this app is on screen. This is the other direction: one explicit, data-free broadcast saying whether LuvLyrics is
 * in front. With no add-on installed the broadcast reaches nobody and costs nothing.
 */
object IslandAddon {
    const val PACKAGE = "com.lyricflow.island"
    private const val ACTION = "com.lyricflow.island.APP_STATE"
    private const val EXTRA_FRONT = "front"
    private const val EXTRA_SHOWN = "shown"

    /** LuvLyrics came to the front (true) or left it (false). */
    fun appInFront(context: Context, front: Boolean) = send(context) { putExtra(EXTRA_FRONT, front) }

    /** The screen the island opened has drawn, so its growing overlay can let go. */
    fun appShown(context: Context) = send(context) { putExtra(EXTRA_SHOWN, true) }

    private fun send(context: Context, extras: Intent.() -> Unit) {
        try {
            context.sendBroadcast(Intent(ACTION).setPackage(PACKAGE).apply(extras))
        } catch (_: Exception) {
            // The add-on is not there or refused it: nothing to tell.
        }
    }

    /** Whether the add-on is installed on this phone. */
    fun isInstalled(context: Context): Boolean = try {
        context.packageManager.getPackageInfo(PACKAGE, 0)
        true
    } catch (_: Exception) {
        false
    }
}
