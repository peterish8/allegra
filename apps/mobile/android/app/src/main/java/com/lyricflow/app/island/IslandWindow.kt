package com.lyricflow.app.island

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.PixelFormat
import android.graphics.Point
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

    private val keyguard = service.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    private var locked = false
    private val power = service.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshLock()
            applyVisibility()
        }
    }

    val isShowing get() = added && !landscape && !locked && power.isInteractive && touchable

    /** The lock screen has its own media controls: the island waits for the phone to be unlocked. */
    private fun refreshLock() {
        val now = keyguard.isKeyguardLocked
        if (now == locked) return
        locked = now
        applyVisibility()
    }

    fun show(showWhenIdle: Boolean) {
        val existing = view
        if (existing != null) {
            existing.showWhenIdle = showWhenIdle
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

    fun destroy() {
        val v = view ?: return
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
            safeTop.toFloat(), safeLeft.toFloat(), safeRight.toFloat())
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
        val visible = !landscape && !locked && power.isInteractive
        v.screenOn = visible
        if (!visible) v.collapse()
        v.animate().cancel()
        v.animate().alpha(if (visible) 1f else 0f).setDuration(if (visible) 220L else 120L).start()
        updateFlags()
    }

    // ── IslandView.Host ─────────────────────────────────────────────────────────────────────────────────────

    override fun fitWindow(halfWidth: Float, bottom: Float) {
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
        val touchWidth = 2 * ceil(halfWidth).toInt().coerceAtLeast(1)
        val touchX = anchor - touchWidth / 2
        if (touchParams.width != touchWidth || touchParams.height != h || touchParams.x != touchX) {
            touchParams.width = touchWidth
            touchParams.height = h
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

    override fun openApp() {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("lyricflow://player")).apply {
            setPackage(service.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        try {
            service.startActivity(intent)
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
        val hidden = landscape || locked || !power.isInteractive || !touchable
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
