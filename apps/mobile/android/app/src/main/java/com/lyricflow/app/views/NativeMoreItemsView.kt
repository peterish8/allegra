package com.lyricflow.app.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextPaint
import android.text.TextUtils
import android.util.TypedValue
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.animation.PathInterpolator
import android.view.accessibility.AccessibilityEvent
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.customview.widget.ExploreByTouchHelper
import com.lyricflow.app.island.IslandFonts
import com.lyricflow.app.island.Spring
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The items of the "More" menu (the three tiles across the top and the rows under them), drawn in Kotlin with the look
 * and feel of `MoreMenu.tsx`: tiles with the lit selected state and `Tactile`'s sink at 0.93, rows with the pressed
 * highlight, and the staggered rise-in (`riseIn`: opacity 240 ms, translateY 10 and scale 0.94 on the `tactile`
 * spring, 50 ms + 30 ms per item). The frosted card, the backdrop and the card's own spring stay React Native; the
 * menu falls back to its React Native items on iOS and in builds without this view.
 *
 * The view decides nothing: a tap comes back as `onSelect(key)` and JavaScript runs the same handler (the haptic tick,
 * the navigation, closing the menu). The theme colours come from JavaScript (`palette`).
 */
class NativeMoreItemsView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onSelect by EventDispatcher<Map<String, Any>>()

    private val density = resources.displayMetrics.density
    /** `StyleSheet.hairlineWidth`: 0.4 dp rounded to a whole pixel (at least one). */
    private val hairlineDp = max(1f, (0.4f * density).roundToInt().toFloat()) / density
    private val main = Handler(Looper.getMainLooper())
    private val glyphs = GlyphPainter(density)

    // ── Props, applied in one batch (commit) ────────────────────────────────
    private var itemsJson = ""
    private var appliedItemsJson = ""
    private var activeKey = ""
    private var paletteJson = ""
    private var appliedPaletteJson = ""
    private var animateIn = true
    private var propsDirty = false
    private var items: List<MoreMenuItem> = emptyList()

    private var ink = Color.WHITE
    private var inkSoft = Color.WHITE
    private var inkMuted = Color.GRAY
    private var inkFaint = Color.DKGRAY
    private var wave = Color.YELLOW

    // ── Entry: per-item rise ────────────────────────────────────────────────
    private class Rise {
        val ty = Spring(10f, SPRING_K, SPRING_ZETA).also { it.target = 0f }
        val sc = Spring(0.94f, SPRING_K, SPRING_ZETA).also { it.target = 1f }
        var opacity = 0f
        var done = false
    }
    private var rises: List<Rise> = emptyList()
    private var appearedAt = 0L
    private val decelerate = PathInterpolator(0f, 0f, 0.2f, 1f)

    // ── Press state ─────────────────────────────────────────────────────────
    private var pressed = -1
    private var active = false
    private var downAt = 0L
    private val tilePress = Array(MoreMenuGeometry.TILES) { Spring(0f, SPRING_K, SPRING_ZETA) }
    private val releases = arrayOfNulls<Runnable>(MoreMenuGeometry.TILES)

    // ── Frame loop ──────────────────────────────────────────────────────────
    private var visible = true
    private var framePosted = false
    private var lastFrameNanos = 0L
    private val frame = Choreographer.FrameCallback { nanos ->
        framePosted = false
        val dt = if (lastFrameNanos == 0L) 0f else min(0.05f, (nanos - lastFrameNanos) / 1e9f)
        lastFrameNanos = nanos
        var busy = false
        val sinceAppear = SystemClock.uptimeMillis() - appearedAt
        for ((i, rise) in rises.withIndex()) {
            if (rise.done) continue
            val t = sinceAppear - MoreMenuGeometry.delayMs(i)
            if (t < 0) { busy = true; continue }
            rise.opacity = decelerate.getInterpolation((t / FADE_MS.toFloat()).coerceIn(0f, 1f))
            val moving = rise.ty.step(dt) or rise.sc.step(dt)
            if (!moving && rise.opacity >= 1f) rise.done = true else busy = true
        }
        for (s in tilePress) if (s.step(dt)) busy = true
        invalidate()
        if (busy) wake() else lastFrameNanos = 0L
    }

    // ── Drawing ─────────────────────────────────────────────────────────────
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val labelPaint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val rowLabelPaint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val hintPaint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()
    private val clip = Path()
    private var removeFonts: (() -> Unit)? = null
    private val access = Access(this)

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setWillNotDraw(false)
        ViewCompat.setAccessibilityDelegate(this, access)
        applyFonts()
    }

    // ── Props ───────────────────────────────────────────────────────────────

    fun setItems(json: String?) { itemsJson = json.orEmpty(); propsDirty = true }
    fun setActiveKey(key: String?) { activeKey = key.orEmpty(); propsDirty = true }
    fun setPalette(json: String?) { paletteJson = json.orEmpty(); propsDirty = true }
    fun setAnimateIn(on: Boolean?) { animateIn = on ?: true; propsDirty = true }

    fun commit() {
        if (!propsDirty) return
        propsDirty = false
        if (paletteJson != appliedPaletteJson) {
            appliedPaletteJson = paletteJson
            parsePalette()
        }
        if (itemsJson != appliedItemsJson) {
            appliedItemsJson = itemsJson
            items = MoreMenuItems.parse(itemsJson)
            // A new set of items rises in again (the menu opening); Reduce Motion shows them at once.
            rises = items.map { Rise().also { r -> if (!animateIn) { r.ty.snap(0f); r.sc.snap(1f); r.opacity = 1f; r.done = true } } }
            appearedAt = SystemClock.uptimeMillis()
            pressed = -1
            for (s in tilePress) s.snap(0f)
        }
        access.invalidateRoot()
        invalidate()
        wake()
    }

    private fun parsePalette() {
        runCatching {
            val o = JSONObject(paletteJson)
            ink = Color.parseColor(o.getString("ink"))
            inkSoft = Color.parseColor(o.getString("inkSoft"))
            inkMuted = Color.parseColor(o.getString("inkMuted"))
            inkFaint = Color.parseColor(o.getString("inkFaint"))
            wave = Color.parseColor(o.getString("wave"))
        }
    }

    private fun applyFonts() {
        labelPaint.typeface = IslandFonts.semibold
        rowLabelPaint.typeface = IslandFonts.semibold
        hintPaint.typeface = IslandFonts.regular
        // React Native converts sp with the platform (nonlinear above 100% from Android 14), not density x fontScale.
        labelPaint.textSize = sp(TILE_LABEL_SP)
        rowLabelPaint.textSize = sp(ROW_LABEL_SP)
        hintPaint.textSize = sp(ROW_HINT_SP)
        // The app's SF Pro tracking (`sfTracking`), in em: -0.04 dp at 12.5, -0.32 dp at 16.
        labelPaint.letterSpacing = -0.04f / TILE_LABEL_SP
        rowLabelPaint.letterSpacing = -0.32f / ROW_LABEL_SP
        hintPaint.letterSpacing = -0.04f / ROW_HINT_SP
    }

    private fun sp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, resources.displayMetrics)

    // ── Frame loop ──────────────────────────────────────────────────────────

    private fun wake() {
        if (framePosted || !isAttachedToWindow || !visible) return
        framePosted = true
        Choreographer.getInstance().postFrameCallback(frame)
    }

    override fun onVisibilityAggregated(isVisible: Boolean) {
        super.onVisibilityAggregated(isVisible)
        if (visible == isVisible) return
        visible = isVisible
        if (visible) {
            invalidate()
            wake()
        } else {
            Choreographer.getInstance().removeFrameCallback(frame)
            framePosted = false
            lastFrameNanos = 0L
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (removeFonts == null) removeFonts = IslandFonts.load(context) { main.post { applyFonts(); invalidate() } }
        appearedAt = SystemClock.uptimeMillis()
        wake()
    }

    override fun onDetachedFromWindow() {
        Choreographer.getInstance().removeFrameCallback(frame)
        framePosted = false
        lastFrameNanos = 0L
        for (r in releases) r?.let { main.removeCallbacks(it) }
        removeFonts?.invoke()
        removeFonts = null
        // A press cut short by the detach must not come back sunk and dimmed.
        pressed = -1
        active = false
        for (s in tilePress) s.snap(0f)
        super.onDetachedFromWindow()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    override fun dispatchHoverEvent(event: MotionEvent): Boolean = access.dispatchHoverEvent(event) || super.dispatchHoverEvent(event)

    // ── Touch ───────────────────────────────────────────────────────────────

    private fun widthDp() = width / density

    private fun hitAt(x: Float, y: Float) = MoreMenuGeometry.hit(x / density, y / density, items.size, widthDp(), hairlineDp)

    private fun stillOn(i: Int, x: Float, y: Float) = MoreMenuGeometry.within(i, x / density, y / density, widthDp(), hairlineDp)

    private fun moveTile(i: Int, on: Boolean) {
        if (i >= MoreMenuGeometry.TILES) return
        // Reduce Motion: the press dims without scaling, and Reanimated's springs jump there.
        if (!animateIn) tilePress[i].snap(if (on) 1f else 0f) else tilePress[i].target = if (on) 1f else 0f
        wake()
    }

    private fun pressTo(i: Int, down: Boolean) {
        if (i >= MoreMenuGeometry.TILES) { invalidate(); return }
        releases[i]?.let { main.removeCallbacks(it) }
        if (down) {
            moveTile(i, true)
            return
        }
        val held = SystemClock.uptimeMillis() - downAt
        val release = Runnable { moveTile(i, false) }
        releases[i] = release
        main.postDelayed(release, max(0L, MIN_PRESS_MS - held))
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val i = hitAt(event.x, event.y)
                if (i < 0) return false
                pressed = i
                active = true
                downAt = SystemClock.uptimeMillis()
                pressTo(i, true)
                invalidate()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (pressed < 0) return false
                val now = stillOn(pressed, event.x, event.y)
                if (now != active) {
                    active = now
                    moveTile(pressed, now)
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                if (pressed < 0) return false
                val i = pressed
                val fire = active
                pressed = -1
                pressTo(i, false)
                invalidate()
                if (fire) emit(i)
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                val i = pressed
                pressed = -1
                if (i >= 0) pressTo(i, false)
                invalidate()
                return true
            }
        }
        return pressed >= 0
    }

    private fun emit(i: Int) {
        val item = items.getOrNull(i) ?: return
        onSelect(mapOf("key" to item.key))
    }

    // ── Drawing ─────────────────────────────────────────────────────────────

    override fun onDraw(canvas: Canvas) {
        if (items.isEmpty() || width <= 0) return
        val w = widthDp()
        val rowCount = items.size - MoreMenuGeometry.TILES
        // The rows' glass is not part of the rise: it is there from the first frame.
        if (rowCount > 0) {
            val top = MoreMenuGeometry.rowTop(0, hairlineDp) * density
            val bottom = (MoreMenuGeometry.rowTop(rowCount - 1, hairlineDp) + MoreMenuGeometry.ROW_MIN_H) * density
            rect.set(0f, top, w * density, bottom)
            fill.color = Color.argb(13, 255, 255, 255)
            canvas.drawRoundRect(rect, MoreMenuGeometry.ROWS_RADIUS * density, MoreMenuGeometry.ROWS_RADIUS * density, fill)
        }
        for ((i, item) in items.withIndex()) {
            val rise = rises.getOrNull(i)
            val a = MoreMenuGeometry.area(i, w, hairlineDp)
            val cx = (a.left + a.right) / 2f * density
            val cy = (a.top + a.bottom) / 2f * density
            val opacity = rise?.opacity ?: 1f
            if (opacity <= 0.001f) continue
            val save = canvas.save()
            if (rise != null && !rise.done) {
                canvas.translate(0f, rise.ty.value * density)
                canvas.scale(rise.sc.value, rise.sc.value, cx, cy)
            }
            // The fade layer opens after the rise's transform, so its bounds are the item's own area (opened before it,
            // the layer clipped the bottom of an item that had moved down).
            if (opacity < 0.999f) {
                canvas.saveLayerAlpha(a.left * density - 2, a.top * density - 2, a.right * density + 2, a.bottom * density + 2, (255 * opacity).roundToInt())
            }
            if (i < MoreMenuGeometry.TILES) drawTile(canvas, i, item, a) else drawRow(canvas, i, item, a, w)
            // Restoring to `save` closes the layer (if opened) and the transform together.
            canvas.restoreToCount(save)
        }
    }

    private fun drawTile(canvas: Canvas, i: Int, item: MoreMenuItem, a: MoreMenuGeometry.Rect) {
        val on = item.key == activeKey
        val p = tilePress[i].value
        val cx = (a.left + a.right) / 2f * density
        val cy = (a.top + a.bottom) / 2f * density
        // `Tactile` at 0.93: sinks and dims by 14% on one spring value.
        val layer = if (p >= 0.001f) canvas.saveLayerAlpha(a.left * density - 2, -2f, a.right * density + 2, (a.bottom * density) + 2, (255 * (1f - PRESS_DIM * p)).roundToInt()) else -1
        if (layer >= 0 && animateIn) {
            val s = 1f + (TILE_PRESS_SCALE - 1f) * p
            canvas.scale(s, s, cx, cy)
        }
        val r = MoreMenuGeometry.TILE_RADIUS * density
        rect.set(a.left * density, a.top * density, a.right * density, a.bottom * density)
        fill.color = if (on) Color.argb(36, 217, 230, 106) else Color.argb(20, 255, 255, 255)
        canvas.drawRoundRect(rect, r, r, fill)
        // The hairline border is drawn inside the box.
        val hw = hairlineDp * density
        stroke.strokeWidth = hw
        stroke.color = if (on) Color.argb(89, 217, 230, 106) else Color.argb(31, 255, 255, 255)
        rect.inset(hw / 2f, hw / 2f)
        canvas.drawRoundRect(rect, r - hw / 2f, r - hw / 2f, stroke)

        // The icon box, a 7 dp gap and the label line, centred as a block in the tile.
        val iconBox = if (item.icon == DJ_MASCOT) MASCOT_SIZE else TILE_ICON * ICON_BOX_RATIO
        val labelM = labelPaint.fontMetrics
        val labelH = (labelM.bottom - labelM.top) / density
        val top = a.top + MoreMenuGeometry.tileContentTop(iconBox, labelH)
        val color = if (on) wave else ink
        drawIcon(canvas, item.icon, TILE_ICON, (a.left + a.right) / 2f, top + iconBox / 2f, color, on)
        labelPaint.color = color
        val text = TextUtils.ellipsize(item.label, labelPaint, (a.right - a.left) * density, TextUtils.TruncateAt.END)
        val baseline = (top + iconBox + MoreMenuGeometry.TILE_CONTENT_GAP) * density - labelM.top
        val tw = labelPaint.measureText(text, 0, text.length)
        canvas.drawText(text, 0, text.length, cx - tw / 2f, baseline, labelPaint)
        if (layer >= 0) canvas.restoreToCount(layer)
    }

    private fun drawRow(canvas: Canvas, i: Int, item: MoreMenuItem, a: MoreMenuGeometry.Rect, w: Float) {
        val on = item.key == activeKey
        val rowIndex = i - MoreMenuGeometry.TILES
        val rowCount = items.size - MoreMenuGeometry.TILES
        // A pressed row is lit inside the rows' rounded rectangle (overflow hidden).
        if (pressed == i && active) {
            canvas.save()
            val topAll = MoreMenuGeometry.rowTop(0, hairlineDp) * density
            val bottomAll = (MoreMenuGeometry.rowTop(rowCount - 1, hairlineDp) + MoreMenuGeometry.ROW_MIN_H) * density
            rect.set(0f, topAll, w * density, bottomAll)
            clip.reset()
            clip.addRoundRect(rect, MoreMenuGeometry.ROWS_RADIUS * density, MoreMenuGeometry.ROWS_RADIUS * density, Path.Direction.CW)
            canvas.clipPath(clip)
            fill.color = Color.argb(36, 255, 255, 255)
            canvas.drawRect(0f, a.top * density, w * density, a.bottom * density, fill)
            canvas.restore()
        }
        // The rule above every row but the first, inset by 50.
        if (rowIndex > 0) {
            fill.color = Color.argb(26, 255, 255, 255)
            val ruleTop = (a.top - hairlineDp) * density
            canvas.drawRect(MoreMenuGeometry.RULE_INSET * density, ruleTop, w * density, ruleTop + hairlineDp * density, fill)
        }
        // The flex row centres the icon, the text block and the chevron on the row's middle.
        val cy = (a.top + a.bottom) / 2f
        drawIcon(canvas, item.icon, ROW_ICON, MoreMenuGeometry.ROW_PAD_X + ROW_ICON / 2f, cy, if (on) wave else inkSoft, on)
        // The text block: the label, and under it a 2 dp gap and the hint.
        val labelM = rowLabelPaint.fontMetrics
        val hintM = hintPaint.fontMetrics
        val labelH = (labelM.bottom - labelM.top) / density
        val hintH = (hintM.bottom - hintM.top) / density
        val hasHint = item.hint != null
        val blockTop = a.top + MoreMenuGeometry.rowTextTop(MoreMenuGeometry.ROW_MIN_H, labelH, hintH, hasHint)
        val textX = (MoreMenuGeometry.ROW_PAD_X + ROW_ICON + MoreMenuGeometry.ROW_ICON_GAP) * density
        val avail = (w - MoreMenuGeometry.ROW_PAD_X - ROW_ICON - MoreMenuGeometry.ROW_ICON_GAP - MoreMenuGeometry.ROW_ICON_GAP - CHEVRON - MoreMenuGeometry.ROW_PAD_X) * density
        rowLabelPaint.color = if (on) wave else ink
        val label = TextUtils.ellipsize(item.label, rowLabelPaint, avail, TextUtils.TruncateAt.END)
        canvas.drawText(label, 0, label.length, textX, blockTop * density - labelM.top, rowLabelPaint)
        if (item.hint != null) {
            hintPaint.color = inkMuted
            val hint = TextUtils.ellipsize(item.hint, hintPaint, avail, TextUtils.TruncateAt.END)
            val hintTop = blockTop + labelH + MoreMenuGeometry.ROW_TEXT_GAP
            canvas.drawText(hint, 0, hint.length, textX, hintTop * density - hintM.top, hintPaint)
        }
        glyphs.draw(canvas, IconGlyphs.ION_CHEVRON_FORWARD, CHEVRON, w - MoreMenuGeometry.ROW_PAD_X - CHEVRON / 2f, cy, inkFaint)
    }

    private fun drawIcon(canvas: Canvas, icon: String, sizeDp: Float, cxDp: Float, cyDp: Float, color: Int, active: Boolean) {
        when (icon) {
            DJ_MASCOT -> drawMascot(canvas, cxDp, cyDp, active)
            "search" -> glyphs.draw(canvas, IconGlyphs.ION_SEARCH, sizeDp, cxDp, cyDp, color)
            "albums-outline" -> glyphs.draw(canvas, IconGlyphs.ION_ALBUMS_OUTLINE, sizeDp, cxDp, cyDp, color)
            "settings-outline" -> glyphs.draw(canvas, IconGlyphs.ION_SETTINGS_OUTLINE, sizeDp, cxDp, cyDp, color)
        }
    }

    /** `DjMascotIcon`: a glowing aura, a core and two tilted eyes in a 24 dp box (Android draws none of its shadows). */
    private fun drawMascot(canvas: Canvas, cxDp: Float, cyDp: Float, active: Boolean) {
        val left = (cxDp - MASCOT_SIZE / 2f) * density
        val top = (cyDp - MASCOT_SIZE / 2f) * density
        fun box(l: Float, t: Float, r: Float, b: Float) = rect.set(left + l * density, top + t * density, left + r * density, top + b * density)
        // Border radii larger than half a side are scaled down to it, as CSS (and Yoga) do.
        box(1f, 1f, 23f, 24f)
        fill.color = if (active) Color.argb(204, 255, 187, 92) else Color.argb(143, 255, 207, 126)
        canvas.drawRoundRect(rect, 11f * density, 11f * density, fill)
        box(5f, 6f, 19f, 21f)
        fill.color = if (active) Color.argb(209, 255, 128, 40) else Color.argb(173, 255, 145, 47)
        canvas.drawRoundRect(rect, 7f * density, 7f * density, fill)
        fill.color = Color.WHITE
        // Left eye 5 x 9 at (7, 7) turned -9 degrees, right eye 5 x 8 at (13, 9) turned 8 degrees, each about its centre.
        for ((l, t, h, deg) in EYES) {
            canvas.save()
            canvas.rotate(deg, left + (l + 2.5f) * density, top + (t + h / 2f) * density)
            box(l, t, l + 5f, t + h)
            canvas.drawRoundRect(rect, 2.5f * density, 2.5f * density, fill)
            canvas.restore()
        }
    }

    // ── Accessibility ───────────────────────────────────────────────────────

    private inner class Access(host: View) : ExploreByTouchHelper(host) {
        override fun getVirtualViewAt(x: Float, y: Float): Int = hitAt(x, y).let { if (it < 0) INVALID_ID else it }

        override fun getVisibleVirtualViews(out: MutableList<Int>) {
            for (i in items.indices) out += i
        }

        override fun onPopulateNodeForVirtualView(id: Int, node: AccessibilityNodeInfoCompat) {
            val item = items.getOrNull(id)
            if (item == null) {
                node.contentDescription = ""
                node.setBoundsInParent(Rect(0, 0, 1, 1))
                return
            }
            val a = MoreMenuGeometry.area(id, widthDp(), hairlineDp)
            node.setBoundsInParent(Rect((a.left * density).roundToInt(), (a.top * density).roundToInt(), (a.right * density).roundToInt(), (a.bottom * density).roundToInt()))
            // React Native's `menuitem` role: the plain view class and the role description "menu item".
            node.roleDescription = "Menu item"
            node.isClickable = true
            node.isSelected = item.key == activeKey
            node.addAction(AccessibilityNodeInfoCompat.ACTION_CLICK)
            // A tile is named by its label; a row by its label and hint, as React Native merges the row's texts.
            node.contentDescription = if (item.hint != null) "${item.label}, ${item.hint}" else item.label
        }

        override fun onPerformActionForVirtualView(id: Int, action: Int, arguments: Bundle?): Boolean {
            if (action != AccessibilityNodeInfoCompat.ACTION_CLICK || id !in items.indices) return false
            emit(id)
            sendEventForVirtualView(id, AccessibilityEvent.TYPE_VIEW_CLICKED)
            return true
        }
    }

    private companion object {
        const val DJ_MASCOT = "dj-mascot"
        const val TILE_ICON = 24f
        const val ROW_ICON = 22f
        const val CHEVRON = 16f
        const val MASCOT_SIZE = 24f

        /** The Ionicons text box is the head bounding box: 524 of 512 units high. */
        const val ICON_BOX_RATIO = 524f / 512f

        const val TILE_LABEL_SP = 12.5f
        const val ROW_LABEL_SP = 16f
        const val ROW_HINT_SP = 12.5f

        const val FADE_MS = 240L
        const val PRESS_DIM = 0.14f
        const val TILE_PRESS_SCALE = 0.93f
        const val MIN_PRESS_MS = 70L

        // Motion.spring.tactile: stiffness 700, damping 40, mass 0.8.
        const val SPRING_K = 875f
        const val SPRING_ZETA = 0.845f

        /** left, top, height, degrees of each eye in the 24 dp mascot box. */
        val EYES = listOf(
            Eye(7f, 7f, 9f, -9f),
            Eye(13f, 9f, 8f, 8f),
        )
    }

    private data class Eye(val l: Float, val t: Float, val h: Float, val deg: Float)
}
