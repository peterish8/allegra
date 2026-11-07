package com.lyricflow.app.stats

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin
import kotlin.random.Random

class TempoMathTest {
    private val rate = 11_025

    /** A drum-like hit every beat over a soft pad and some noise, like a real mix. */
    private fun track(bpm: Double, seconds: Double = 20.0, noise: Float = 0.05f, accentEvery: Int = 4, seed: Int = 1): FloatArray {
        val random = Random(seed)
        val n = (rate * seconds).toInt()
        val out = FloatArray(n)
        val beat = 60.0 / bpm
        for (i in 0 until n) {
            val t = i.toDouble() / rate
            val sinceBeat = t % beat
            val index = (t / beat).toInt()
            val gain = if (index % accentEvery == 0) 1.0 else 0.7
            val hit = gain * exp(-sinceBeat * 30.0) * sin(2 * PI * 80 * t)
            val pad = 0.15 * sin(2 * PI * 220 * t) * sin(2 * PI * 0.1 * t)
            out[i] = (hit + pad).toFloat() + (random.nextFloat() * 2 - 1) * noise
        }
        return out
    }

    @Test
    fun findsTheBeatAcrossCommonTempos() {
        for (bpm in listOf(76.0, 95.0, 104.0, 120.0, 128.0, 140.0, 172.0)) {
            val found = TempoMath.estimate(track(bpm), rate)
            assertNotNull("no tempo for $bpm", found)
            assertEquals("tempo for $bpm", bpm, found!!, bpm * 0.025)
        }
    }

    @Test
    fun copesWithANoisyRecording() {
        val found = TempoMath.estimate(track(118.0, noise = 0.2f, seed = 7), rate)
        assertNotNull(found)
        assertEquals(118.0, found!!, 3.0)
    }

    @Test
    fun saysNothingWithoutAPulse() {
        assertNull("silence", TempoMath.estimate(FloatArray(rate * 20), rate))
        val random = Random(3)
        assertNull("noise", TempoMath.estimate(FloatArray(rate * 20) { random.nextFloat() * 2 - 1 }, rate))
        val drone = FloatArray(rate * 20) { (0.5 * sin(2 * PI * 220 * it / rate)).toFloat() }
        assertNull("a held note", TempoMath.estimate(drone, rate))
        assertNull("too short", TempoMath.estimate(track(120.0, seconds = 2.0), rate))
        assertNull("no sample rate", TempoMath.estimate(track(120.0), 0))
    }

    @Test
    fun prefersTempoPeopleTapAlongTo() {
        assertEquals(1.0, TempoMath.preference(120.0), 1e-9)
        assertTrue(TempoMath.preference(60.0) < TempoMath.preference(100.0))
        assertTrue(TempoMath.preference(240.0) < TempoMath.preference(140.0))
    }
}
