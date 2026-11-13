package com.lyricflow.app.playback

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sign

/**
 * The mini player's sideways swipe, decided on the main thread: left plays the next song, right goes to the previous
 * one. The same rule as `playback/miniSwipe.ts` (kept in step by `MiniSwipeTest` and `miniSwipe.test.ts` on the same
 * cases): a short, slow or mostly vertical drag changes nothing, so a noisy flick or a scroll that strays sideways
 * never skips. All distances are dp and velocity is dp per second.
 */
object MiniSwipe {
    /** A flick: the theme's Motion.flingVelocity. */
    const val FLICK_VELOCITY = 800f
    /** A slow drag commits past this, or past 22% of the bar's width when that is wider. */
    const val MIN_DISTANCE = 56f
    /** A flick commits sooner, but only once the finger has travelled this far the same way. */
    const val FLICK_DISTANCE = 24f
    /** How far the cover and title follow the finger, at most. */
    const val FOLLOW_MAX = 48f
    /** A drag starts after this much sideways travel (the JavaScript pan's activeOffsetX). */
    const val ACTIVE_DISTANCE = 16f

    const val NONE = 0
    const val NEXT = 1
    const val PREVIOUS = -1

    fun threshold(width: Float): Float = max(MIN_DISTANCE, width * 0.22f)

    /** [NEXT], [PREVIOUS] or [NONE]. */
    fun decide(dx: Float, dy: Float, vx: Float, width: Float, rtl: Boolean = false): Int {
        if (!dx.isFinite() || !dy.isFinite() || abs(dy) >= abs(dx)) return NONE
        val far = abs(dx) >= threshold(width)
        val flick = abs(vx) >= FLICK_VELOCITY && abs(dx) >= FLICK_DISTANCE && sign(vx) == sign(dx)
        if (!far && !flick) return NONE
        val towardStart = dx < 0
        return if (towardStart != rtl) NEXT else PREVIOUS
    }

    /** How far the content follows a drag: half the finger's travel, damped to [FOLLOW_MAX]. */
    fun follow(dx: Float): Float = max(-FOLLOW_MAX, min(FOLLOW_MAX, dx / 2f))

    /** The content dims as it is dragged, by up to half. */
    fun fade(dx: Float): Float = 1f - min(0.5f, abs(dx) / 240f)

    /** Whether a move has become a sideways drag: past [ACTIVE_DISTANCE] and more across than down. */
    fun isDrag(dx: Float, dy: Float): Boolean = abs(dx) >= ACTIVE_DISTANCE && abs(dx) > abs(dy)
}
