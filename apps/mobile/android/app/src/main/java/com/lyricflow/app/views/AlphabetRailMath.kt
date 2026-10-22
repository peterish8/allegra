package com.lyricflow.app.views

import org.json.JSONArray
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** One letter on the rail and the list index it jumps to, as `AlphabetRail.tsx` is given them. */
data class RailLetter(val letter: String, val index: Int)

/**
 * The A–Z rail's rules, ported from `AlphabetRail.tsx` (its styles) and `libraryShape.railPick`. All in dp; pure, so it
 * is tested on the JVM.
 */
object AlphabetRailMath {
    const val RAIL_W = 26f
    const val PAD_V = 8f
    const val LETTER_H = 15f
    const val RAIL_RADIUS = 13f

    /** The bubble beside the thumb: a 56 dp disc whose right edge is 40 dp left of the rail's right edge. */
    const val BUBBLE = 56f
    const val BUBBLE_RIGHT = 40f

    /** The view reaches this far left of the rail and this far above and below it, so the bubble fits in it. */
    const val REACH_LEFT = BUBBLE_RIGHT + BUBBLE - RAIL_W
    const val REACH_V = BUBBLE / 2f

    /** The rail's height: padding, the letters on a 15 dp line each, and the hairline border either side. */
    fun railHeight(count: Int, hairline: Float): Float = 2 * PAD_V + count * LETTER_H + 2 * hairline

    /** Which letter a touch at [y] (0 = the rail's top) lands on: `railPick`. */
    fun pick(y: Float, railHeight: Float, count: Int): Int {
        if (count <= 0 || railHeight <= 0f) return 0
        return max(0, min(count - 1, floor((y / railHeight) * count).toInt()))
    }

    /** The bubble's vertical centre: the touch, kept on the rail. */
    fun bubbleY(y: Float, railHeight: Float): Float = max(0f, min(railHeight, y))

    /** Top of letter [i]'s line, from the rail's top. */
    fun letterTop(i: Int, hairline: Float): Float = hairline + PAD_V + i * LETTER_H

    /** The letter a step of [delta] from [current] (-1 for none) reaches, kept on the rail. */
    fun step(current: Int, delta: Int, count: Int): Int {
        if (count <= 0) return -1
        val from = if (current < 0) (if (delta > 0) -1 else count) else current
        return max(0, min(count - 1, from + delta))
    }

    /**
     * Where the explicit 15 dp line puts a letter's baseline, from the line's top: React Native splits the spare
     * leading evenly above and below the glyphs' ascent and descent (both passed in dp, ascent negative as Android has it).
     */
    fun baselineInLine(ascent: Float, descent: Float): Float = (LETTER_H - (descent - ascent)) / 2f - ascent

    /** The `letters` JSON from `railLettersJson` (TypeScript); malformed input gives no letters. */
    fun parse(json: String?): List<RailLetter> {
        if (json.isNullOrEmpty()) return emptyList()
        return try {
            val array = JSONArray(json)
            val out = ArrayList<RailLetter>(array.length())
            for (n in 0 until array.length()) {
                val o = array.getJSONObject(n)
                out += RailLetter(o.getString("letter"), o.getInt("index"))
            }
            out
        } catch (_: Exception) {
            emptyList()
        }
    }
}
