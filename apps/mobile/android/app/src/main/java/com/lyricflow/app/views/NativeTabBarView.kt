package com.lyricflow.app.views

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
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
    private val tabs = listOf("Stream", "Luvs", "Library")
    private val slotViews = ArrayList<View>(4)
    private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create("sans-serif", Typeface.BOLD)
    }
    private val path = Path()
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
    private val lift = FloatArray(4)
    private val pressed = FloatArray(4)
    private val animators = arrayOfNulls<ValueAnimator>(4)
    private var moreAnimator: ValueAnimator? = null

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setWillNotDraw(false)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        repeat(4) { index ->
            val slot = View(context).apply {
                isClickable = true
                isFocusable = true
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
                contentDescription = if (index == 3) "More" else tabs[index]
                ViewCompat.setAccessibilityDelegate(this, object : AccessibilityDelegateCompat() {
                    override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
                        super.onInitializeAccessibilityNodeInfo(host, info)
                        info.className = "android.widget.Button"
                        info.isSelected = host.isSelected
                        // TalkBack's double tap performs ACTION_CLICK; say so outright.
                        info.isClickable = true
                        info.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_CLICK)
                        if (index == 3) info.addAction(
                            if (moreOpen) AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_COLLAPSE
                            else AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_EXPAND,
                        )
                    }
                })
                setOnClickListener { activate(index) }
                setOnTouchListener { _, event ->
                    when (event.actionMasked) {
                        android.view.MotionEvent.ACTION_DOWN -> animatePress(index, true)
                        android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> animatePress(index, false)
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
        val next = if (value == "classic") "classic" else "modern-pill"
        if (variant == next) return
        variant = next
        elevation = dp(if (variant == "classic") 0f else 16f)
        requestLayout(); invalidate()
    }

    fun setActiveTab(value: String?) {
        val next = value ?: "Stream"
        if (activeTab != next) {
            val index = tabs.indexOf(next)
            if (index >= 0) animateLift(index)
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
            view.isSelected = if (i == 3) moreActive else !moreActive && tabs[i] == activeTab
        }
    }

    override fun onDetachedFromWindow() {
        moreAnimator?.cancel()
        animators.forEach { it?.cancel() }
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
                labelPaint.textSize = 10.5f * resources.configuration.fontScale
                labelPaint.color = color
                val label = if (index == 3) "More" else tabs[index]
                canvas.drawText(label, cx, y + 55f, labelPaint)
            }
        }
        canvas.restore()
    }

    private fun activate(index: Int) {
        if (index == 3) onMorePress(mapOf("open" to moreOpen))
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

    private fun slotRects(width: Float, height: Float): List<RectF> =
        TabBarGeometry.slots(variant == "modern-pill", micEnabled, width, barTop(height))
            .map { RectF(it.left, it.top, it.right, it.bottom) }

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

    private fun drawTabIcon(canvas: Canvas, name: String, color: Int, focused: Boolean) {
        iconPaint.color = color
        iconPaint.style = if (focused) Paint.Style.FILL else Paint.Style.STROKE
        iconPaint.strokeWidth = 1.9f
        iconPaint.strokeCap = Paint.Cap.ROUND
        iconPaint.strokeJoin = Paint.Join.ROUND
        when (name) {
            "Stream" -> {
                canvas.drawCircle(0f, 0f, 2.1f, iconPaint.apply { style = Paint.Style.FILL })
                iconPaint.style = Paint.Style.STROKE
                canvas.drawArc(RectF(-6f, -6f, 6f, 6f), -55f, 110f, false, iconPaint)
                canvas.drawArc(RectF(-11f, -11f, 11f, 11f), -55f, 110f, false, iconPaint)
                canvas.drawArc(RectF(-6f, -6f, 6f, 6f), 125f, 110f, false, iconPaint)
                canvas.drawArc(RectF(-11f, -11f, 11f, 11f), 125f, 110f, false, iconPaint)
            }
            "Luvs" -> {
                drawHeart(canvas, -4.3f, -1.6f, 9.3f, color, focused)
                drawHeart(canvas, 4.4f, 1.8f, 8.3f, color, focused)
            }
            "Library" -> {
                canvas.drawRoundRect(RectF(-10f, -10f, 10f, 10f), 1.4f, 1.4f, iconPaint)
                if (!focused) canvas.drawLine(-4f, -10f, -4f, 10f, iconPaint)
                else {
                    iconPaint.style = Paint.Style.STROKE
                    canvas.drawLine(-4f, -10f, -4f, 10f, iconPaint)
                    canvas.drawLine(3f, -10f, 3f, 10f, iconPaint)
                }
            }
        }
    }

    private fun drawHeart(canvas: Canvas, cx: Float, cy: Float, size: Float, color: Int, filled: Boolean) {
        path.reset()
        path.moveTo(cx, cy + size * 0.38f)
        path.cubicTo(cx - size * 0.2f, cy + size * 0.2f, cx - size * 0.5f, cy - size * 0.03f, cx - size * 0.5f, cy - size * 0.25f)
        path.cubicTo(cx - size * 0.5f, cy - size * 0.55f, cx - size * 0.1f, cy - size * 0.55f, cx, cy - size * 0.3f)
        path.cubicTo(cx + size * 0.1f, cy - size * 0.55f, cx + size * 0.5f, cy - size * 0.55f, cx + size * 0.5f, cy - size * 0.25f)
        path.cubicTo(cx + size * 0.5f, cy - size * 0.03f, cx + size * 0.2f, cy + size * 0.2f, cx, cy + size * 0.38f)
        iconPaint.color = color
        iconPaint.style = if (filled) Paint.Style.FILL else Paint.Style.STROKE
        iconPaint.strokeWidth = 1.7f
        canvas.drawPath(path, iconPaint)
    }

    private fun drawMore(canvas: Canvas, color: Int) {
        val alphaDots = (255 * (1f - moreMorph)).toInt()
        val alphaCross = (255 * moreMorph).toInt()
        iconPaint.style = Paint.Style.FILL
        iconPaint.color = ColorUtils.setAlphaComponent(color, alphaDots)
        for (x in floatArrayOf(-7f, 0f, 7f)) canvas.drawCircle(x, 0f, 1.7f, iconPaint)
        iconPaint.style = Paint.Style.STROKE
        iconPaint.strokeWidth = 2f
        iconPaint.strokeCap = Paint.Cap.ROUND
        iconPaint.color = ColorUtils.setAlphaComponent(color, alphaCross)
        canvas.drawLine(-6f, -6f, 6f, 6f, iconPaint)
        canvas.drawLine(6f, -6f, -6f, 6f, iconPaint)
    }

    private fun parseColor(value: String?, fallback: Int): Int =
        runCatching { Color.parseColor(value ?: "") }.getOrDefault(fallback)

    private fun density(): Float = resources.displayMetrics.density
    private fun dp(value: Float): Float = value * density()

    private companion object {
        const val TAB_HEIGHT = 64f
    }
}
