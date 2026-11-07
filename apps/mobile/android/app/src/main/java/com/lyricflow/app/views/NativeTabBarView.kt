package com.lyricflow.app.views

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import androidx.core.graphics.ColorUtils
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt

/** Native Android rendering for Allegra's custom Stream/Luvs/Library/More navigation chrome. */
class NativeTabBarView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onTabPress by EventDispatcher<Map<String, Any>>()
    private val onMorePress by EventDispatcher<Map<String, Any>>()
    /** A V6 tab held for [HOLD_MS] (Settings → Hold Library for 2 seconds); the tap that ends the hold is swallowed. */
    private val onTabLongPress by EventDispatcher<Map<String, Any>>()
    /** The one V6 route that answers a hold, or null (nothing to open, so a hold stays an ordinary tap). */
    private var holdTab: String? = null
    private var heldIndex = -1
    private val holdRunnables = arrayOfNulls<Runnable>(5)
    private val tabs = listOf("Stream", "Luvs", "Library")
    private val v6Tabs = listOf("Stream", "Luvs", "Library", "Search", "You")
    private val slotViews = ArrayList<View>(5)
    private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    // Labels in medium weight, not bold: they name the icon above them, they don't compete with it.
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }
    private val glyphPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        textAlign = Paint.Align.CENTER
        textSize = GLYPH_SIZE
        typeface = ionicons(context)
    }
    private val bounds = RectF()
    private var variant = "modern-pill"
    private var activeTab = "Stream"
    private var moreActive = false
    private var moreOpen = false
    private var micEnabled = true
    private var dark = true
    private var glassBackground = false
    private var bottomInset = 0f
    private var bottomOffset = 0f
    private var activeTint = Color.WHITE
    private var inactiveTint = ColorUtils.setAlphaComponent(Color.WHITE, 115)
    private var moreMorph = 0f
    private val lift = FloatArray(5)
    private val pressed = FloatArray(5)
    private val animators = arrayOfNulls<ValueAnimator>(5)
    private var moreAnimator: ValueAnimator? = null

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setWillNotDraw(false)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        repeat(5) { index ->
            val slot = View(context).apply {
                isClickable = true
                isFocusable = true
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
                contentDescription = if (index >= 3) "More" else tabs[index]
                ViewCompat.setAccessibilityDelegate(this, object : AccessibilityDelegateCompat() {
                    override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
                        super.onInitializeAccessibilityNodeInfo(host, info)
                        info.className = "android.widget.Button"
                        info.isSelected = host.isSelected
                        // 1.41.3: TalkBack says "Library, Tab, selected", not "Button", for the navigation tabs.
                        if (variant == "v6") info.roleDescription = "Tab"
                        // TalkBack's double tap performs ACTION_CLICK; say so outright.
                        info.isClickable = true
                        info.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_CLICK)
                        if (index == 3 && variant != "v6") info.addAction(
                            if (moreOpen) AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_COLLAPSE
                            else AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_EXPAND,
                        )
                        // TalkBack's double-tap-and-hold reaches the same shortcut as a 2 s hold.
                        if (holdsAt(index)) info.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat(
                            AccessibilityNodeInfoCompat.ACTION_LONG_CLICK, "Open your shortcut playlist"))
                    }

                    override fun performAccessibilityAction(host: View, action: Int, args: android.os.Bundle?): Boolean {
                        if (action == AccessibilityNodeInfoCompat.ACTION_LONG_CLICK && holdsAt(index)) {
                            onTabLongPress(mapOf("route" to v6Tabs[index]))
                            return true
                        }
                        return super.performAccessibilityAction(host, action, args)
                    }
                })
                setOnClickListener {
                    // The finger that held the tab for the shortcut lifts here: that is not also a tap.
                    if (heldIndex == index) { heldIndex = -1; return@setOnClickListener }
                    activate(index)
                }
                // A keyboard or D-pad focus ring is drawn by the bar itself (drawV6); touch never focuses a slot.
                setOnFocusChangeListener { _, _ -> this@NativeTabBarView.invalidate() }
                setOnTouchListener { _, event ->
                    when (event.actionMasked) {
                        android.view.MotionEvent.ACTION_DOWN -> {
                            animatePress(index, true)
                            heldIndex = -1
                            if (holdsAt(index)) armHold(index)
                        }
                        android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> {
                            animatePress(index, false)
                            disarmHold(index)
                            // A cancelled hold (the finger slid off) never fires a click, so nothing is left to swallow.
                            if (event.actionMasked == android.view.MotionEvent.ACTION_CANCEL) heldIndex = -1
                        }
                    }
                    false
                }
            }
            slotViews += slot
            addView(slot, FrameLayout.LayoutParams(0, 0, Gravity.TOP or Gravity.START))
        }
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: android.graphics.Outline) {
                if (variant == "modern-pill") {
                    outline.setRoundRect(0, 0, view.width, view.height, dp(32f))
                } else {
                    outline.setRect(0, 0, view.width, view.height)
                }
            }
        }
        clipToOutline = false
    }

    fun setVariant(value: String?) {
        val next = when (value) { "v6" -> "v6"; "classic" -> "classic"; else -> "modern-pill" }
        if (variant == next) return
        variant = next
        elevation = dp(if (variant == "modern-pill") 16f else 0f)
        syncSelection()
        requestLayout(); invalidate()
    }

    fun setActiveTab(value: String?) {
        val next = value ?: "Stream"
        if (activeTab != next) {
            val index = tabs.indexOf(next)
            if (index >= 0 && variant != "v6") animateLift(index)
            activeTab = next
            invalidate()
        }
        syncSelection()
    }

    fun setMoreState(active: Boolean, open: Boolean) {
        moreActive = active
        if (moreOpen != open) {
            moreOpen = open
            val target = if (open) 1f else 0f
            moreAnimator?.cancel()
            moreAnimator = ValueAnimator.ofFloat(moreMorph, target).apply {
                duration = 150L
                interpolator = DecelerateInterpolator(1.5f)
                addUpdateListener { moreMorph = it.animatedValue as Float; invalidate() }
                start()
            }
            slotViews.getOrNull(3)?.contentDescription = if (open) "Close menu" else "More"
        }
        syncSelection()
        invalidate()
    }

    /** What TalkBack announces: the lit tab is selected, More is selected while it or a menu page is up. */
    private fun syncSelection() {
        slotViews.forEachIndexed { i, view ->
            view.isSelected = if (variant == "v6") v6Tabs[i] == activeTab else if (i == 3) moreActive else i < tabs.size && !moreActive && tabs[i] == activeTab
            view.contentDescription = if (variant == "v6") v6Tabs[i] else if (i >= 3) "More" else tabs[i]
        }
    }

    override fun onDetachedFromWindow() {
        moreAnimator?.cancel()
        animators.forEach { it?.cancel() }
        // A pending 2 s hold must not fire into a bar that has gone.
        for (i in 0 until 5) disarmHold(i)
        super.onDetachedFromWindow()
    }

    fun isMoreActive(): Boolean = moreActive
    fun isMoreOpen(): Boolean = moreOpen

    fun setMicEnabled(value: Boolean) { if (micEnabled != value) { micEnabled = value; requestLayout(); invalidate() } }
    fun setBottomInset(value: Float) { if (bottomInset != value) { bottomInset = value; requestLayout(); invalidate() } }
    fun setBottomOffset(value: Float) { if (bottomOffset != value) { bottomOffset = value; requestLayout(); invalidate() } }
    fun setDark(value: Boolean) { dark = value; invalidate() }
    fun setGlassBackground(value: Boolean) { glassBackground = value; invalidate() }

    fun setActiveTint(value: String?) {
        activeTint = parseColor(value, Color.WHITE)
        invalidate()
    }

    fun setInactiveTint(value: String?) {
        inactiveTint = parseColor(value, ColorUtils.setAlphaComponent(Color.WHITE, 115))
        invalidate()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val widthPx = MeasureSpec.getSize(widthMeasureSpec)
        val heightPx = MeasureSpec.getSize(heightMeasureSpec)
        setMeasuredDimension(widthPx, heightPx)
        val slotRects = slotRects(widthPx / density(), heightPx / density())
        slotViews.forEachIndexed { index, child ->
            if (index >= slotRects.size) { child.visibility = View.GONE; return@forEachIndexed }
            child.visibility = View.VISIBLE
            val rect = slotRects[index]
            child.measure(
                MeasureSpec.makeMeasureSpec((rect.right - rect.left).times(density()).roundToInt().coerceAtLeast(1), MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec((rect.bottom - rect.top).times(density()).roundToInt().coerceAtLeast(1), MeasureSpec.EXACTLY),
            )
        }
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        val rects = slotRects((right - left) / density(), (bottom - top) / density())
        slotViews.forEachIndexed { index, child ->
            if (index >= rects.size) return@forEachIndexed
            val rect = rects[index]
            child.layout(
                (rect.left * density()).roundToInt(),
                (rect.top * density()).roundToInt(),
                (rect.right * density()).roundToInt(),
                (rect.bottom * density()).roundToInt(),
            )
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val scale = density()
        val widthDp = width / scale
        val heightDp = height / scale
        if (widthDp <= 0f || heightDp <= 0f) return
        canvas.save()
        canvas.scale(scale, scale)
        if (variant == "v6") { drawV6(canvas, widthDp); canvas.restore(); return }
        val y = barTop(heightDp)
        if (variant == "classic") drawClassicBackground(canvas, widthDp, y)
        else drawPillBackground(canvas, widthDp, y)

        val rects = slotRects(widthDp, heightDp)
        for (index in 0..3) {
            val rect = rects[index]
            val focused = if (index == 3) moreActive else activeTab == tabs[index] && !moreActive
            val color = if (focused) activeTint else inactiveTint
            val cx = rect.centerX()
            val liftY = lift[index] * -3f
            val pressScale = 1f - pressed[index] * 0.1f
            canvas.save()
            canvas.translate(cx, y + if (variant == "modern-pill") 23f else TAB_HEIGHT / 2f)
            canvas.translate(0f, liftY)
            canvas.scale(pressScale * (1f + lift[index] * 0.12f), pressScale * (1f + lift[index] * 0.12f))
            if (index == 3) drawMore(canvas, color) else drawTabIcon(canvas, tabs[index], color, focused)
            canvas.restore()
            if (variant == "modern-pill") {
                labelPaint.textSize = 11f * resources.configuration.fontScale
                labelPaint.color = color
                val label = if (index >= 3) "More" else tabs[index]
                canvas.drawText(label, cx, y + 55f, labelPaint)
            }
        }
        canvas.restore()
    }

    fun setHoldTab(value: String?) {
        holdTab = value?.takeIf { it.isNotEmpty() }
        if (holdTab == null) for (i in 0 until 5) disarmHold(i)
    }

    private fun holdsAt(index: Int): Boolean = variant == "v6" && holdTab != null && v6Tabs.getOrNull(index) == holdTab

    private fun armHold(index: Int) {
        disarmHold(index)
        val run = Runnable {
            holdRunnables[index] = null
            heldIndex = index
            slotViews.getOrNull(index)?.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
            onTabLongPress(mapOf("route" to v6Tabs[index]))
        }
        holdRunnables[index] = run
        postDelayed(run, HOLD_MS)
    }

    private fun disarmHold(index: Int) {
        holdRunnables[index]?.let { removeCallbacks(it) }
        holdRunnables[index] = null
    }

    private fun activate(index: Int) {
        if (variant == "v6") onTabPress(mapOf("route" to v6Tabs[index]))
        else if (index == 3) onMorePress(mapOf("open" to moreOpen))
        else onTabPress(mapOf("route" to tabs[index]))
    }

    private fun animatePress(index: Int, down: Boolean) {
        animators[index]?.cancel()
        ValueAnimator.ofFloat(pressed[index], if (down) 1f else 0f).apply {
            duration = if (down) 70L else 140L
            interpolator = DecelerateInterpolator(1.5f)
            addUpdateListener { pressed[index] = it.animatedValue as Float; invalidate() }
            start()
        }.also { animators[index] = it }
    }

    private fun animateLift(index: Int) {
        ValueAnimator.ofFloat(0f, 1f, 0f).apply {
            duration = 280L
            interpolator = DecelerateInterpolator(1.4f)
            addUpdateListener { lift[index] = it.animatedValue as Float; invalidate() }
            start()
        }
    }

    private fun slotRects(width: Float, height: Float): List<RectF> {
        if (variant == "v6") return (0..4).map { i -> RectF(i * width / 5f, 0f, (i + 1) * width / 5f, V6_BAR_DP) }
        return TabBarGeometry.slots(variant == "modern-pill", micEnabled, width, barTop(height))
            .map { RectF(it.left, it.top, it.right, it.bottom) }
    }

    private fun drawV6(canvas: Canvas, width: Float) {
        v6Tabs.forEachIndexed { index, name ->
            val selected = name == activeTab
            val cx = width * (index + 0.5f) / 5f
            // The 56dp V6 bar (src/navigation/v6Shell.ts NAV_BAR_HEIGHT). Round 7 item 3: the selected tab is its foreground
            // only (filled icon, bright semibold label); no pill, tile or background behind it.
            if (slotViews.getOrNull(index)?.isFocused == true) {
                // Keyboard focus is its own ring and never looks like selection.
                iconPaint.color = ColorUtils.setAlphaComponent(Color.WHITE, 230)
                iconPaint.style = Paint.Style.STROKE
                iconPaint.strokeWidth = 2f
                canvas.drawRoundRect(RectF(cx - width / 10f + 4f, 4f, cx + width / 10f - 4f, V6_BAR_DP - 4f), 14f, 14f, iconPaint)
                iconPaint.style = Paint.Style.FILL
            }
            val color = if (selected) activeTint else inactiveTint
            canvas.save()
            canvas.translate(cx, 18f)
            drawTabIcon(canvas, name, ColorUtils.setAlphaComponent(color, (Color.alpha(color) * (1f - pressed[index] * 0.15f)).roundToInt()), selected)
            canvas.restore()
            labelPaint.color = color
            labelPaint.textSize = 12f * resources.configuration.fontScale.coerceAtMost(1.3f)
            labelPaint.typeface = Typeface.create(if (selected) "sans-serif-medium" else "sans-serif", Typeface.NORMAL)
            canvas.drawText(name, cx, 48f, labelPaint)
        }
    }

    private fun barTop(height: Float): Float =
        TabBarGeometry.barTop(variant == "modern-pill", height, bottomInset, bottomOffset)

    /** Solid black to the bottom edge, under the gesture strip too, like the React Native bar. */
    private fun drawClassicBackground(canvas: Canvas, width: Float, top: Float) {
        iconPaint.style = Paint.Style.FILL
        iconPaint.color = Color.BLACK
        canvas.drawRect(0f, top, width, top + TAB_HEIGHT + bottomInset, iconPaint)
    }

    private fun drawPillBackground(canvas: Canvas, width: Float, top: Float) {
        val pill = RectF(0.5f, top + 0.5f, width - 0.5f, top + 63.5f)
        bounds.set(pill)
        if (!glassBackground) {
            iconPaint.style = Paint.Style.FILL
            iconPaint.shader = LinearGradient(
                0f, pill.top, 0f, pill.bottom,
                if (dark) intArrayOf(0xF00A0A0C.toInt(), 0xF509090C.toInt()) else intArrayOf(0xF2FFFFFF.toInt(), 0xE9F8F8FC.toInt()),
                null,
                Shader.TileMode.CLAMP,
            )
            canvas.drawRoundRect(pill, 32f, 32f, iconPaint)
            iconPaint.shader = null
            // With a glass backing the React Native pill already draws the hairline rim; a
            // second one here read as a doubled edge.
            iconPaint.style = Paint.Style.STROKE
            iconPaint.strokeWidth = 0.7f
            iconPaint.color = if (dark) 0x18FFFFFF else 0x18000000
            canvas.drawRoundRect(pill, 32f, 32f, iconPaint)
        }
        if (dark) {
            iconPaint.style = Paint.Style.STROKE
            iconPaint.strokeWidth = 0.75f
            iconPaint.color = 0x38FFFFFF
            canvas.drawLine(24f, top + 1f, width - 24f, top + 1f, iconPaint)
        }
        iconPaint.style = Paint.Style.FILL
    }

    /**
     * The tab's glyph from Ionicons, the icon set the rest of the app draws with: the outline when the tab is
     * resting, the solid one when it is chosen. (These used to be hand-drawn arcs and paths whose "chosen" state
     * filled a stroke shape, which turned them into blobs.)
     */
    private fun drawTabIcon(canvas: Canvas, name: String, color: Int, focused: Boolean) {
        val glyph = TAB_GLYPHS[name] ?: return
        drawGlyph(canvas, if (focused) glyph.first else glyph.second, color)
    }

    /** â€¢â€¢â€¢ morphs into Ã— while the More menu is open: the two glyphs cross-fade, the Ã— turning in by 45Â°. */
    private fun drawMore(canvas: Canvas, color: Int) {
        drawGlyph(canvas, GLYPH_MORE, ColorUtils.setAlphaComponent(color, (Color.alpha(color) * (1f - moreMorph)).roundToInt()))
        canvas.save()
        canvas.rotate((1f - moreMorph) * -45f)
        drawGlyph(canvas, GLYPH_CLOSE, ColorUtils.setAlphaComponent(color, (Color.alpha(color) * moreMorph).roundToInt()))
        canvas.restore()
    }

    /** One Ionicons glyph centred on the canvas origin (the canvas is already in dp). */
    private fun drawGlyph(canvas: Canvas, codepoint: Int, color: Int) {
        if (Color.alpha(color) == 0) return
        glyphPaint.color = color
        val text = String(Character.toChars(codepoint))
        val metrics = glyphPaint.fontMetrics
        canvas.drawText(text, 0f, -(metrics.ascent + metrics.descent) / 2f, glyphPaint)
    }

    private fun parseColor(value: String?, fallback: Int): Int =
        runCatching { Color.parseColor(value ?: "") }.getOrDefault(fallback)

    private fun density(): Float = resources.displayMetrics.density
    private fun dp(value: Float): Float = value * density()

    private companion object {
        const val TAB_HEIGHT = 64f
        /** The V6 bar's height above the inset; must match NAV_BAR_HEIGHT in src/navigation/v6Shell.ts. */
        const val V6_BAR_DP = 56f
        /** How long a tab is held to open its shortcut; must match TAB_HOLD_MS in src/navigation/tabHold.ts. */
        const val HOLD_MS = 2000L
        /** Glyph size in dp: Ionicons' 512-unit box drawn at the app's tab icon size. */
        const val GLYPH_SIZE = 24f
        /** Ionicons codepoints (glyphmaps/Ionicons.json in @expo/vector-icons): chosen, resting. */
        val TAB_GLYPHS = mapOf(
            "Stream" to (0xf4ff to 0xf506), // radio, radio-outline
            "Luvs" to (0xf36a to 0xf377), // heart, heart-outline
            "Search" to (0xf55f to 0xf563),
            "You" to (0xf4a9 to 0xf4aa),
            "Library" to (0xf3b5 to 0xf3b6), // library, library-outline
        )
        const val GLYPH_MORE = 0xf2ce // ellipsis-horizontal
        const val GLYPH_CLOSE = 0xf24a // close
        @Volatile private var ionicons: Typeface? = null
        /** The font ships in assets/fonts (copied from @expo/vector-icons); loaded once per process. */
        fun ionicons(context: Context): Typeface =
            ionicons ?: runCatching { Typeface.createFromAsset(context.assets, "fonts/Ionicons.ttf") }
                .getOrDefault(Typeface.DEFAULT)
                .also { ionicons = it }
    }
}
