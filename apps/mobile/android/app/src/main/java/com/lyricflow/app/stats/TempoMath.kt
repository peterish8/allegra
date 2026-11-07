package com.lyricflow.app.stats

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.sqrt

/**
 * A song's tempo from its audio (Listening stats, 1.45.0). Pure, so it is unit-tested on the JVM (TempoMathTest).
 *
 *  1. Loudness in short frames (HOP_SEC apart), on a log scale, so quiet and loud songs behave alike.
 *  2. The onset envelope: how much louder each frame is than the one before (drops count as zero), with the slow
 *     trend taken away. Beats are where this jumps.
 *  3. How alike the envelope is with itself shifted by each beat length from MIN_BPM to MAX_BPM (autocorrelation).
 *  4. The best shift, weighted gently toward 120 BPM (people hear most music between 90 and 150, so a beat found at
 *     double or half speed is pulled back), refined between frames, as BPM.
 *
 * Null when the music has no clear pulse (silence, an ambient intro): a wrong number is worse than none.
 */
object TempoMath {
    const val MIN_BPM = 70.0
    const val MAX_BPM = 180.0
    const val HOP_SEC = 0.01
    /** How much clearer than average the best beat must be to be believed. */
    const val MIN_CLARITY = 1.25
    /** The envelope must line up with itself this well at the beat (noise sits near 0.05, music from 0.3 up). */
    const val MIN_SCORE = 0.3
    /** The loudest rise must be at least this (log loudness): a held note or a hum has no attacks to count. */
    const val MIN_ONSET = 0.25

    /** Mono samples (-1..1) at [sampleRate] -> beats per minute, or null. */
    fun estimate(samples: FloatArray, sampleRate: Int): Double? {
        if (sampleRate <= 0) return null
        val hop = max(1, (sampleRate * HOP_SEC).toInt())
        val frames = samples.size / hop
        if (frames < (60.0 / MIN_BPM / HOP_SEC * 4).toInt()) return null
        val loud = DoubleArray(frames)
        for (f in 0 until frames) {
            var sum = 0.0
            val start = f * hop
            for (i in start until start + hop) { val s = samples[i].toDouble(); sum += s * s }
            loud[f] = ln(1e-9 + sqrt(sum / hop))
        }
        val envelope = onsets(loud)
        if ((envelope.maxOrNull() ?: 0.0) < MIN_ONSET) return null
        return fromEnvelope(envelope, HOP_SEC)
    }

    /** Rises in loudness, with the slow trend (about half a second) taken away. */
    fun onsets(loud: DoubleArray): DoubleArray {
        val n = loud.size
        val rise = DoubleArray(n)
        for (i in 1 until n) rise[i] = max(0.0, loud[i] - loud[i - 1])
        val window = 25
        val out = DoubleArray(n)
        var acc = 0.0
        for (i in 0 until n) {
            acc += rise[i]
            if (i >= window) acc -= rise[i - window]
            val mean = acc / minOf(i + 1, window)
            out[i] = max(0.0, rise[i] - mean)
        }
        return out
    }

    /** The beat in an onset envelope sampled every [hopSec] seconds. */
    fun fromEnvelope(envelope: DoubleArray, hopSec: Double): Double? {
        val minLag = (60.0 / MAX_BPM / hopSec).toInt().coerceAtLeast(1)
        val maxLag = (60.0 / MIN_BPM / hopSec).toInt() + 1
        if (envelope.size <= maxLag * 3) return null
        val mean = envelope.average()
        val centred = DoubleArray(envelope.size) { envelope[it] - mean }
        val energy = centred.sumOf { it * it }
        if (energy <= 1e-12) return null
        val scores = DoubleArray(maxLag + 2)
        for (lag in minLag..maxLag + 1) {
            var s = 0.0
            for (i in 0 until centred.size - lag) s += centred[i] * centred[i + lag]
            scores[lag] = s / energy
        }
        var best = -1
        var bestWeighted = Double.NEGATIVE_INFINITY
        for (lag in minLag..maxLag) {
            val weighted = scores[lag] * preference(60.0 / (lag * hopSec))
            if (weighted > bestWeighted) { bestWeighted = weighted; best = lag }
        }
        if (best <= 0 || scores[best] < MIN_SCORE) return null
        val positive = (minLag..maxLag).map { max(0.0, scores[it]) }
        val average = positive.average()
        if (average <= 0 || scores[best] / average < MIN_CLARITY) return null
        // Refine between frames: the top of a parabola through the best lag and its neighbours.
        val a = scores[best - 1].takeIf { best - 1 >= minLag } ?: scores[best]
        val c = scores[best + 1]
        val b = scores[best]
        val denominator = a - 2 * b + c
        val offset = if (abs(denominator) > 1e-12) (0.5 * (a - c) / denominator).coerceIn(-0.5, 0.5) else 0.0
        val bpm = 60.0 / ((best + offset) * hopSec)
        return if (bpm in MIN_BPM..MAX_BPM) bpm else null
    }

    /** A gentle preference for tempos people tap along to: 1 at 120 BPM, about 0.8 an octave away. */
    fun preference(bpm: Double): Double {
        val octaves = ln(bpm / 120.0) / ln(2.0)
        return exp(-0.5 * (octaves / 1.5) * (octaves / 1.5))
    }
}
