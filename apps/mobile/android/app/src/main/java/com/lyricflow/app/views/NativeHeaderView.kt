package com.lyricflow.app.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.os.Bundle
import android.text.TextPaint
import android.text.TextUtils
import android.util.TypedValue
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityEvent
import android.widget.LinearLayout
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.customview.widget.ExploreByTouchHelper
import com.facebook.react.touch.ReactHitSlopView
import com.lyricflow.app.island.IslandFonts
import com.lyricflow.app.views.HeaderGeometry.Target
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt

/**
 * Now Playing's header, drawn in Kotlin: the grabber and, when they apply, the "Listening together" and "Playing on
 * <device>" chips. The same look as `NowPlayingHeader.tsx`, which stays as the fallback for iOS and builds without this
 * view. The container (its safe-area padding, its fade from `animatedStyle`, its pointer events) stays React Native.
 *
 * The view decides nothing: a tap comes back through `onAction` (`back | together | playingOn`) and JavaScript runs the
 * same handlers. There is no press feedback and no animation, so nothing runs per frame.
 *
 * The view spans the container's width and reaches 12 dp above the grabber (negative margin in `NativeHeader.tsx`), so
 * the grabber's slop lies inside it. Only the grabber (with its wide slop) and the chips take touches: each is a real
 * child [Zone] view with exactly its rectangle, because Gesture Handler (the cover stage's swipe and taps) tests plain
 * view bounds and treats a background-less view group as transparent. The root has no background and is not clickable,
 * so the rest of the strip reaches the cover below; `ReactHitSlopView` does the same for React Native's own hit test.
 */
class NativeHeaderView(context: Context, appContext: AppContext) : ExpoView(context, appContext), ReactHitSlopView {
    private val onAction by EventDispatcher<Map<String, Any>>()

    private val density = resources.displayMetrics.density

    // ── Props, applied in one batch (commit) ────────────────────────────────
    private var together = -1
    private var playingOn = ""
    private var playingKind = "phone"
    private var waveColor = Color.WHITE
    private var propsDirty = false

    private class Chip(val action: String, val icon: String, val text: String, val label: String, val iconColor: Int)

    private var chips: List<Chip> = emptyList()
    private var textWidths: List<Float> = emptyList()

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val glyphs = GlyphPainter(density)
    private val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val rect = RectF()
    private var removeFonts: (() -> Unit)? = null
    private val access = Access(this)

    /** A touch target: the grabber (index 0) or a chip (1..), sized to its rectangle. It reports to the root. */
    private inner class Zone(val slot: Int) : View(context) {
        init {
            isClickable = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }

        override fun onTouchEvent(event: MotionEvent): Boolean = touch(event.actionMasked, left + event.x, top + event.y)
    }

    private val zones = List(MAX_CHIPS + 1) { Zone(it) }

    init {
        // No background: Gesture Handler counts a background-less view group as transparent to touches.
        setWillNotDraw(false)
        ViewCompat.setAccessibilityDelegate(this, access)
        applyFonts()
        // Later children are on top, as the chips are over the grabber in React Native.
        for (z in zones) addView(z, LinearLayout.LayoutParams(0, 0))
        layoutZones()
    }

    private val slopRect = Rect()

    /** Only the grabber (with its slop) and the chips are this view's target for React Native's touch routing. */
    override val hitSlopRect: Rect
        get() {
            val box = HeaderGeometry.targetBox(width / density, textWidths)
            val top = ((box.top + HeaderGeometry.ORIGIN) * density).roundToInt()
            slopRect.set(
                -(box.left * density).roundToInt(),
                -top,
                (box.right * density).roundToInt() - width,
                ((box.bottom + HeaderGeometry.ORIGIN) * density).roundToInt() - height,
            )
            return slopRect
        }

