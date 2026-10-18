package com.lyricflow.app.island

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.app.ActivityOptions
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.RectF
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.hardware.display.DisplayManager
import android.net.Uri
import android.os.Build
import android.util.Log
import android.view.Display
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import androidx.core.content.ContextCompat
import kotlin.math.ceil
import kotlin.math.roundToInt

/**
 * The island's window: an accessibility overlay, the one kind of window an app may put above the status bar
 * and take taps in, right at the camera. (A "display over other apps" window sits under the status bar and
 * never gets a tap there.)
 *
 * The drawing surface keeps a fixed horizontal frame on the camera. While closed it passes touches through;
 * a second, transparent window fits the pill and forwards its input. This avoids Android's asynchronous
 * surface move/resize jump at the end of a close without blocking the status shade beside the pill.
 *
 * A third window exists only while the search drawer is open: a real, focusable text field laid exactly over the
 * field the island draws, so the keyboard comes up and types into it. The text itself is invisible there; the
 * island draws what was typed. With "Hide while LuvLyrics is open" on, the island fades away while the app is in
 * front and comes back when the listener leaves it.
 */
class IslandWindow(private val service: AccessibilityService) : IslandView.Host {
    private val wm = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val display: Display? =
        (service.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).getDisplay(Display.DEFAULT_DISPLAY)

