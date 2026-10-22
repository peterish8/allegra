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
import android.text.TextPaint
import android.text.TextUtils
import android.util.TypedValue
import android.view.MotionEvent
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.customview.widget.ExploreByTouchHelper
import com.lyricflow.app.island.IslandFonts
import com.lyricflow.app.queue.QueueParser
import com.lyricflow.app.queue.QueueTile
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.roundToInt
import com.lyricflow.app.views.TrackRowGeometry as G

/**
 * One song row of the Library and the download lists, drawn in Kotlin: the same row as `TrackRow` in `StreamItems.tsx`
 * (cover with the playing disc, title, meta line, a download's progress line, an optional trailing button), which stays
 * the fallback for iOS, builds without this view and large system font sizes. One view per recycled list cell: it draws
 * nothing it was not given and runs a frame loop only while a cover fades in.
 *
 * It decides nothing: a tap, a long press and the trailing button come back as events and JavaScript runs the same
 * handlers as before. The press is a Pressable's: lit at once, kept alive within 20 dp of the row (30 below), a long
 * press after 500 ms, and a scroll that takes the touch cancels it.
 */
class NativeTrackRowView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onPress by EventDispatcher<Map<String, Any>>()
    private val onLongPress by EventDispatcher<Map<String, Any>>()
    private val onTrailing by EventDispatcher<Map<String, Any>>()

    private val density = resources.displayMetrics.density
    private val main = Handler(Looper.getMainLooper())

    // ── Props, applied in one batch (commit) ────────────────────────────────
    private var title = ""
    private var meta = ""
    private var label = ""
    private var cover: String? = null
    private var base = 0xFF282828.toInt()
    private var mid = 0xFF282828.toInt()
    private var spark = 0xFF282828.toInt()
    private var glyph = "♪"
    private var variant = 0
    private var current = false
    private var progress = -1f
    private var trailing = ""
    private var trailingLabel = ""
    private var paletteJson = ""
    private var appliedPaletteJson = ""
    private var propsDirty = false

    private class Colors(
        val ink: Int = 0xFFF4F1EA.toInt(),
        val inkSoft: Int = 0xFFD1D0C9.toInt(),
        val inkMuted: Int = 0xFF8E9498.toInt(),
        val wave: Int = 0xFFD9E66A.toInt(),
        val waveInk: Int = 0xFF17180D.toInt(),
        val bg: Int = 0xFF0A0B0E.toInt(),
        val pressed: Int = 0x14FFFFFF,
    )

    private var colors = Colors()

    // ── Touch state ─────────────────────────────────────────────────────────
    private var target = NONE
    private var alive = false
    private var longFired = false
    private val longRunnable = Runnable {
        if (target == ROW && alive) {
            longFired = true
            onLongPress(emptyMap())
        }
    }

    // ── Drawing ─────────────────────────────────────────────────────────────
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val metaPaint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val glyphs = GlyphPainter(density)
    private val rect = RectF()
    private val clip = Path()
    private val art = G.ART * density
    private val covers = CoverPainter(context, art, 10f * density, FADE_MS)
    private var coverFading = false
    private val coverLanded = Runnable { invalidate() }
    private var tile = QueueTile(base, mid, spark, glyph, variant)
    private var titleText: CharSequence = ""
    private var metaText: CharSequence = ""
    private var fontRemover: (() -> Unit)? = null
    private val access = Access(this)

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setWillNotDraw(false)
        ViewCompat.setAccessibilityDelegate(this, access)
        applyFonts()
    }

    // ── Props ───────────────────────────────────────────────────────────────

    fun setTitle(v: String?) { title = v.orEmpty(); propsDirty = true }
    fun setMeta(v: String?) { meta = v.orEmpty(); propsDirty = true }
    fun setLabel(v: String?) { label = v.orEmpty(); propsDirty = true }
    fun setCover(v: String?) { cover = v?.takeIf { it.isNotEmpty() }; propsDirty = true }
    fun setBase(v: String?) { base = QueueParser.hex(v.orEmpty()); propsDirty = true }
    fun setMid(v: String?) { mid = QueueParser.hex(v.orEmpty()); propsDirty = true }
    fun setSpark(v: String?) { spark = QueueParser.hex(v.orEmpty()); propsDirty = true }
    fun setGlyph(v: String?) { glyph = v?.takeIf { it.isNotEmpty() } ?: "♪"; propsDirty = true }
    fun setVariant(v: Int?) { variant = v ?: 0; propsDirty = true }
    fun setCurrent(on: Boolean?) { current = on ?: false; propsDirty = true }
    fun setProgress(v: Double?) { progress = (v ?: -1.0).toFloat(); propsDirty = true }
    fun setTrailing(v: String?) { trailing = v.orEmpty(); propsDirty = true }
    fun setTrailingLabel(v: String?) { trailingLabel = v.orEmpty(); propsDirty = true }
    fun setPalette(json: String?) { paletteJson = json.orEmpty(); propsDirty = true }

    fun commit() {
        if (!propsDirty) return
        propsDirty = false
        if (paletteJson != appliedPaletteJson) {
            appliedPaletteJson = paletteJson
            colors = parsePalette(paletteJson)
        }
        tile = QueueTile(base, mid, spark, glyph, variant)
        // A recycled cell shows a different song: the generated cover of the last one is not kept.
        covers.keepOnly(setOf("$label|$title"))
        buildText()
        access.invalidateRoot()
        invalidate()
    }

    private fun parsePalette(json: String): Colors {
        if (json.isEmpty()) return Colors()
        return try {
            val o = JSONObject(json)
            val d = Colors()
            fun c(key: String, fallback: Int) = if (o.has(key)) runCatching { Color.parseColor(o.getString(key)) }.getOrDefault(fallback) else fallback
            Colors(c("ink", d.ink), c("inkSoft", d.inkSoft), c("inkMuted", d.inkMuted), c("wave", d.wave), c("waveInk", d.waveInk), c("bg", d.bg), c("pressed", d.pressed))
        } catch (_: Exception) {
            Colors()
        }
    }

    // ── Text ────────────────────────────────────────────────────────────────

    private fun applyFonts() {
        titlePaint.typeface = IslandFonts.semibold
        metaPaint.typeface = IslandFonts.regular
        // React Native converts sp with the platform (nonlinear above 100% from Android 14), not density x fontScale.
        titlePaint.textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, TITLE_SP, resources.displayMetrics)
        metaPaint.textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, META_SP, resources.displayMetrics)
        // The app's SF Pro tracking (`sfTracking`: -0.32 at 16, -0.08 at 13), in em.
        titlePaint.letterSpacing = -0.32f / TITLE_SP
        metaPaint.letterSpacing = -0.08f / META_SP
    }

    private fun buildText() {
        val avail = max(0f, (G.textRight(width / density, trailing.isNotEmpty()) - G.textLeft()) * density)
        titleText = TextUtils.ellipsize(title, titlePaint, avail, TextUtils.TruncateAt.END)
        metaText = TextUtils.ellipsize(meta, metaPaint, avail, TextUtils.TruncateAt.END)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        CoverCache.addListener(coverLanded)
        if (fontRemover == null) {
            fontRemover = IslandFonts.load(context) { main.post { applyFonts(); buildText(); invalidate() } }
        }
    }

    override fun onDetachedFromWindow() {
        CoverCache.removeListener(coverLanded)
        main.removeCallbacks(longRunnable)
        clearTouch()
        fontRemover?.invoke()
        fontRemover = null
        super.onDetachedFromWindow()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        buildText()
    }

    override fun dispatchHoverEvent(event: MotionEvent): Boolean = access.dispatchHoverEvent(event) || super.dispatchHoverEvent(event)

    // ── Touch ───────────────────────────────────────────────────────────────

    private fun clearTouch() {
        main.removeCallbacks(longRunnable)
        target = NONE
        alive = false
        longFired = false
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val x = event.x / density
        val y = event.y / density
        val w = width / density
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                target = if (trailing.isNotEmpty() && G.onTrailing(x, y, w)) TRAILING else ROW
                alive = true
                longFired = false
                if (target == ROW) main.postDelayed(longRunnable, G.LONG_PRESS_MS)
                invalidate()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (target == NONE) return false
                val now = if (target == TRAILING) G.trailingAlive(x, y, w) else G.rowAlive(x, y, w)
                if (now != alive) {
                    alive = now
                    // Pressability stops the long press when the finger leaves, and does not restart it on return.
                    if (!now) main.removeCallbacks(longRunnable)
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                val t = target
                val fire = alive && !longFired
                clearTouch()
                invalidate()
                if (fire) {
                    when (t) {
                        ROW -> onPress(emptyMap())
                        TRAILING -> onTrailing(emptyMap())
                    }
                }
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                clearTouch()
                invalidate()
                return true
            }
        }
        return target != NONE
    }

    // ── Drawing ─────────────────────────────────────────────────────────────

    override fun onDraw(canvas: Canvas) {
        coverFading = false
        if (width <= 0 || height <= 0) return
        val d = density
        val w = width / d
        val hasTrailing = trailing.isNotEmpty()
        // The row is 64 dp high; a taller or shorter view centres the same row (JavaScript sizes it to 64).
        val oy = (height / d - G.HEIGHT) / 2f
        canvas.save()
        canvas.translate(0f, oy * d)

        if (target == ROW && alive) {
            fill.color = colors.pressed
            canvas.drawRect(0f, 0f, width.toFloat(), G.HEIGHT * d, fill)
        }

        // The cover, and the playing disc hanging off its corner.
        val artLeft = G.PAD_X * d
        val artTop = G.artTop() * d
        if (covers.draw(canvas, cover, tile, "$label|$title", artLeft, artTop)) coverFading = true
        if (current) drawPlayingDisc(canvas)

        // The text, centred as a block. React Native's Text keeps the font padding: a line is top..bottom.
        val tm = titlePaint.fontMetrics
        val mm = metaPaint.fontMetrics
        val titleH = (tm.bottom - tm.top) / d
        val metaH = (mm.bottom - mm.top) / d
        val showProgress = progress >= 0f
        val blockTop = G.blockTop(G.blockHeight(titleH, metaH, showProgress))
        val textX = G.textLeft() * d
        titlePaint.color = if (current) colors.wave else colors.ink
        canvas.drawText(titleText, 0, titleText.length, textX, blockTop * d - tm.top, titlePaint)
        metaPaint.color = colors.inkMuted
        val metaTop = blockTop + titleH + G.META_TOP
        canvas.drawText(metaText, 0, metaText.length, textX, metaTop * d - mm.top, metaPaint)
        if (showProgress) drawProgress(canvas, metaTop + metaH + G.PROGRESS_TOP, G.textRight(w, hasTrailing))

        if (hasTrailing) drawTrailing(canvas, w)
        canvas.restore()
        if (coverFading) postInvalidateOnAnimation()
    }

    private fun drawPlayingDisc(canvas: Canvas) {
        val d = density
        val cx = G.dotCenterX() * d
        val cy = G.dotCenterY() * d
        fill.color = colors.bg
        canvas.drawCircle(cx, cy, G.DOT / 2f * d, fill)
        fill.color = colors.wave
        canvas.drawCircle(cx, cy, (G.DOT / 2f - G.DOT_RING) * d, fill)
        glyphs.draw(canvas, IconGlyphs.ION_VOLUME_MEDIUM, G.DOT_ICON, G.dotCenterX(), G.dotCenterY(), colors.waveInk)
    }

    /** A download's hairline: a 2 dp track with the fill scaled from its left edge. */
    private fun drawProgress(canvas: Canvas, topDp: Float, rightDp: Float) {
        val d = density
        val left = G.textLeft() * d
        val right = rightDp * d
        rect.set(left, topDp * d, right, (topDp + G.PROGRESS_H) * d)
        canvas.save()
        clip.reset()
        clip.addRoundRect(rect, d, d, Path.Direction.CW)
        canvas.clipPath(clip)
        fill.color = colors.pressed
        canvas.drawRect(rect, fill)
        fill.color = colors.wave
        canvas.drawRect(rect.left, rect.top, rect.left + rect.width() * G.progressFill(progress), rect.bottom, fill)
        canvas.restore()
    }

    private fun drawTrailing(canvas: Canvas, w: Float) {
        val d = density
        val cx = G.trailLeft(w) + G.TRAIL / 2f
        val cy = G.trailTop() + G.TRAIL / 2f
        val pressed = target == TRAILING && alive
        canvas.save()
        if (pressed) canvas.scale(G.PRESS_SCALE, G.PRESS_SCALE, cx * d, cy * d)
        val color = if (pressed) withAlpha(colors.inkSoft, 0.8f) else colors.inkSoft
        glyphs.draw(canvas, IconGlyphs.ION_REFRESH, G.TRAIL_ICON, cx, cy, color)
        canvas.restore()
    }

    private fun withAlpha(color: Int, a: Float) = Color.argb((255 * a).roundToInt(), Color.red(color), Color.green(color), Color.blue(color))

    // ── Accessibility ───────────────────────────────────────────────────────

    private inner class Access(host: View) : ExploreByTouchHelper(host) {
        // 0 is the row, 1 is the trailing button.
        override fun getVirtualViewAt(x: Float, y: Float): Int {
            val oy = (height / density - G.HEIGHT) / 2f
            return if (trailing.isNotEmpty() && G.onTrailing(x / density, y / density - oy, width / density)) 1 else 0
        }

        override fun getVisibleVirtualViews(out: MutableList<Int>) {
            out += 0
            if (trailing.isNotEmpty()) out += 1
        }

        override fun onPopulateNodeForVirtualView(id: Int, node: AccessibilityNodeInfoCompat) {
            node.className = "android.widget.Button"
            node.isClickable = true
            node.addAction(AccessibilityNodeInfoCompat.ACTION_CLICK)
            if (id == 1) {
                val w = width / density
                val oy = (height / density - G.HEIGHT) / 2f
                val l = ((G.trailLeft(w) - G.TRAIL_SLOP) * density).roundToInt()
                val t = ((G.trailTop() - G.TRAIL_SLOP + oy) * density).roundToInt()
                node.setBoundsInParent(Rect(l, max(0, t), width, ((G.trailTop() + G.TRAIL + G.TRAIL_SLOP + oy) * density).roundToInt().coerceAtMost(height)))
                node.contentDescription = trailingLabel.ifEmpty { "More" }
            } else {
                node.setBoundsInParent(Rect(0, 0, width, height))
                node.contentDescription = label.ifEmpty { title }
                node.isLongClickable = true
                node.addAction(AccessibilityNodeInfoCompat.ACTION_LONG_CLICK)
            }
        }

        override fun onPerformActionForVirtualView(id: Int, action: Int, arguments: Bundle?): Boolean = when {
            id == 1 && action == AccessibilityNodeInfoCompat.ACTION_CLICK -> { onTrailing(emptyMap()); true }
            id == 0 && action == AccessibilityNodeInfoCompat.ACTION_CLICK -> { onPress(emptyMap()); true }
            id == 0 && action == AccessibilityNodeInfoCompat.ACTION_LONG_CLICK -> { onLongPress(emptyMap()); true }
            else -> false
        }
    }

    private companion object {
        const val TITLE_SP = 16f
        const val META_SP = 13f
        // The cover's cross-dissolve: `Motion.duration.base`.
        const val FADE_MS = 240L
        const val NONE = 0
        const val ROW = 1
        const val TRAILING = 2
    }
}
