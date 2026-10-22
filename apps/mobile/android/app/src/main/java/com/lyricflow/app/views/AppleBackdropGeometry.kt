package com.lyricflow.app.views

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToInt

/** Pure sizing, mask and transition rules for the Now Playing backdrop. */
internal object AppleBackdropGeometry {
    const val ROOM_WIDTH_PX = 48
    const val BLEED_DP = 120f
    const val BLUR_DP = 70f
    const val HERO_SHARE = 0.65f
    const val ROOM_FADE_MS = 1_200L
    const val HERO_FADE_MS = 500L
    val HERO_MASK_POSITIONS = floatArrayOf(0f, 0.75f, 0.92f, 1f)
    val HERO_MASK_ALPHAS = floatArrayOf(1f, 1f, 0.4f, 0f)

    data class Crop(val x: Float, val y: Float, val width: Float, val height: Float)
    data class RoomSize(val width: Int, val height: Int, val sigma: Float)

    /** The centre crop that fills [boxWidth] × [boxHeight] without stretching the cover. */
    fun coverCrop(imageWidth: Int, imageHeight: Int, boxWidth: Float, boxHeight: Float): Crop {
        require(imageWidth > 0 && imageHeight > 0 && boxWidth > 0f && boxHeight > 0f)
        val boxRatio = boxWidth / boxHeight
        return if (imageWidth.toFloat() / imageHeight > boxRatio) {
            val width = imageHeight * boxRatio
            Crop((imageWidth - width) / 2f, 0f, width, imageHeight.toFloat())
        } else {
            val height = imageWidth / boxRatio
            Crop(0f, (imageHeight - height) / 2f, imageWidth.toFloat(), height)
        }
    }

    /** A 48 px room bitmap stretched over the screen, with the full-size blur scaled to match it. */
    fun roomSize(boxWidthDp: Float, boxHeightDp: Float): RoomSize {
        require(boxWidthDp > 0f && boxHeightDp > 0f)
        val scale = ROOM_WIDTH_PX / boxWidthDp
        return RoomSize(ROOM_WIDTH_PX, max(1, (boxHeightDp * scale).roundToInt()), BLUR_DP * scale)
    }

    /** Three box passes approximate the small Gaussian radius used by the downsampled room. */
    fun blurRadius(sigma: Float): Int = ceil(sigma).toInt().coerceAtLeast(0)

    fun heroHeight(heightPx: Float): Float = (heightPx * HERO_SHARE).roundToInt().toFloat()

    /** The sharp hero loses up to 60% of its opacity as a sideways cover swipe pulls it away. */
    fun heroOpacity(hero: Float, shiftX: Float, width: Float): Float {
        val distance = if (width <= 0f) 1f else (kotlin.math.abs(shiftX) / width).coerceIn(0f, 1f)
        return (hero * (1f - 0.6f * distance)).coerceIn(0f, 1f)
    }

    /** The incoming artwork settles from 104% to 100% while its fade completes. */
    fun settleScale(fade: Float): Float = 1f + 0.04f * (1f - fade.coerceIn(0f, 1f))

    /** The inverse of the hero's dissolve, used to fade a canvas video back into the blurred room. */
    fun veilAlpha(position: Float): Float {
        val p = position.coerceIn(0f, 1f)
        return 1f - when {
            p <= HERO_MASK_POSITIONS[1] -> HERO_MASK_ALPHAS[1]
            p < HERO_MASK_POSITIONS[2] -> HERO_MASK_ALPHAS[1] +
                (HERO_MASK_ALPHAS[2] - HERO_MASK_ALPHAS[1]) *
                (p - HERO_MASK_POSITIONS[1]) / (HERO_MASK_POSITIONS[2] - HERO_MASK_POSITIONS[1])
            else -> HERO_MASK_ALPHAS[2] +
                (HERO_MASK_ALPHAS[3] - HERO_MASK_ALPHAS[2]) *
                (p - HERO_MASK_POSITIONS[2]) / (HERO_MASK_POSITIONS[3] - HERO_MASK_POSITIONS[2])
        }.coerceIn(0f, 1f)
    }

    fun fade(nowMs: Long, startedAtMs: Long, durationMs: Long = ROOM_FADE_MS): Float {
        if (durationMs <= 0L) return 1f
        val time = ((nowMs - startedAtMs).toFloat() / durationMs).coerceIn(0f, 1f)
        // Motion.ease.standard: Reanimated Easing.bezier(0.4, 0, 0.2, 1).
        var low = 0f
        var high = 1f
        repeat(18) {
            val middle = (low + high) / 2f
            if (bezier(0.4f, 0.2f, middle) < time) low = middle else high = middle
        }
        return bezier(0f, 1f, (low + high) / 2f)
    }

    private fun bezier(first: Float, second: Float, t: Float): Float {
        val inverse = 1f - t
        return 3f * inverse * inverse * t * first + 3f * inverse * t * t * second + t * t * t
    }
}