    /** Sizes each zone to the rectangle of the control it stands for; the unused ones are gone. */
    private fun layoutZones() {
        val w = width / density
        val oy = HeaderGeometry.ORIGIN
        for (z in zones) {
            val r = when {
                z.slot == 0 -> HeaderGeometry.grabberHit(w)
                z.slot - 1 < chips.size -> HeaderGeometry.chipRect(z.slot - 1, textWidths.getOrElse(z.slot - 1) { 0f }, w)
                else -> null
            }
            if (r == null || width <= 0) {
                z.visibility = View.GONE
                continue
            }
            z.visibility = View.VISIBLE
            val l = (r.left * density).roundToInt()
            val t = ((r.top + oy) * density).roundToInt()
            val rt = (r.right * density).roundToInt()
            val b = ((r.bottom + oy) * density).roundToInt()
            z.measure(MeasureSpec.makeMeasureSpec(rt - l, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(b - t, MeasureSpec.EXACTLY))
            z.layout(l, t, rt, b)
        }
    }

    // ── Props ───────────────────────────────────────────────────────────────

    fun setTogether(count: Int?) { together = count ?: -1; propsDirty = true }
    fun setPlayingOn(name: String?) { playingOn = name.orEmpty(); propsDirty = true }
    fun setPlayingKind(kind: String?) { playingKind = kind ?: "phone"; propsDirty = true }
    fun setWaveColor(hex: String?) {
        waveColor = runCatching { Color.parseColor(hex) }.getOrDefault(Color.WHITE)
        propsDirty = true
    }

    fun commit() {
        if (!propsDirty) return
        propsDirty = false
        chips = buildList {
            if (together >= 0) {
                add(Chip("together", "account-multiple", "Listening together · $together", "Listening together, $together in the room", Color.WHITE))
            }
            if (playingOn.isNotEmpty()) {
                add(Chip("playingOn", if (playingKind == "web") "laptop" else "cellphone", "Playing on $playingOn", "Playing on $playingOn. Choose a device", waveColor))
            }
        }
        measureTexts()
        layoutZones()
        access.invalidateRoot()
        invalidate()
    }

    private fun applyFonts() {
        textPaint.typeface = IslandFonts.semibold
        // React Native converts sp with the platform (nonlinear above 100% from Android 14), not density x fontScale.
        textPaint.textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, TEXT_SP, resources.displayMetrics)
        // The app's SF Pro tracking (`sfTracking(13)`), in em.
        textPaint.letterSpacing = -0.08f / TEXT_SP
    }

    private fun measureTexts() {
        textWidths = chips.map { textPaint.measureText(it.text) / density }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (removeFonts == null) removeFonts = IslandFonts.load(context) { post { applyFonts(); measureTexts(); layoutZones(); invalidate() } }
    }