    private var view: IslandView? = null
    private var added = false
    private var touchView: View? = null
    private var touchAdded = false
    private var expandedTouch = false
    private var geometry: IslandGeometry? = null
    private var landscape = false
    private var touchable = true
    private var latestInsets: WindowInsets? = null
    private var hideInApp = false
    /** The listener's width and height, as fractions (IslandPrefs). */
    private var sizeScales = 1f to 1f
    /** The notch look (IslandPrefs.style): the island hangs from the top edge. */
    private var hanging = false
    private var appInFront = false
    private var searchField: EditText? = null
    private var searchAdded = false
    private val inputs = service.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    private val displays = service.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(id: Int) = Unit
        override fun onDisplayRemoved(id: Int) = Unit
        override fun onDisplayChanged(id: Int) {
            if (id == Display.DEFAULT_DISPLAY) onConfigurationChanged()
        }
    }

    private val params = WindowManager.LayoutParams().apply {
        type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
        format = PixelFormat.TRANSLUCENT
        flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        gravity = Gravity.TOP or Gravity.START
        width = 1
        height = 1
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            } else {
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Placed by screen pixels: never pushed down below the status bar.
            fitInsetsTypes = 0
        }
        title = "LuvLyrics island"
        windowAnimations = 0
    }
    private val touchParams = WindowManager.LayoutParams().apply {
        copyFrom(params)
        flags = flags and WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH.inv()
        title = "LuvLyrics island touch"
    }
    /** The search field's window: focusable (the keyboard needs it), touchable, nothing else. */
    private val searchParams = WindowManager.LayoutParams().apply {
        copyFrom(params)
        flags = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        softInputMode = WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or
            WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
        title = "LuvLyrics island search"
    }

    private val keyguard = service.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    private var locked = false
    private val power = service.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshLock()
            applyVisibility()
        }
    }

    val isShowing get() = added && !landscape && !hiddenForLock && power.isInteractive && touchable && !hiddenForApp

    /** The listener chose to keep the island on the lock screen (IslandPrefs.showOnLockScreen). */
    private var showOnLock = false

    /** Locked, and the listener did not ask for the island there. */
    private val hiddenForLock get() = locked && !showOnLock

    /** The listener chose to hide the island while LuvLyrics itself is on screen, and it is. */
    private val hiddenForApp get() = hideInApp && appInFront

    /**
     * The lock screen has its own media controls, so by default the island waits for the phone to be unlocked. With
     * "Show on the lock screen" on it stays, limited to playing, skipping, seeking and lyrics (IslandView.locked):
     * nothing of the library or the app opens until the phone is unlocked.
     */
    private fun refreshLock() {
        val now = keyguard.isKeyguardLocked
        view?.locked = now
        if (now == locked) return
        locked = now
        applyVisibility()
    }

    /** Shows the island (or applies changed settings to it) with the listener's choices in [prefs]. */
    fun show(prefs: IslandPrefs) {
        val showWhenIdle = prefs.showWhenIdle
        val showLyricStrip = prefs.showLyricStrip
        hideInApp = prefs.hideInApp
        showOnLock = prefs.showOnLockScreen
        val scales = prefs.widthPercent / 100f to prefs.heightPercent / 100f
        val notch = prefs.style == IslandPrefs.STYLE_NOTCH
        val resized = scales != sizeScales || notch != hanging
        sizeScales = scales
        hanging = notch
        val existing = view
        if (existing != null) {
            existing.showWhenIdle = showWhenIdle
            existing.showLyricStrip = showLyricStrip
            if (resized) measure()
            applyVisibility()
            return
        }
        val v = IslandView(service, this)
        val tap = object : View(service) {
            @SuppressLint("ClickableViewAccessibility")
            override fun onTouchEvent(event: MotionEvent): Boolean {
                val forwarded = MotionEvent.obtain(event)
                forwarded.offsetLocation((touchParams.x - params.x).toFloat(), 0f)
                return try { v.onTouchEvent(forwarded) } finally { forwarded.recycle() }
            }
        }.apply {
            isClickable = true
            isFocusable = true
            contentDescription = "LuvLyrics island. Tap to expand."
            setOnClickListener { v.performClick() }
        }
        v.showWhenIdle = showWhenIdle
        v.showLyricStrip = showLyricStrip
        v.locked = keyguard.isKeyguardLocked
        watchInsets(v)
        view = v
        touchView = tap
        locked = keyguard.isKeyguardLocked
        measure()
        try {
            wm.addView(v, params)
            added = true
            wm.addView(tap, touchParams)
            touchAdded = true
        } catch (e: Exception) {
            // The service is not connected yet, or the system refused the overlay: try again on the next refresh.
            Log.w(TAG, "island window refused: ${e.message}")
            if (added) wm.removeViewImmediate(v)
            added = false
            touchView = null
            view = null
            return
        }
        ContextCompat.registerReceiver(
            service,
            screenReceiver,
            IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_USER_PRESENT)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        locked = keyguard.isKeyguardLocked
        displays.registerDisplayListener(displayListener, android.os.Handler(android.os.Looper.getMainLooper()))
        v.requestApplyInsets()
        applyVisibility()
    }

    /** LuvLyrics came to the front (true) or left it (false). */
    fun setAppInFront(inFront: Boolean) {
        if (appInFront == inFront) return
        appInFront = inFront
        applyVisibility()
    }

    fun destroy() {
        val v = view ?: return
        showSearchInput(null)
        displays.unregisterDisplayListener(displayListener)
        latestInsets = null
        if (touchAdded) touchView?.let {
            try { wm.removeViewImmediate(it) } catch (_: IllegalArgumentException) { /* Already removed by Android. */ }
        }
        touchAdded = false
        touchView = null
        view = null
        try {
            service.unregisterReceiver(screenReceiver)
        } catch (_: IllegalArgumentException) {
            // Never registered (the window was refused).
        }
        if (added) {
            try {
                wm.removeViewImmediate(v)
            } catch (_: Exception) {
                // Already gone with the service.
            }
        }
        added = false
    }

    /** The screen turned, changed size or density: the island is laid out again (and hides in landscape). */
    fun onConfigurationChanged() {
        if (view == null) return
        measure()
        applyVisibility()
    }

    private fun measure() {
        val v = view ?: return
        val size = Point()
        @Suppress("DEPRECATION")
        display?.getRealSize(size)
        val dm = service.resources.displayMetrics
        val screenWidth = (if (size.x > 0) size.x else dm.widthPixels).toFloat()
        val screenHeight = (if (size.y > 0) size.y else dm.heightPixels).toFloat()
        landscape = screenWidth > screenHeight
        // Overlay insets are in the small window's coordinates; using them as screen coordinates
        // moves a centred camera toward the left on every resize. Maximum metrics are display-relative.
        val metrics = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) wm.maximumWindowMetrics else null
        val insets = metrics?.windowInsets ?: latestInsets
        val bounds = metrics?.bounds
        val width = (bounds?.width()?.toFloat() ?: screenWidth)
        val height = (bounds?.height()?.toFloat() ?: screenHeight)
        landscape = width > height
        val displayCutout = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) display?.cutout ?: insets?.displayCutout
            else insets?.displayCutout
        } else null
        val cutout = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            displayCutout?.boundingRects?.filter { it.top < height / 2 && it.width() > 0 }
                ?.minByOrNull { it.top }?.let {
                val pathBounds = android.graphics.RectF()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    displayCutout.cutoutPath?.computeBounds(pathBounds, true)
                }
                // Some ROMs extend the bounding rectangle to y=0 even for a floating hole.
                // The physical path distinguishes that hole from an attached U/waterdrop notch.
                if (!pathBounds.isEmpty && pathBounds.bottom < height / 3f) {
                    CameraCutout(pathBounds.left, pathBounds.top, pathBounds.right, pathBounds.bottom)
                } else {
                    val dx = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) params.x.toFloat() else 0f
                    CameraCutout(it.left + dx, it.top.toFloat(), it.right + dx, it.bottom.toFloat())
                }
            }
        } else {
            null
        }
        val bars = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            insets?.getInsetsIgnoringVisibility(WindowInsets.Type.statusBars())?.top ?: statusBarHeight()
        } else statusBarHeight()
        val safeTop = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) displayCutout?.safeInsetTop ?: 0 else 0
        val safeLeft = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) displayCutout?.safeInsetLeft ?: 0 else 0
        val safeRight = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) displayCutout?.safeInsetRight ?: 0 else 0
        val g = IslandGeometry.compute(width, bars.toFloat(), dm.density, cutout,
            safeTop.toFloat(), safeLeft.toFloat(), safeRight.toFloat(), height, sizeScales.first, sizeScales.second, hanging)
        if (geometry == g) return
        geometry = g
        if (com.lyricflow.app.BuildConfig.DEBUG) Log.d(TAG, "geometry=$g display=${width}x$height cutout=$cutout")
        v.geometry = g
    }

    @SuppressLint("DiscouragedApi", "InternalInsetResource")
    private fun statusBarHeight(): Int {
        val id = service.resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) service.resources.getDimensionPixelSize(id) else (24 * service.resources.displayMetrics.density).roundToInt()
    }

    private fun watchInsets(v: IslandView) {
        v.setOnApplyWindowInsetsListener { _, insets ->
            latestInsets = insets
            measure()
            // An accessibility window reports its own bar visibility, not the app underneath.
            // Using that flag hides the island even on the launcher on some Android versions.
            insets
        }
    }

    private fun applyVisibility() {
        val v = view ?: return
        val visible = !landscape && !hiddenForLock && power.isInteractive && !hiddenForApp
        v.screenOn = visible
        if (!visible) v.collapse()
        v.animate().cancel()
        v.animate().alpha(if (visible) 1f else 0f).setDuration(if (visible) 220L else 120L).start()
        updateFlags()
    }

    // ── IslandView.Host ─────────────────────────────────────────────────────────────────────────────────────

    override fun fitWindow(halfWidth: Float, bottom: Float, restHalf: Float, restBottom: Float) {
        val g = geometry ?: return
        val anchor = g.anchorX.roundToInt()
        // Never resize horizontally during a morph. Android moves the Surface before its new buffer
        // arrives, which otherwise makes the final closing frame jump sideways.
        val w = 2 * ceil((g.cardWidth / 2f + g.dp(6f)) * 1.05f).toInt().coerceAtLeast(1)
        val h = ceil(bottom).toInt().coerceAtLeast(1)
        val x = anchor - w / 2
        if (params.width != w || params.height != h || params.x != x) {
            params.width = w
            params.height = h
            params.x = x
            params.y = 0
            update()
        }
        // The closed island's tap window: the pill it is becoming, never the card it was.
        val touchWidth = 2 * ceil(restHalf).toInt().coerceAtLeast(1)
        val touchHeight = ceil(restBottom).toInt().coerceAtLeast(1)
        val touchX = anchor - touchWidth / 2
        if (touchParams.width != touchWidth || touchParams.height != touchHeight || touchParams.x != touchX) {
            touchParams.width = touchWidth
            touchParams.height = touchHeight
            touchParams.x = touchX
            updateTouch()
        }
    }

    override fun setTouchable(touchable: Boolean) {
        touchView?.contentDescription = "${view?.contentDescription ?: "LuvLyrics island"}. Tap to expand."
        if (this.touchable == touchable) return
        this.touchable = touchable
        updateFlags()
    }

    override fun setExpandedTouch(expanded: Boolean) {
        if (expandedTouch == expanded) return
        expandedTouch = expanded
        updateFlags()
    }

    /**
     * Opens the app at [link]. With the island's outline [from], the app's window grows out of the island: the
     * system compositor runs that animation, so it stays smooth on an older phone (nothing in this process draws
     * during it), while the island folds back to its pill on its own spring.
     */
    override fun openApp(link: String, from: RectF?) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link)).apply {
            setPackage(service.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val v = view
        val reveal = if (from != null && v != null && v.isAttachedToWindow && !from.isEmpty) {
            try {
                ActivityOptions.makeScaleUpAnimation(v, from.left.roundToInt(), from.top.roundToInt(),
                    from.width().roundToInt().coerceAtLeast(1), from.height().roundToInt().coerceAtLeast(1)).toBundle()
            } catch (_: Exception) {
                null
            }
        } else null
        try {
            service.startActivity(intent, reveal)
        } catch (_: Exception) {
            service.packageManager.getLaunchIntentForPackage(service.packageName)?.let {
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try {
                    service.startActivity(it)
                } catch (_: Exception) {
                    // Nothing to open.
                }
            }
        }
    }

    private fun updateFlags() {
        val hidden = landscape || hiddenForLock || !power.isInteractive || !touchable
        val flags = if (hidden || !expandedTouch) {
            params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        } else {
            params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
        }
        if (flags != params.flags) {
            params.flags = flags
            update()
        }
        val tapFlags = if (hidden || expandedTouch) {
            touchParams.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        } else touchParams.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
        if (tapFlags != touchParams.flags) {
            touchParams.flags = tapFlags
            updateTouch()
        }
        view?.importantForAccessibility = if (!hidden && expandedTouch) View.IMPORTANT_FOR_ACCESSIBILITY_YES else View.IMPORTANT_FOR_ACCESSIBILITY_NO
        touchView?.importantForAccessibility = if (!hidden && !expandedTouch) View.IMPORTANT_FOR_ACCESSIBILITY_YES else View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    override fun showSearchInput(field: RectF?) {
        val v = view ?: return
        if (field == null) {
            val edit = searchField ?: return
            inputs.hideSoftInputFromWindow(edit.windowToken, 0)
            if (searchAdded) {
                try { wm.removeViewImmediate(edit) } catch (_: Exception) { /* Gone with the service. */ }
            }
            searchAdded = false
            searchField = null
            v.setSearchText("")
            return
        }
        val edit = searchField ?: EditText(service).apply {
            // Invisible: the island draws the text, caret and hint itself, so the field and the drawing never drift.
            background = null
            setTextColor(android.graphics.Color.TRANSPARENT)
            setHintTextColor(android.graphics.Color.TRANSPARENT)
            isCursorVisible = false
            setSingleLine()
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
            imeOptions = EditorInfo.IME_ACTION_SEARCH or EditorInfo.IME_FLAG_NO_EXTRACT_UI
            contentDescription = "Search songs"
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(s: Editable?) = v.setSearchText(s?.toString().orEmpty())
            })
            setOnEditorActionListener { _, action, _ ->
                if (action == EditorInfo.IME_ACTION_SEARCH) inputs.hideSoftInputFromWindow(windowToken, 0)
                action == EditorInfo.IME_ACTION_SEARCH
            }
        }.also { searchField = it }
        searchParams.x = params.x + field.left.roundToInt()
        searchParams.y = field.top.roundToInt()
        searchParams.width = field.width().roundToInt().coerceAtLeast(1)
        searchParams.height = field.height().roundToInt().coerceAtLeast(1)
        try {
            if (searchAdded) wm.updateViewLayout(edit, searchParams) else wm.addView(edit, searchParams)
            searchAdded = true
        } catch (e: Exception) {
            Log.w(TAG, "island search field refused: ${e.message}")
            return
        }
        edit.requestFocus()
        // The keyboard comes up once the field's window has focus.
        edit.post { inputs.showSoftInput(edit, InputMethodManager.SHOW_IMPLICIT) }
    }

    private fun updateTouch() {
        val tap = touchView ?: return
        if (!touchAdded) return
        try { wm.updateViewLayout(tap, touchParams) }
        catch (e: Exception) { Log.w(TAG, "island touch window update failed: ${e.message}") }
    }

    private fun update() {
        val v = view ?: return
        if (!added) return
        try {
            wm.updateViewLayout(v, params)
        } catch (e: Exception) {
            Log.w(TAG, "island window update failed: ${e.message}")
        }
    }

    private companion object {
        const val TAG = "LyrFlowIsland"
    }
}
