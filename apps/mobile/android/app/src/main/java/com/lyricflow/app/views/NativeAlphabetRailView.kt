package com.lyricflow.app.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.os.Bundle
import android.os.SystemClock
import android.text.TextPaint
import android.util.TypedValue
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.animation.PathInterpolator
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import com.facebook.react.touch.ReactHitSlopView
import com.lyricflow.app.island.IslandFonts
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The Library's A–Z rail, drawn in Kotlin with the look and gestures of `AlphabetRail.tsx` (which stays as the fallback
 * for iOS and builds without this view): a glass pill of letters down the right edge, a thumb that slides along it, and
 * the large letter in a disc beside the thumb (it fades in over 120 ms and out over 160 ms).
 *
 * The view decides nothing: each new letter under the thumb comes back as `onPick(index)` and JavaScript runs the same
 * handler (the selection haptic and the list's jump). The view is larger than the rail (the bubble sits outside it);
 * only the rail takes touches, the rest of the view lets them through.
 */
class NativeAlphabetRailView(context: Context, appContext: AppContext) : ExpoView(context, appContext), ReactHitSlopView {
    private val onPick by EventDispatcher<Map<String, Any>>()

    private val density = resources.displayMetrics.density
    private val hairlineDp = max(1f, (0.4f * density).roundToInt().toFloat()) / density

    /**
     * React Native finds the target of a touch by walking views whose children may lie outside their parent (overflow
     * is visible), so this view, which is larger than the rail to make room for the bubble, would otherwise be the
     * target of taps on the list rows beside the rail. A negative hit slop shrinks its target to the rail itself.
     */
    override val hitSlopRect: Rect = Rect(
        -(AlphabetRailMath.REACH_LEFT * density).roundToInt(),
        -(AlphabetRailMath.REACH_V * density).roundToInt(),
        0,
        -(AlphabetRailMath.REACH_V * density).roundToInt(),
    )

    // ── Props, applied in one batch (commit) ────────────────────────────────
    private var lettersJson = ""
    private var appliedLettersJson = ""
    private var paletteJson = ""
    private var appliedPaletteJson = ""
    private var propsDirty = false
    private var letters: List<RailLetter> = emptyList()
    private var lineH = AlphabetRailMath.LETTER_H

    private var inkSoft = Color.LTGRAY
    private var wave = Color.YELLOW
    private var waveInk = Color.BLACK

    // ── Touch state ─────────────────────────────────────────────────────────
    private var touching = false
    private var active = -1
    private var lastPicked = -1
    private var bubbleLetter = ""
    private var bubbleY = 0f

    // ── The bubble's fade ───────────────────────────────────────────────────
    private var bubbleAlpha = 0f
    private var fadeFrom = 0f
    private var fadeTo = 0f
    private var fadeStart = 0L
    private val ease = PathInterpolator(0.45f, 0f, 0.55f, 1f)

    // ── Frame loop ──────────────────────────────────────────────────────────
    private var visible = true
    private var framePosted = false
    private val frame = Choreographer.FrameCallback {
        framePosted = false
        val duration = if (fadeTo > fadeFrom) FADE_IN_MS else FADE_OUT_MS
        val t = ((SystemClock.uptimeMillis() - fadeStart) / duration.toFloat()).coerceIn(0f, 1f)
        bubbleAlpha = fadeFrom + (fadeTo - fadeFrom) * ease.getInterpolation(t)
        invalidate()
        if (t < 1f) wake()
    }

    // ── Drawing ─────────────────────────────────────────────────────────────
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val letterPaint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val bubblePaint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()
    private var removeFonts: (() -> Unit)? = null

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setWillNotDraw(false)
        ViewCompat.setAccessibilityDelegate(this, Access())
        applyFonts()
    }

    // ── Props ───────────────────────────────────────────────────────────────

    fun setLetters(json: String?) { lettersJson = json.orEmpty(); propsDirty = true }
    fun setPalette(json: String?) { paletteJson = json.orEmpty(); propsDirty = true }
    fun setLineHeight(dp: Double?) { lineH = (dp ?: AlphabetRailMath.LETTER_H.toDouble()).toFloat(); propsDirty = true }

    fun commit() {
        if (!propsDirty) return
        propsDirty = false
        if (paletteJson != appliedPaletteJson) {
            appliedPaletteJson = paletteJson
            runCatching {
                val o = JSONObject(paletteJson)
                inkSoft = Color.parseColor(o.getString("inkSoft"))
                wave = Color.parseColor(o.getString("wave"))
                waveInk = Color.parseColor(o.getString("waveInk"))
            }
        }
        if (lettersJson != appliedLettersJson) {
            appliedLettersJson = lettersJson
            val before = letters.getOrNull(lastPicked)
            letters = AlphabetRailMath.parse(lettersJson)
            // The letters changed under a thumb: the same letter is still the last pick, so it does not fire again.
            if (active >= letters.size) active = -1
            if (letters.getOrNull(lastPicked) != before) lastPicked = -1
        }
        invalidate()
    }

    private fun applyFonts() {
        letterPaint.typeface = IslandFonts.semibold
        bubblePaint.typeface = IslandFonts.bold
        letterPaint.textSize = sp(LETTER_SP)
        bubblePaint.textSize = sp(BUBBLE_SP)
        // The app's SF Pro tracking (`sfTracking`), in em: +0.07 dp at 11, -0.77 dp at 26.
        letterPaint.letterSpacing = 0.07f / LETTER_SP
        bubblePaint.letterSpacing = -0.77f / BUBBLE_SP
    }

    private fun sp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, resources.displayMetrics)

    // ── Lifecycle ───────────────────────────────────────────────────────────

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
            resumeFade()
            invalidate()
        } else {
            Choreographer.getInstance().removeFrameCallback(frame)
            framePosted = false
        }
    }

    /** A fade that was cut short by the view being hidden carries on from where it stopped. */
    private fun resumeFade() {
        if (bubbleAlpha == fadeTo) return
        fadeFrom = bubbleAlpha
        fadeStart = SystemClock.uptimeMillis()
        wake()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (removeFonts == null) removeFonts = IslandFonts.load(context) { post { applyFonts(); invalidate() } }
        resumeFade()
    }

    override fun onDetachedFromWindow() {
        Choreographer.getInstance().removeFrameCallback(frame)
        framePosted = false
        removeFonts?.invoke()
        removeFonts = null
        // A thumb cut short by the detach must not leave the bubble up.
        touching = false
        active = -1
        lastPicked = -1
        bubbleAlpha = 0f
        fadeFrom = 0f
        fadeTo = 0f
        super.onDetachedFromWindow()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    // ── Geometry in px ──────────────────────────────────────────────────────

    private fun railLeft() = AlphabetRailMath.REACH_LEFT * density
    private fun railTop() = AlphabetRailMath.REACH_V * density
    private fun railHeightPx() = AlphabetRailMath.railHeight(letters.size, hairlineDp, lineH) * density

    // ── Touch ───────────────────────────────────────────────────────────────

    /** Moves the thumb to [y] (view coordinates): the letter under it, the bubble beside it, and a pick when it is new. */
    private fun moveTo(y: Float) {
        val h = railHeightPx()
        val at = AlphabetRailMath.pick(y - railTop(), h, letters.size)
        val entry = letters.getOrNull(at) ?: return
        active = at
        // TalkBack steps carry on from where the thumb is.
        stepFrom = at
        bubbleLetter = entry.letter
        bubbleY = AlphabetRailMath.bubbleY(y - railTop(), h)
        fade(1f)
        if (at != lastPicked) {
            lastPicked = at
            onPick(mapOf("index" to entry.index))
        }
        invalidate()
    }

    private fun release() {
        touching = false
        active = -1
        lastPicked = -1
        fade(0f)
        invalidate()
    }

    private fun fade(to: Float) {
        if (fadeTo == to) return
        fadeFrom = bubbleAlpha
        fadeTo = to
        fadeStart = SystemClock.uptimeMillis()
        wake()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                // Only the rail takes touches; the room around it for the bubble lets them through.
                val top = railTop()
                if (letters.size < MIN_LETTERS || event.x < railLeft() || event.y < top || event.y > top + railHeightPx()) return false
                touching = true
                // The thumb on the rail is the rail's: the list under it must not scroll.
                parent?.requestDisallowInterceptTouchEvent(true)
                moveTo(event.y)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (!touching) return false
                moveTo(event.y)
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (!touching) return false
                release()
                return true
            }
        }
        return touching
    }

    // ── Drawing ─────────────────────────────────────────────────────────────

    override fun onDraw(canvas: Canvas) {
        if (letters.size < MIN_LETTERS || width <= 0) return
        val left = railLeft()
        val top = railTop()
        val h = railHeightPx()
        val r = AlphabetRailMath.RAIL_RADIUS * density
        rect.set(left, top, left + AlphabetRailMath.RAIL_W * density, top + h)
        fill.color = Color.argb(107, 10, 11, 14)
        canvas.drawRoundRect(rect, r, r, fill)
        // The hairline border is drawn inside the box.
        val hw = hairlineDp * density
        stroke.strokeWidth = hw
        stroke.color = Color.argb(26, 255, 255, 255)
        rect.inset(hw / 2f, hw / 2f)
        canvas.drawRoundRect(rect, r - hw / 2f, r - hw / 2f, stroke)

        // Letters on 15 dp lines (explicit lineHeight: the spare leading is split evenly above and below the glyphs).
        val m = letterPaint.fontMetrics
        val baseline = AlphabetRailMath.baselineInLine(m.ascent / density, m.descent / density, lineH) * density
        val cx = left + AlphabetRailMath.RAIL_W * density / 2f
        for ((i, l) in letters.withIndex()) {
            letterPaint.color = if (i == active) wave else inkSoft
            val tw = letterPaint.measureText(l.letter)
            canvas.drawText(l.letter, cx - tw / 2f, top + AlphabetRailMath.letterTop(i, hairlineDp, lineH) * density + baseline, letterPaint)
        }

        if (bubbleAlpha > 0.001f && bubbleLetter.isNotEmpty()) drawBubble(canvas, left, top)
    }

    private fun drawBubble(canvas: Canvas, railLeft: Float, railTop: Float) {
        val d = AlphabetRailMath.BUBBLE * density
        // Its right edge is 40 dp left of the rail's right edge.
        val right = railLeft + (AlphabetRailMath.RAIL_W - AlphabetRailMath.BUBBLE_RIGHT) * density
        val cx = right - d / 2f
        val cy = railTop + bubbleY * density
        val alpha = (255 * bubbleAlpha).roundToInt().coerceIn(0, 255)
        fill.color = Color.argb(alpha, Color.red(wave), Color.green(wave), Color.blue(wave))
        canvas.drawCircle(cx, cy, d / 2f, fill)
        bubblePaint.color = Color.argb(alpha, Color.red(waveInk), Color.green(waveInk), Color.blue(waveInk))
        val m = bubblePaint.fontMetrics
        val tw = bubblePaint.measureText(bubbleLetter)
        // React Native's Text keeps the font padding: the line is top..bottom, centred in the disc.
        canvas.drawText(bubbleLetter, cx - tw / 2f, cy - (m.top + m.bottom) / 2f, bubblePaint)
    }

    // ── Accessibility ───────────────────────────────────────────────────────

    private inner class Access : AccessibilityDelegateCompat() {
        override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
            super.onInitializeAccessibilityNodeInfo(host, info)
            info.className = "android.widget.SeekBar"
            info.contentDescription = "Jump to a letter"
            // The node is the rail, not the larger view that makes room for the bubble.
            val l = railLeft().roundToInt()
            val t = railTop().roundToInt()
            info.setBoundsInParent(Rect(l, t, l + (AlphabetRailMath.RAIL_W * density).roundToInt(), t + railHeightPx().roundToInt()))
            // The React Native rail had the label and the adjustable role but no way to move: letters can be stepped here.
            if (letters.isNotEmpty()) {
                info.stateDescription = letters.getOrNull(stepFrom)?.letter
                info.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_SCROLL_FORWARD)
                info.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_SCROLL_BACKWARD)
            }
        }

        override fun performAccessibilityAction(host: View, action: Int, args: Bundle?): Boolean {
            val delta = when (action) {
                AccessibilityNodeInfoCompat.ACTION_SCROLL_FORWARD -> 1
                AccessibilityNodeInfoCompat.ACTION_SCROLL_BACKWARD -> -1
                else -> return super.performAccessibilityAction(host, action, args)
            }
            val next = AlphabetRailMath.step(stepFrom, delta, letters.size)
            val entry = letters.getOrNull(next) ?: return false
            stepFrom = next
            onPick(mapOf("index" to entry.index))
            host.announceForAccessibility(entry.letter)
            return true
        }
    }

    /** The letter TalkBack last stepped to (-1 before any). */
    private var stepFrom = -1

    private companion object {
        const val MIN_LETTERS = 4
        const val LETTER_SP = 11f
        const val BUBBLE_SP = 26f
        const val FADE_IN_MS = 120L
        const val FADE_OUT_MS = 160L
    }
}
