package com.lyricflow.app.views

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.Gravity
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import androidx.core.graphics.ColorUtils
import com.lyricflow.app.modules.PlayerBridge
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** Android's transport glyphs and press/morph motion, drawn on a transparent hardware canvas. */
class NativeTransportBarView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onPlayPause by EventDispatcher<Map<String, Any>>()
    private val onSkip by EventDispatcher<Map<String, Any>>()
    private val glyphPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val shape = Path()
    private var tint = Color.WHITE
    private var isPlaying = false
    private var morphProgress = 0f
    private val pressProgress = FloatArray(3)
    private val animators = arrayOfNulls<ValueAnimator>(3)
    private var nativeSkip = false

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setWillNotDraw(false)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        repeat(3) { index ->
            val slot = View(context).apply {
                isClickable = true
                isFocusable = true
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
                contentDescription = when (index) {
                    0 -> "Previous"
                    1 -> "Play"
                    else -> "Next"
                }
                setOnClickListener { activate(index) }
                setOnTouchListener { _, event ->
                    when (event.actionMasked) {
                        android.view.MotionEvent.ACTION_DOWN -> animatePress(index, true)
                        android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> animatePress(index, false)
                    }
                    false
                }
            }
            addView(slot, FrameLayout.LayoutParams(0, 0, Gravity.TOP or Gravity.LEFT))
        }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val width = MeasureSpec.getSize(widthMeasureSpec)
        val height = MeasureSpec.getSize(heightMeasureSpec).takeIf { it > 0 } ?: dp(72f).toInt()
        setMeasuredDimension(width, height)
        val slotWidth = width / 3
        for (index in 0 until 3) {
            val child = getChildAt(index)
            val left = slotWidth * index
            val right = if (index == 2) width else slotWidth * (index + 1)
            child.measure(MeasureSpec.makeMeasureSpec(right - left, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
        }
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        val width = right - left
        val height = bottom - top
        val slotWidth = width / 3
        for (index in 0 until 3) {
            val childLeft = slotWidth * index
            val childRight = if (index == 2) width else slotWidth * (index + 1)
            getChildAt(index).layout(childLeft, 0, childRight, height)
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val density = resources.displayMetrics.density
        val width = width / density
        val height = height / density
        if (width <= 0f || height <= 0f) return
        canvas.save()
        canvas.scale(density, density)
        drawSkip(canvas, width / 6f, height / 2f, -1, pressProgress[0])
        drawPlayPause(canvas, width / 2f + 5f, height / 2f, pressProgress[1])
        drawSkip(canvas, width * 5f / 6f, height / 2f, 1, pressProgress[2])
        canvas.restore()
    }

    fun setPlaying(value: Boolean) {
        if (isPlaying == value) return
        isPlaying = value
        val target = if (value) 1f else 0f
        ValueAnimator.ofFloat(morphProgress, target).apply {
            duration = 170L
            interpolator = DecelerateInterpolator(1.7f)
            addUpdateListener { morphProgress = it.animatedValue as Float; invalidate() }
            start()
        }
        getChildAt(1)?.contentDescription = if (value) "Pause" else "Play"
        invalidate()
    }

    fun setTint(value: String?) {
        tint = runCatching { Color.parseColor(value ?: "#ffffff") }.getOrDefault(Color.WHITE)
        invalidate()
    }

    fun setNativeSkip(value: Boolean) { nativeSkip = value }

    private fun animatePress(index: Int, down: Boolean) {
        animators[index]?.cancel()
        val target = if (down) 1f else 0f
        animators[index] = ValueAnimator.ofFloat(pressProgress[index], target).apply {
            duration = if (down) 85L else 150L
            interpolator = DecelerateInterpolator(1.6f)
            addUpdateListener { pressProgress[index] = it.animatedValue as Float; invalidate() }
            start()
        }
    }

    private fun activate(index: Int) {
        when (index) {
            1 -> onPlayPause(mapOf("playing" to isPlaying))
            else -> {
                val direction = if (index == 2) 1 else -1
                if (nativeSkip) {
                    val engine = PlayerBridge.getEngine() ?: return
                    val player = PlayerBridge.getPlayer()
                    val before = player?.currentMediaItemIndex
                    if (direction > 0) engine.skipToNext() else engine.skipToPrevious()
                    onSkip(mapOf("direction" to direction, "moved" to (player == null || player.currentMediaItemIndex != before)))
                } else {
                    onSkip(mapOf("direction" to direction, "moved" to true))
                }
            }
        }
    }

    private fun drawPlayPause(canvas: Canvas, centerX: Float, centerY: Float, pressed: Float) {
        val scale = 1f - pressed * 0.14f
        canvas.save()
        canvas.translate(centerX, centerY)
        canvas.scale(scale, scale)
        val playAlpha = (255 * (1f - morphProgress)).toInt()
        val pauseAlpha = (255 * morphProgress).toInt()
        if (playAlpha > 0) {
            glyphPaint.color = ColorUtils.setAlphaComponent(tint, playAlpha)
            shape.reset()
            shape.moveTo(-10f, -13f); shape.lineTo(13f, 0f); shape.lineTo(-10f, 13f); shape.close()
            canvas.drawPath(shape, glyphPaint)
        }
        if (pauseAlpha > 0) {
            glyphPaint.color = ColorUtils.setAlphaComponent(tint, pauseAlpha)
            val radius = 1.5f
            canvas.drawRoundRect(RectF(-9f, -13f, -2f, 13f), radius, radius, glyphPaint)
            canvas.drawRoundRect(RectF(3f, -13f, 10f, 13f), radius, radius, glyphPaint)
        }
        canvas.restore()
    }

    private fun drawSkip(canvas: Canvas, centerX: Float, centerY: Float, direction: Int, pressed: Float) {
        canvas.save()
        canvas.translate(centerX, centerY)
        canvas.scale(1f - pressed * 0.16f, 1f - pressed * 0.16f)
        if (direction < 0) canvas.scale(-1f, 1f)
        glyphPaint.color = tint
        // Two clean filled chevrons and a short end bar, matching the player’s lightweight Ionicons controls.
        shape.reset()
        shape.moveTo(-11f, -10f); shape.lineTo(0f, 0f); shape.lineTo(-11f, 10f); shape.close()
        shape.moveTo(0f, -10f); shape.lineTo(11f, 0f); shape.lineTo(0f, 10f); shape.close()
        canvas.drawPath(shape, glyphPaint)
        val radius = 1f
        canvas.drawRoundRect(RectF(12f, -10f, 15f, 10f), radius, radius, glyphPaint)
        canvas.restore()
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density
}
