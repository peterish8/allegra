package com.lyricflow.app.island

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The island add-on's one screen: turn the island on in Android's accessibility settings, and set how it looks.
 * Plain views so the add-on stays small; the switches are IslandPrefs, read by the service with this screen closed.
 */
class IslandSettingsActivity : Activity() {
    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this).apply { isFillViewport = true }
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val side = dp(20)
            setPadding(side, dp(24), side, dp(32))
        }
        scroll.addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(scroll)
        // Edge to edge: keep the content clear of the status and navigation bars.
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
    }

    override fun onResume() {
        super.onResume()
        // Back from Android's accessibility page: the switch may have changed.
        render()
    }

    private fun render() {
        content.removeAllViews()
        val prefs = IslandPrefs(this)
        val installed = appInstalled()

        title("LuvLyrics island")
        body("Your song round the camera, over every app. This is an add-on to LuvLyrics, so the LuvLyrics app itself needs no accessibility access.")

        if (!installed) {
            gap()
            body("LuvLyrics is not installed on this phone. Install it first: the island shows and controls its player.")
            return
        }

        gap()
        val serviceOn = IslandService.isEnabledInSettings(this)
        heading(if (serviceOn) "The island is on" else "Turn the island on")
        if (!serviceOn) {
            body(
                "Android only lets an accessibility service draw above the status bar, so that is how the island gets there. " +
                    "It does not read or record other apps’ screens, and sends no screen data anywhere. " +
                    "Open LuvLyrics island under Installed apps and switch it on.",
            )
            button("Open accessibility settings") { openAccessibility() }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                body("If Android blocks the switch, open App info, tap the three-dot menu, then Allow restricted settings.")
                button("Open app info") { openAppInfo() }
            }
        } else {
            body("It follows the song LuvLyrics plays. Start a song in LuvLyrics and the island appears.")
        }

        gap()
        heading("Look")
        NativeIsland.onThisPhone()?.let { native ->
            body("Your phone has $native. The LuvLyrics island stays off unless you choose to use it anyway.")
            toggle("Use the LuvLyrics island anyway", prefs.allowOnNativeIslandPhones) { prefs.allowOnNativeIslandPhones = it }
        }
        toggle("Show the island", prefs.enabled) { prefs.enabled = it }
        choice(
            "Shape",
            listOf(IslandPrefs.STYLE_PILL to "Pill", IslandPrefs.STYLE_NOTCH to "Notch"),
            prefs.style,
        ) { prefs.style = it }
        slider("Width", prefs.widthPercent, 40, 150) { prefs.widthPercent = it }
        slider("Height", prefs.heightPercent, 85, 130) { prefs.heightPercent = it }
        toggle("Show when nothing is playing", prefs.showWhenIdle) { prefs.showWhenIdle = it }
        toggle("Two lines of lyrics on the card", prefs.showLyricStrip) { prefs.showLyricStrip = it }
        toggle("Show on the lock screen", prefs.showOnLockScreen) { prefs.showOnLockScreen = it }
        toggle("Hide while LuvLyrics is open", prefs.hideInApp) { prefs.hideInApp = it }
    }

    // ── Views ────────────────────────────────────────────────────────────────────────────────────────────────

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun text(text: String, sizeSp: Float, bold: Boolean, color: Int): TextView = TextView(this).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun add(view: View, top: Int = 0) {
        val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        params.topMargin = dp(top)
        content.addView(view, params)
    }

    private fun title(value: String) = add(text(value, 28f, true, Color.WHITE))

    private fun heading(value: String) = add(text(value, 18f, true, Color.WHITE), 8)

    private fun body(value: String) = add(text(value, 14f, false, 0x99FFFFFF.toInt()), 8)

    private fun gap() = add(View(this), 12)

    private fun button(label: String, onTap: () -> Unit) {
        val view = Button(this).apply {
            text = label
            isAllCaps = false
            setOnClickListener { onTap() }
        }
        add(view, 12)
    }

    private fun toggle(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
        val view = Switch(this).apply {
            text = label
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            isChecked = value
            setOnCheckedChangeListener { _, checked ->
                onChange(checked)
                IslandService.refresh()
            }
        }
        add(view, 14)
    }

    private fun slider(label: String, value: Int, min: Int, max: Int, onChange: (Int) -> Unit) {
        val readout = text("$label  $value%", 16f, false, Color.WHITE)
        add(readout, 16)
        val bar = SeekBar(this).apply {
            this.max = (max - min) / 5
            progress = (value.coerceIn(min, max) - min) / 5
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    readout.text = "$label  ${min + progress * 5}%"
                }

                override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit

                // The island is live on screen: resize it on release, not on every step.
                override fun onStopTrackingTouch(seekBar: SeekBar?) {
                    onChange(min + (seekBar?.progress ?: 0) * 5)
                    IslandService.refresh()
                }
            })
        }
        add(bar, 4)
    }

    private fun choice(label: String, options: List<Pair<String, String>>, current: String, onChange: (String) -> Unit) {
        add(text(label, 16f, false, Color.WHITE), 16)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val buttons = ArrayList<Button>()
        fun paint(selected: String) = buttons.forEachIndexed { index, b -> b.alpha = if (options[index].first == selected) 1f else 0.45f }
        options.forEach { (value, name) ->
            val b = Button(this).apply {
                text = name
                isAllCaps = false
                setOnClickListener {
                    onChange(value)
                    paint(value)
                    IslandService.refresh()
                }
            }
            buttons += b
            row.addView(b, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { gravity = Gravity.CENTER })
        }
        paint(current)
        add(row, 4)
    }

    // ── Android's own pages ──────────────────────────────────────────────────────────────────────────────────

    private fun appInstalled(): Boolean = try {
        packageManager.getPackageInfo(IslandPlayerLink.APP_PACKAGE, 0)
        true
    } catch (_: Exception) {
        false
    }

    /** Our row in Android's accessibility settings where the phone can open it, else the accessibility page. */
    private fun openAccessibility() {
        val component = IslandService.component(this).flattenToString()
        val details = Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS").putExtra(Intent.EXTRA_COMPONENT_NAME, component)
        start(details) || start(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    private fun openAppInfo() {
        start(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }

    private fun start(intent: Intent): Boolean = try {
        startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    } catch (_: SecurityException) {
        false
    }
}
