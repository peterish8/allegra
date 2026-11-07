package com.lyricflow.app.modules

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import com.lyricflow.app.stats.TempoMath
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.ByteOrder

/**
 * Measures a song's tempo on the phone (Listening stats, 1.45.0): decodes about [SECONDS] of its audio from the middle
 * of the song (intros are often beatless), mixes it to mono, thins it to about 11 kHz and hands it to [TempoMath].
 * Reads a file on the phone or an https stream (the Allegra API's `/api/stream/:id`, which serves byte ranges).
 * Runs on the module's background queue; returns null for anything it cannot read or hear a beat in.
 */
class TempoModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("Tempo")

        AsyncFunction("measure") { uri: String ->
            try { measure(uri) } catch (_: Throwable) { null }
        }
    }

    private fun measure(uri: String): Double? {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            val context = appContext.reactContext ?: return null
            when {
                uri.startsWith("http://") || uri.startsWith("https://") -> extractor.setDataSource(uri, emptyMap())
                uri.startsWith("content://") -> extractor.setDataSource(context, Uri.parse(uri), null)
                else -> extractor.setDataSource(uri.removePrefix("file://"))
            }
            val track = (0 until extractor.trackCount).firstOrNull {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: return null
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
            // Start a third of the way in (past the intro) when the song is long enough.
            if (durationUs > (SECONDS + 20) * 1_000_000L) extractor.seekTo(durationUs / 3, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: return null
            codec = MediaCodec.createDecoderByType(mime).apply { configure(format, null, null, 0); start() }

            var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            var floatPcm = false
            val mono = ArrayList<Float>(TARGET_RATE * SECONDS)
            var step = 1
            var counter = 0
            var acc = 0f
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var wanted = Int.MAX_VALUE
            // A stalled stream or a decoder that never says it is done must not hold the queue forever.
            val deadline = System.currentTimeMillis() + DEADLINE_MS
            while (mono.size < wanted && System.currentTimeMillis() < deadline) {
                if (!inputDone) {
                    val inIndex = codec.dequeueInputBuffer(10_000)
                    if (inIndex >= 0) {
                        val buffer = codec.getInputBuffer(inIndex) ?: break
                        val size = extractor.readSampleData(buffer, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val outIndex = codec.dequeueOutputBuffer(info, 10_000)
                when {
                    outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val out = codec.outputFormat
                        sampleRate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        floatPcm = out.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                            out.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                    }
                    outIndex >= 0 -> {
                        step = maxOf(1, sampleRate / TARGET_RATE)
                        wanted = (sampleRate / step) * SECONDS
                        val out = codec.getOutputBuffer(outIndex)
                        if (out != null && info.size > 0) {
                            out.position(info.offset)
                            out.limit(info.offset + info.size)
                            val ordered = out.order(ByteOrder.nativeOrder())
                            val frameCount = info.size / (channels * if (floatPcm) 4 else 2)
                            for (f in 0 until frameCount) {
                                var sum = 0f
                                for (c in 0 until channels) {
                                    sum += if (floatPcm) ordered.float else ordered.short / 32768f
                                }
                                // Average `step` frames into one: a simple low-pass before thinning the rate.
                                acc += sum / channels
                                if (++counter == step) { mono.add(acc / step); acc = 0f; counter = 0 }
                                if (mono.size >= wanted) break
                            }
                        }
                        codec.releaseOutputBuffer(outIndex, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                    }
                }
            }
            val rate = sampleRate / step
            return TempoMath.estimate(mono.toFloatArray(), rate)?.let { Math.round(it * 10) / 10.0 }
        } finally {
            try { codec?.stop() } catch (_: Throwable) { /* never started */ }
            try { codec?.release() } catch (_: Throwable) { /* already gone */ }
            extractor.release()
        }
    }

    private companion object {
        const val SECONDS = 30
        const val TARGET_RATE = 11_025
        const val DEADLINE_MS = 25_000L
    }
}
