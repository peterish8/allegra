package com.lyricflow.app.island

import android.app.ActivityManager
import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.PowerManager
import android.view.Display

/**
 * How much the island may draw on this phone, read once per screen-on (Battery Saver can change in between).
 *
 * - [LOW]: old or budget phones and Battery Saver. The level bars and the light tick at 20 fps, the light's field
 *   is recomputed at 15 fps, and opening the app grows a plain shape over the cover's colours.
 * - [MID]: a 60 Hz phone with room to spare (a Galaxy M31). 30 fps ticks, the light at 30 fps, the full open-app
 *   morph with the cover melting into its backdrop.
 * - [HIGH]: a 90/120 Hz phone with plenty of memory. Ticks and the light at 60 fps, so motion matches the screen.
 *
 * Springs always run on the display's own frames: what changes per tier is only what is drawn between them.
 */
enum class IslandBudget(val tickMs: Long, val flowFrameMs: Long, val richLaunch: Boolean) {
    LOW(tickMs = 50L, flowFrameMs = 66L, richLaunch = false),
    MID(tickMs = 33L, flowFrameMs = 33L, richLaunch = true),
    HIGH(tickMs = 16L, flowFrameMs = 16L, richLaunch = true);

    companion object {
        /** The rule, kept pure for tests. Memory in MB, refresh rate in Hz (the fastest the screen supports). */
        fun pick(lowRam: Boolean, memMb: Long, cores: Int, api: Int, powerSave: Boolean, refreshHz: Float): IslandBudget = when {
            // Same line as the app's own performance tier (utils/performanceTier.ts), plus Battery Saver.
            lowRam || memMb < 3500 || cores <= 4 || api < Build.VERSION_CODES.Q || powerSave -> LOW
            refreshHz > 65f && memMb >= 5500 -> HIGH
            else -> MID
        }

        fun of(context: Context): IslandBudget = try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val memory = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
            val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            val display = (context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).getDisplay(Display.DEFAULT_DISPLAY)
            val hz = display?.supportedModes?.maxOfOrNull { it.refreshRate } ?: display?.refreshRate ?: 60f
            pick(am.isLowRamDevice, memory.totalMem / (1024L * 1024L), Runtime.getRuntime().availableProcessors(),
                Build.VERSION.SDK_INT, power.isPowerSaveMode, hz)
        } catch (_: Exception) {
            MID
        }
    }
}
