package com.lyricflow.app.lyrics

import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import android.text.Layout
import android.text.SpannableString
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.LineHeightSpan
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

/** Where one word of a swept line sits in its layout, so a sweep can clip to exactly that word. */
class WordBox(val start: Int, val end: Int, val x0: Float, val x1: Float, val top: Float, val bottom: Float)

class RowLayout(
    val layout: StaticLayout?,
    /** The whole row: text (or equalizer) plus the gap above and below, px. */
    val height: Float,
    val words: Array<WordBox>,
)

/** Every line laid out for one width and style. Built off the main thread, drawn on it. */
class LyricsLayouts(
    val sheet: LyricsSheet,
    val config: LyricsConfig,
    val width: Int,
    val fontKey: Int,
    val rows: Array<RowLayout>,
) {
    val offsets = FloatArray(rows.size)
    var total = 0f
        private set

    init {
        var next = 0f
        for (i in rows.indices) {
            offsets[i] = next
            next += rows[i].height
        }
        total = next
    }

    /** Whether the same lines, style and width can keep these layouts for [other]'s timings. */
    fun reusableFor(other: LyricsSheet, key: String, widthPx: Int, font: Int): Boolean =
        widthPx == width && font == fontKey && key == config.layoutKey() && sheet.sameText(other)

    fun withSheet(next: LyricsSheet, nextConfig: LyricsConfig): LyricsLayouts =
        LyricsLayouts(next, nextConfig, width, fontKey, rows)

    companion object {
        /**
         * Lays every line out. [density] and [fontScale] turn the style's dp / sp into px the way React Native's Text does
         * (text and line height follow the system font size, the gap does not).
         */
        fun build(
            sheet: LyricsSheet,
            config: LyricsConfig,
            widthPx: Int,
            density: Float,
            fontScale: Float,
            face: Typeface,
            fontKey: Int,
            cancelled: () -> Boolean,
        ): LyricsLayouts? {
            val textWidth = (widthPx - 2 * config.padH * density).roundToInt().coerceAtLeast(1)
            val sizePx = config.fontSize * density * fontScale
            val lineHeightPx = (config.lineHeight * density * fontScale).roundToInt()
            val gapPx = config.gap * density
            val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                typeface = face
                textSize = sizePx
                color = Color.WHITE
                letterSpacing = config.tracking / config.fontSize
            }
            val alignment = when (config.align) {
                LyricsAlign.LEFT -> Layout.Alignment.ALIGN_NORMAL
                LyricsAlign.CENTER -> Layout.Alignment.ALIGN_CENTER
                LyricsAlign.RIGHT -> Layout.Alignment.ALIGN_OPPOSITE
            }
            val eqRow = LyricsMath.EQ_ROW_DP * density
            val out = arrayOfNulls<RowLayout>(sheet.rows.size)
            for ((i, row) in sheet.rows.withIndex()) {
                if (cancelled()) return null
                if (row.instrumental) {
                    out[i] = RowLayout(null, eqRow + 2 * gapPx, emptyArray())
                    continue
                }
                val text = titled(row.text, config.title, density, lineHeightPx)
                val builder = StaticLayout.Builder.obtain(text, 0, text.length, paint, textWidth)
                    .setAlignment(alignment)
                    .setIncludePad(false)
                    .setBreakStrategy(Layout.BREAK_STRATEGY_HIGH_QUALITY)
                    .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
                    .setTextDirection(TextDirectionHeuristics.FIRSTSTRONG_LTR)
                val layout = builder.build()
                val words = if (sheet.letters && row.hasSegments) wordBoxes(layout, text) else emptyArray()
                out[i] = RowLayout(layout, layout.height + 2 * gapPx, words)
            }
            @Suppress("UNCHECKED_CAST")
            return LyricsLayouts(sheet, config, widthPx, fontKey, out as Array<RowLayout>)
        }

        /** The text with its fixed line height, and the song's title glowing where it appears (the first match). */
        private fun titled(raw: String, title: String?, density: Float, lineHeightPx: Int): CharSequence {
            // The glow is only placed where the cleaned text and the raw text agree, so a sweep's character
            // offsets (which refer to the raw text) still land on the same letters.
            val cleaned = raw.replace(WHITESPACE, " ")
            val needle = title?.lowercase()?.trim().orEmpty()
            val at = if (needle.length >= 2 && cleaned.length == raw.length) cleaned.lowercase().indexOf(needle) else -1
            val span = SpannableString(if (at >= 0) cleaned else raw)
            span.setSpan(FixedLineHeight(lineHeightPx), 0, span.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
            if (at >= 0) span.setSpan(TitleGlow(10f * density), at, at + needle.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            return span
        }

        private val WHITESPACE = Regex("\\s+")

        /** The word runs of the line (split on whitespace) with where each sits. */
        private fun wordBoxes(layout: StaticLayout, text: CharSequence): Array<WordBox> {
            val boxes = ArrayList<WordBox>()
            var i = 0
            val n = text.length
            while (i < n) {
                while (i < n && text[i].isWhitespace()) i++
                val start = i
                while (i < n && !text[i].isWhitespace()) i++
                if (i > start) {
                    val line = layout.getLineForOffset(start)
                    val end = minOf(i, layout.getLineEnd(line))
                    val x0 = layout.getPrimaryHorizontal(start)
                    val x1 = if (end >= i) layout.getPrimaryHorizontal(i) else if (layout.getParagraphDirection(line) == Layout.DIR_RIGHT_TO_LEFT) layout.getLineLeft(line) else layout.getLineRight(line)
                    boxes += WordBox(start, minOf(i, end), x0, x1, layout.getLineTop(line).toFloat(), layout.getLineBottom(line).toFloat())
                }
            }
            return boxes.toTypedArray()
        }
    }
}

/** React Native's line height: the line is exactly this tall, with any extra shared above and below the glyphs. */
class FixedLineHeight(private val height: Int) : LineHeightSpan {
    override fun chooseHeight(text: CharSequence, start: Int, end: Int, spanstartv: Int, lineHeight: Int, fm: Paint.FontMetricsInt) {
        if (height <= 0) return
        if (fm.descent > height) {
            fm.descent = minOf(height, fm.descent)
            fm.bottom = fm.descent
            fm.ascent = 0
            fm.top = 0
        } else if (-fm.ascent + fm.descent > height) {
            fm.bottom = fm.descent
            fm.ascent = -height + fm.descent
            fm.top = fm.ascent
        } else if (-fm.ascent + fm.bottom > height) {
            fm.top = fm.ascent
            fm.bottom = fm.ascent + height
        } else if (-fm.top + fm.bottom > height) {
            fm.top = fm.bottom - height
        } else {
            val additional = height - (-fm.top + fm.bottom)
            val up = ceil(additional / 2.0).toInt()
            val down = floor(additional / 2.0).toInt()
            fm.top -= up
            fm.ascent -= up
            fm.bottom += down
            fm.descent += down
        }
    }
}

/** A soft white glow behind a run of text: the song's own title, wherever a line sings it. */
class TitleGlow(private val radius: Float) : CharacterStyle() {
    override fun updateDrawState(tp: android.text.TextPaint) {
        tp.setShadowLayer(radius, 0f, 0f, Color.argb(191, 255, 255, 255))
    }
}
