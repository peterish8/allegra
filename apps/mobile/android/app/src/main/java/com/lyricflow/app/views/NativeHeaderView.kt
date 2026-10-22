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
 * The view spans the container's width, but only the grabber (with its wide slop) and the chips are its target for
 * React Native's hit test (`ReactHitSlopView`): the rest of the strip lets touches through to the cover below.
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

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setWillNotDraw(false)
        ViewCompat.setAccessibilityDelegate(this, access)
        applyFonts()
    }

    /**
     * Only the grabber (with its slop) and the chips are this view's target for React Native's touch routing: the rest
     * of the header's strip must reach the cover stage below. Negative values shrink the view's area, positive grow it.
     */
    override val hitSlopRect: Rect
        get() {
            val w = width / density
            val box = HeaderGeometry.targetBox(w, textWidths)
            return Rect(
                -(box.left * density).roundToInt(),
                -(box.top * density).roundToInt(),
                (box.right * density).roundToInt() - width,
                (box.bottom * density).roundToInt() - height,
            )
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
        if (removeFonts == null) removeFonts = IslandFonts.load(context) { post { applyFonts(); measureTexts(); invalidate() } }
    }

    override fun onDetachedFromWindow() {
        removeFonts?.invoke()
        removeFonts = null
        super.onDetachedFromWindow()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    override fun dispatchHoverEvent(event: MotionEvent): Boolean = access.dispatchHoverEvent(event) || super.dispatchHoverEvent(event)

    // ── Touch ───────────────────────────────────────────────────────────────

    private fun targetAt(x: Float, y: Float): Target = HeaderGeometry.hit(x / density, y / density, width / density, textWidths)

    private var pressed: Target = Target.None

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val t = targetAt(event.x, event.y)
                if (t == Target.None) return false
                pressed = t
                return true
            }
            MotionEvent.ACTION_UP -> {
                val t = pressed
                pressed = Target.None
                // The press counts when the finger is still on what it pressed (Pressable would keep it a little longer).
                if (t != Target.None && targetAt(event.x, event.y) == t) emit(t)
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
            val room = HeaderGeometry.chipTextRoom(r.right - r.left) * density
            val text = TextUtils.ellipsize(chip.text, textPaint, room, TextUtils.TruncateAt.END)
            val x = (r.left + HeaderGeometry.CHIP_PAD_X + HeaderGeometry.CHIP_ICON + HeaderGeometry.CHIP_ICON_GAP) * density
            // React Native's Text keeps the font padding: the line is top..bottom, centred in the chip.
            canvas.drawText(text, 0, text.length, x, cy * density - (m.top + m.bottom) / 2f, textPaint)
        }
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
            // The grabber's slop reaches above the view: its node stays inside the view.
            node.setBoundsInParent(Rect((r.left * density).roundToInt(), maxOf(0f, r.top * density).roundToInt(), (r.right * density).roundToInt(), (r.bottom * density).roundToInt()))
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
    }
}
