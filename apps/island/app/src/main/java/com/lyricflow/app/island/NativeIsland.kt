package com.lyricflow.app.island

import android.annotation.SuppressLint
import android.os.Build

/**
 * Whether the phone's own system already draws an island round the camera, so ours stays out of its way.
 *
 * Read from the ROM's version properties. These are heuristics, so the listener can still choose
 * LuvLyrics' island in Settings (`IslandPrefs.allowOnNativeIslandPhones`). Samsung's Now Bar and
 * Android 16's live-update chips are not islands at the camera, so Samsung and Pixel phones get ours.
 */
object NativeIsland {

    /** The system feature's name, or null when the phone has none. [prop] reads a system property ("" when unset). */
    fun detect(prop: (String) -> String, brand: String, display: String): String? {
        val b = brand.lowercase()
        // Xiaomi, Redmi, POCO: HyperOS 3 brought the Super Island.
        majorOf(prop("ro.mi.os.version.code"))?.let { if (it >= 3) return "Xiaomi's Super Island" }
        // OPPO, OnePlus, realme: ColorOS 15 / OxygenOS 15 / realme UI 6 show live alerts at the camera.
        majorOf(prop("ro.build.version.oplusrom").ifEmpty { prop("ro.build.version.opporom") })?.let {
            if (it >= 15) return if (b == "oppo") "OPPO's Fluid Cloud" else "Live Alerts"
        }
        // vivo, iQOO: OriginOS 5 brought the Origin (Atomic) Island; Funtouch OS has none.
        if (prop("ro.vivo.os.name").contains("origin", ignoreCase = true)) {
            majorOf(prop("ro.vivo.os.version"))?.let { if (it >= 5) return "vivo's Origin Island" }
        }
        // Honor: MagicOS 8 brought the Magic Capsule ("MagicOS_8.0.0").
        majorOf(prop("ro.build.version.magic"))?.let { if (it >= 8) return "Honor's Magic Capsule" }
        // Huawei: HarmonyOS 4 shows live windows at the camera.
        majorOf(prop("hw_sc.build.platform.version"))?.let { if (b == "huawei" && it >= 4) return "Huawei's Live Window" }
        // Meizu: Flyme 11 brought the Smart Island.
        Regex("flyme[^0-9]*(\\d+)", RegexOption.IGNORE_CASE).find(display)?.groupValues?.get(1)?.toIntOrNull()?.let {
            if (it >= 11) return "Meizu's Smart Island"
        }
        return null
    }

    /** The first number in a version string ("V15.0.0" → 15, "MagicOS_8.0.0" → 8, "3" → 3), or null. */
    fun majorOf(version: String): Int? =
        Regex("(\\d+)").find(version)?.groupValues?.get(1)?.toIntOrNull()

    /** The phone this runs on. */
    fun onThisPhone(): String? = detect(::systemProperty, Build.BRAND ?: "", Build.DISPLAY ?: "")

    /** `android.os.SystemProperties.get`, which apps may read; "" when unset or unreadable. */
    @SuppressLint("PrivateApi")
    private fun systemProperty(key: String): String = try {
        val get = Class.forName("android.os.SystemProperties").getMethod("get", String::class.java)
        (get.invoke(null, key) as? String).orEmpty()
    } catch (_: Throwable) {
        ""
    }
}