    override fun onDetachedFromWindow() {
        removeFonts?.invoke()
        removeFonts = null
        super.onDetachedFromWindow()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = layoutZones()

    override fun dispatchHoverEvent(event: MotionEvent): Boolean = access.dispatchHoverEvent(event) || super.dispatchHoverEvent(event)

    // ── Touch ───────────────────────────────────────────────────────────────

    /** What lies at ([x], [y]) in this view's pixels; the stack starts [HeaderGeometry.ORIGIN] below the view's top. */
    private fun targetAt(x: Float, y: Float): Target =
        HeaderGeometry.hit(x / density, y / density - HeaderGeometry.ORIGIN, width / density, textWidths)

    private var pressed: Target = Target.None

    /** A [Zone]'s touch, in this view's pixels. The zones are the only children, so nothing else lands here. */
    private fun touch(action: Int, x: Float, y: Float): Boolean {
        when (action) {
            MotionEvent.ACTION_DOWN -> {
                pressed = targetAt(x, y)
                return pressed != Target.None
            }
            MotionEvent.ACTION_UP -> {
                val t = pressed
                pressed = Target.None
                // The press counts when the finger is still on what it pressed (Pressable would keep it a little longer).
                if (t != Target.None && targetAt(x, y) == t) emit(t)
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                pressed = Target.None
                return true
            }
        }
        return pressed != Target.None
    }

    private fun emit(t: Target) {
        val action = when (t) {
            Target.Back -> "back"
            is Target.Chip -> chips.getOrNull(t.index)?.action ?: return
            Target.None -> return
        }
        onAction(mapOf("action" to action))
    }

    // ── Drawing ─────────────────────────────────────────────────────────────

    override fun onDraw(canvas: Canvas) {
        if (width <= 0) return
        val w = width / density
        // The stack starts ORIGIN below the view's top.
        canvas.save()
        canvas.translate(0f, HeaderGeometry.ORIGIN * density)
        // The grabber: 38 x 5, white at 0.55, 6 dp from the top.
        val gl = (w - HeaderGeometry.GRABBER_W) / 2f
        rect.set(gl * density, HeaderGeometry.GRABBER_V_MARGIN * density, (gl + HeaderGeometry.GRABBER_W) * density, (HeaderGeometry.GRABBER_V_MARGIN + HeaderGeometry.GRABBER_H) * density)
        fill.color = Color.argb(140, 255, 255, 255)
        canvas.drawRoundRect(rect, 3f * density, 3f * density, fill)

        val m = textPaint.fontMetrics
        for ((i, chip) in chips.withIndex()) {
            val r = HeaderGeometry.chipRect(i, textWidths.getOrElse(i) { 0f }, w)
            rect.set(r.left * density, r.top * density, r.right * density, r.bottom * density)
            fill.color = Color.argb(89, 0, 0, 0)
            canvas.drawRoundRect(rect, 15f * density, 15f * density, fill)
            val cy = (r.top + r.bottom) / 2f
            glyphs.draw(canvas, iconGlyph(chip.icon), HeaderGeometry.CHIP_ICON, r.left + HeaderGeometry.CHIP_PAD_X + HeaderGeometry.CHIP_ICON / 2f, cy, chip.iconColor)
            // Half a pixel of slack: the width went px -> dp -> px and must not cut a name that fits.
            val room = HeaderGeometry.chipTextRoom(r.right - r.left) * density + 0.5f
            val text = TextUtils.ellipsize(chip.text, textPaint, room, TextUtils.TruncateAt.END)
            val x = (r.left + HeaderGeometry.CHIP_PAD_X + HeaderGeometry.CHIP_ICON + HeaderGeometry.CHIP_ICON_GAP) * density
            // React Native's Text keeps the font padding: the line is top..bottom, centred in the chip.
            canvas.drawText(text, 0, text.length, x, cy * density - (m.top + m.bottom) / 2f, textPaint)
        }
        canvas.restore()
    }

    private fun iconGlyph(name: String) = when (name) {
        "laptop" -> IconGlyphs.MCI_LAPTOP
        "cellphone" -> IconGlyphs.MCI_CELLPHONE
        else -> IconGlyphs.MCI_ACCOUNT_MULTIPLE
    }

    // ── Accessibility ───────────────────────────────────────────────────────

    private inner class Access(host: View) : ExploreByTouchHelper(host) {
        // 0 is the grabber, 1.. are the chips.
        override fun getVirtualViewAt(x: Float, y: Float): Int = when (val t = targetAt(x, y)) {
            Target.None -> INVALID_ID
            Target.Back -> 0
            is Target.Chip -> t.index + 1
        }

        override fun getVisibleVirtualViews(out: MutableList<Int>) {
            out += 0
            for (i in chips.indices) out += i + 1
        }

        override fun onPopulateNodeForVirtualView(id: Int, node: AccessibilityNodeInfoCompat) {
            val w = width / density
            val r = if (id == 0) HeaderGeometry.grabberHit(w) else HeaderGeometry.chipRect(id - 1, textWidths.getOrElse(id - 1) { 0f }, w)
            val oy = HeaderGeometry.ORIGIN
            node.setBoundsInParent(Rect((r.left * density).roundToInt(), ((r.top + oy) * density).roundToInt(), (r.right * density).roundToInt(), ((r.bottom + oy) * density).roundToInt()))
            node.className = "android.widget.Button"
            node.isClickable = true
            node.addAction(AccessibilityNodeInfoCompat.ACTION_CLICK)
            node.contentDescription = if (id == 0) "Close player" else chips.getOrNull(id - 1)?.label.orEmpty()
        }

        override fun onPerformActionForVirtualView(id: Int, action: Int, arguments: Bundle?): Boolean {
            if (action != AccessibilityNodeInfoCompat.ACTION_CLICK) return false
            val t: Target = if (id == 0) Target.Back else if (id - 1 in chips.indices) Target.Chip(id - 1) else return false
            emit(t)
            sendEventForVirtualView(id, AccessibilityEvent.TYPE_VIEW_CLICKED)
            return true
        }
    }

    private companion object {
        const val TEXT_SP = 13f
        const val MAX_CHIPS = 2
    }
}
