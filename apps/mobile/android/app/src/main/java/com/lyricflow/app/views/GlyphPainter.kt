package com.lyricflow.app.views

import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import androidx.core.graphics.PathParser

/**
 * Draws the vector-icon glyph outlines in `IconGlyphs` (SVG paths on a 512 grid centred on (0, 0), y down) at a size, a
 * centre, a rotation and a scale. Parsed paths are cached for the process; a path that fails to parse draws nothing.
 */
internal class GlyphPainter(private val density: Float) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val matrix = Matrix()
    private val scratch = Path()

    /** A glyph [sizeDp] big centred on ([cxDp], [cyDp]) (view coordinates in dp), turned [rotateDeg] and scaled by [scale] about its centre. */
    fun draw(canvas: Canvas, data: String, sizeDp: Float, cxDp: Float, cyDp: Float, color: Int, rotateDeg: Float = 0f, scale: Float = 1f) {
        val path = paths.getOrPut(data) { runCatching { PathParser.createPathFromPathData(data) }.getOrNull() } ?: return
        val k = sizeDp * density / IconGlyphs.GRID * scale
        matrix.setScale(k, k)
        if (rotateDeg != 0f) matrix.postRotate(rotateDeg)
        matrix.postTranslate(cxDp * density, cyDp * density)
        scratch.reset()
        path.transform(matrix, scratch)
        paint.color = color
        canvas.drawPath(scratch, paint)
    }

    private companion object {
        val paths = HashMap<String, Path?>()
    }
}
