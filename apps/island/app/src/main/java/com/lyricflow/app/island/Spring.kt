package com.lyricflow.app.island

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * A damped spring for the island's shape. A finger can retarget it mid-flight and it carries its speed into
 * the new target, which a fixed-length animation cannot do. Stepped by the view's frame loop.
 */
class Spring(
    initial: Float,
    private val stiffness: Float,
    dampingRatio: Float,
) {
    private val damping = 2f * dampingRatio * sqrt(stiffness)

    var value = initial
        private set
    var velocity = 0f
        private set
    var target = initial

    val atRest get() = abs(value - target) < REST && abs(velocity) < REST

    fun snap(to: Float) {
        target = to
        value = to
        velocity = 0f
    }

    /** A push without moving the target (the island bumps when the song changes). */
    fun kick(by: Float) {
        velocity += by
    }

    /** Advances [seconds]; true while still moving. Sub-steps so a dropped frame cannot blow it up. */
    fun step(seconds: Float): Boolean {
        if (atRest) {
            value = target
            velocity = 0f
            return false
        }
        var left = seconds.coerceAtMost(MAX_FRAME_S)
        while (left > 0f) {
            val dt = left.coerceAtMost(SUB_STEP_S)
            val force = -stiffness * (value - target) - damping * velocity
            velocity += force * dt
            value += velocity * dt
            left -= dt
        }
        return true
    }

    private companion object {
        const val REST = 0.0006f
        const val SUB_STEP_S = 1f / 240f
        const val MAX_FRAME_S = 1f / 20f
    }
}
