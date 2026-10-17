package com.lyricflow.app.island

import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import androidx.core.graphics.PathParser

/** The transport glyphs, as 24-unit paths (Material's rounded set), drawn straight onto the island's canvas. */
object IslandIcons {
    val play: Path = PathParser.createPathFromPathData(
        "M8,5.14v13.72c0,0.79 0.87,1.27 1.54,0.84l10.78,-6.86c0.62,-0.39 0.62,-1.29 0,-1.69L9.54,4.3C8.87,3.87 8,4.35 8,5.14z",
    )
    val pause: Path = PathParser.createPathFromPathData(
        "M7,5h2.5a1,1 0 0 1 1,1v12a1,1 0 0 1 -1,1H7a1,1 0 0 1 -1,-1V6a1,1 0 0 1 1,-1z" +
            "M14.5,5H17a1,1 0 0 1 1,1v12a1,1 0 0 1 -1,1h-2.5a1,1 0 0 1 -1,-1V6a1,1 0 0 1 1,-1z",
    )
    val next: Path = PathParser.createPathFromPathData(
        "M7.58,16.89l5.77,-4.07c0.56,-0.4 0.56,-1.24 0,-1.63L7.58,7.11C6.91,6.65 6,7.12 6,7.93v8.14c0,0.81 0.91,1.28 1.58,0.82z" +
            "M16,7v10c0,0.55 0.45,1 1,1s1,-0.45 1,-1V7c0,-0.55 -0.45,-1 -1,-1s-1,0.45 -1,1z",
    )
    val previous: Path = PathParser.createPathFromPathData(
        "M7,6c0.55,0 1,0.45 1,1v10c0,0.55 -0.45,1 -1,1s-1,-0.45 -1,-1V7c0,-0.55 0.45,-1 1,-1z" +
            "m3.66,6.82l5.77,4.07c0.66,0.47 1.58,-0.01 1.58,-0.82V7.93c0,-0.81 -0.91,-1.28 -1.58,-0.82l-5.77,4.07c-0.57,0.4 -0.57,1.24 0,1.64z",
    )

    private val matrix = Matrix()
    private val scratch = Path()

    /** Draws [icon] [size] pixels square, centred on ([cx], [cy]). Main thread only. */
    fun draw(canvas: Canvas, icon: Path, cx: Float, cy: Float, size: Float, paint: Paint) {
        val scale = size / 24f
        matrix.setScale(scale, scale)
        matrix.postTranslate(cx - size / 2f, cy - size / 2f)
        icon.transform(matrix, scratch)
        canvas.drawPath(scratch, paint)
    }
}
