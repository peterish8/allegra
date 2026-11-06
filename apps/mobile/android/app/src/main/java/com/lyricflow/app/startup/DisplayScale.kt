package com.lyricflow.app.startup

import android.content.Context
import android.content.res.Resources
import kotlin.math.roundToInt

/**
 * The listener's Display size (Settings → Player → Display size): the whole app drawn a little smaller or larger,
 * text, icons, spacing and the native bars together, like Android's own Display size but for LuvLyrics only.
 *
 * It works on the density the app reads. React Native keeps a reference to the context's DisplayMetrics
 * (DisplayMetricsHolder), and native views convert dp and sp from the same object, so setting density,
 * scaledDensity and densityDpi there before React starts scales everything alike. The system recomputes those
 * fields on a configuration change, so the Application and MainActivity apply it again before passing the change
 * on. The value is computed from the device's own density each time, so applying twice changes nothing.
 */
object DisplayScale {
    private const val PREFS = "luvlyrics_display"
    private const val KEY = "scale"

    /** The sizes offered in Settings, smallest first. Anything else is snapped to the nearest one. */
    val CHOICES = floatArrayOf(0.85f, 0.92f, 1f, 1.08f)
    const val DEFAULT = 1f

    /** The nearest offered size; bad values give the default. */
    fun clamp(scale: Float): Float {
        if (scale.isNaN() || scale.isInfinite() || scale <= 0f) return DEFAULT
        return CHOICES.minByOrNull { kotlin.math.abs(it - scale) } ?: DEFAULT
    }

    /** The density the app uses for a device density and a chosen size. */
    fun scaledDensity(deviceDensity: Float, scale: Float): Float = deviceDensity * clamp(scale)

    /** densityDpi for a device dpi and a chosen size, never below 1. */
    fun scaledDpi(deviceDpi: Int, scale: Float): Int = (deviceDpi * clamp(scale)).roundToInt().coerceAtLeast(1)

    fun read(context: Context): Float =
        clamp(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getFloat(KEY, DEFAULT))

    /** Saves the size; it takes effect when the UI is next built (MainActivity recreates itself for that). */
    fun write(context: Context, scale: Float): Float {
        val value = clamp(scale)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putFloat(KEY, value).commit()
        return value
    }

    /** Sets the app's density on these resources from the device's own density and the saved size. */
    fun apply(context: Context, resources: Resources = context.resources) {
        val scale = read(context)
        val device = Resources.getSystem().displayMetrics
        val metrics = resources.displayMetrics
        val fontScale = resources.configuration.fontScale.takeIf { it > 0f } ?: 1f
        metrics.density = scaledDensity(device.density, scale)
        metrics.densityDpi = scaledDpi(device.densityDpi, scale)
        @Suppress("DEPRECATION")
        metrics.scaledDensity = metrics.density * fontScale
    }
}
