package com.lyricflow.app.island

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * LuvLyrics (a separate app) tells the island about its own screen, with an explicit broadcast
 * (`com.lyricflow.app.addon.IslandAddon`): `front` while LuvLyrics is on screen, so the island can step aside
 * (IslandPrefs.hideInApp), and `shown` once the screen the island opened has drawn, so the growing overlay lets go.
 * It carries no data beyond those two flags.
 */
class IslandAppStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action != ACTION) return
        if (intent.hasExtra(EXTRA_FRONT)) IslandService.setAppInFront(intent.getBooleanExtra(EXTRA_FRONT, false))
        if (intent.getBooleanExtra(EXTRA_SHOWN, false)) IslandService.appShown()
    }

    companion object {
        const val ACTION = "com.lyricflow.island.APP_STATE"
        const val EXTRA_FRONT = "front"
        const val EXTRA_SHOWN = "shown"
    }
}
