package com.lyricflow.app.island

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** The camera cutout at the top of the screen, in screen pixels. */
data class CameraCutout(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width get() = right - left
    val height get() = bottom - top
    val centerX get() = (left + right) / 2f
    val centerY get() = (top + bottom) / 2f
}

/**
 * Where the island sits and how big each of its shapes is, in screen pixels. Every shape is centred on
 * [anchorX] and hangs from the top of the screen, which is what lets the window stay centred on the same
 * point while it grows and shrinks (see IslandWindow).
 *
 * Pure, so it is tested on the JVM (IslandGeometryTest).
 */
data class IslandGeometry(
    /** The screen x the island is centred on: the camera when it is near the middle, else the middle. */
    val anchorX: Float,
    /** A notch or waterdrop that touches the top edge: the island hangs from the edge instead of floating. */
    val attached: Boolean,
    val pillTop: Float,
    val pillHeight: Float,
    /** The pill with nothing playing: the camera and a little black either side. */
    val idleWidth: Float,
    /** The pill with a song: room for the cover on the left and the level bars on the right. */
    val compactWidth: Float,
    /** The camera's own width, which the compact pill's content keeps clear of. */
    val cameraWidth: Float,
    val cardTop: Float,
    val cardWidth: Float,
    val cardHeight: Float,
    val cardRadius: Float,
    /** The first y the open card's content may use: below the camera. */
    val contentTop: Float,
    val density: Float,
) {
    fun dp(value: Float) = value * density

    companion object {
        /** Cover row, progress row and transport row of the open card, with the gaps between them. */
        const val CONTENT_HEIGHT_DP = 56f + 16f + 20f + 10f + 52f
        const val CARD_PADDING_DP = 18f

        fun compute(screenWidth: Float, statusBarHeight: Float, density: Float, cutout: CameraCutout?,
                    safeInsetTop: Float = 0f, safeInsetLeft: Float = 0f, safeInsetRight: Float = 0f): IslandGeometry {
            fun dp(v: Float) = v * density
            val hole = cutout?.takeIf { it.width > 0f && it.height > 0f }
            // A camera in a corner gets the island in the middle of the top, not round the camera.
            // A wide notch cannot contain controls on either side without covering the system icons.
            // In that case the island lives immediately below the hardware, still at top centre.
            val centreSlot = (screenWidth - dp(152f)).coerceAtLeast(dp(72f))
            val centred = hole != null && abs(hole.centerX - screenWidth / 2f) <= screenWidth * 0.15f &&
                hole.width + dp(56f) <= centreSlot
            val anchorX = if (centred) hole!!.centerX else screenWidth / 2f
            val attached = centred && hole!!.top <= dp(2f)

            var pillHeight: Float
            var pillTop: Float
            when {
                attached -> {
                    pillHeight = max(hole!!.bottom + dp(6f), dp(30f))
                    pillTop = 0f
                }
                centred -> {
                    pillHeight = max(hole!!.height + dp(12f), dp(30f))
                    pillTop = max(0f, hole.centerY - pillHeight / 2f)
                }
                else -> {
                    pillHeight = (statusBarHeight - dp(6f)).coerceIn(dp(20f), dp(32f))
                    pillTop = max(dp(3f), (statusBarHeight - pillHeight) / 2f)
                }
            }

            val cameraWidth = if (centred) hole!!.width else 0f
            val idleWidth = max(cameraWidth + dp(56f), dp(80f)).coerceAtMost(centreSlot)
            // Leave the clock and the status icons their room either side.
            val widest = centreSlot
            val compactWidth = max(idleWidth, min(idleWidth + dp(100f), widest))
            if (!centred && hole != null &&
                hole.right > anchorX - compactWidth / 2f && hole.left < anchorX + compactWidth / 2f) {
                pillTop = maxOf(statusBarHeight, safeInsetTop, hole.bottom) + dp(4f)
                pillHeight = dp(30f)
            } else if (hole == null && safeInsetTop > statusBarHeight) {
                pillTop = safeInsetTop + dp(4f)
            }

            val sideRoom = 2f * min(anchorX - safeInsetLeft, screenWidth - safeInsetRight - anchorX)
            // Keep the entire spring envelope (5% overshoot plus the window's 6dp pad) on-screen.
            val cardWidth = minOf((screenWidth - dp(16f)) / 1.05f - dp(12f), dp(440f),
                (sideRoom - dp(16f)) / 1.05f - dp(12f))
            val cardTop = if (attached) 0f else pillTop
            val contentTop = maxOf(cardTop + dp(CARD_PADDING_DP), safeInsetTop + dp(8f),
                hole?.let { it.bottom + dp(8f) } ?: 0f)
            val cardHeight = (contentTop - cardTop) + dp(CONTENT_HEIGHT_DP) + dp(CARD_PADDING_DP)

            return IslandGeometry(
                anchorX = anchorX,
                attached = attached,
                pillTop = pillTop,
                pillHeight = pillHeight,
                idleWidth = idleWidth,
                compactWidth = compactWidth,
                cameraWidth = cameraWidth,
                cardTop = cardTop,
                cardWidth = cardWidth,
                cardHeight = cardHeight,
                cardRadius = dp(30f),
                contentTop = contentTop,
                density = density,
            )
        }
    }
}
