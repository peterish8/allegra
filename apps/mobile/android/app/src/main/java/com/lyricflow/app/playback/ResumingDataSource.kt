package com.lyricflow.app.playback

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import java.io.EOFException
import java.io.IOException
import java.io.InterruptedIOException

/**
 * Reopens a stream at the byte it stopped at when the body ends early or a read fails (1.69.0).
 *
 * Media3's HTTP source returns end-of-input whenever the socket closes, even short of the length the server promised,
 * so a dropped connection used to end the song early. This sits between the cache and the HTTP source: on an early
 * end or a read error it waits briefly, reopens at `position + delivered`, and carries on, so the cache receives
 * contiguous bytes. Three tries (100, 250, 500 ms, under a second in all) leave longer outages to the existing
 * retry ladder and stall watchdog. A dead signed link (403, 404, 410) is rethrown so JavaScript fetches a fresh one;
 * 416 means we were already at the end. Interrupts (a seek, a skip) are never swallowed.
 */
@OptIn(UnstableApi::class)
class ResumingDataSource(
    private val upstream: DataSource,
    private val pausesMs: LongArray = PAUSES_MS,
    private val sleeper: (Long) -> Unit = { Thread.sleep(it) },
) : DataSource {
    private var spec: DataSpec? = null
    private var expected: Long = C.LENGTH_UNSET.toLong()
    private var delivered = 0L

    override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)

    override fun open(dataSpec: DataSpec): Long {
        spec = dataSpec
        delivered = 0
        expected = upstream.open(dataSpec)
        return expected
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        val unset = C.LENGTH_UNSET.toLong()
        if (expected != unset && delivered >= expected) return C.RESULT_END_OF_INPUT
        var attempt = 0
        while (true) {
            var failure: IOException? = null
            val result = try {
                upstream.read(buffer, offset, length)
            } catch (e: InterruptedIOException) {
                throw e
            } catch (e: IOException) {
                failure = e
                FAILED
            }
            if (result > 0) {
                delivered += result
                return result
            }
            if (result == C.RESULT_END_OF_INPUT && (expected == unset || delivered >= expected)) return C.RESULT_END_OF_INPUT
            // An early end (fewer bytes than promised) or a failed read: reopen where it stopped.
            while (true) {
                if (attempt == pausesMs.size) throw failure ?: EOFException("stream ended at $delivered of $expected bytes")
                pause(pausesMs[attempt])
                attempt += 1
                try { upstream.close() } catch (_: IOException) { /* reopening anyway */ }
                val current = spec ?: throw failure ?: EOFException("no open stream")
                try {
                    // What is left of what the first open promised: Range bytes=(position+delivered)-(last byte).
                    upstream.open(if (expected == unset) current.subrange(delivered) else current.subrange(delivered, expected - delivered))
                    break
                } catch (e: HttpDataSource.InvalidResponseCodeException) {
                    if (e.responseCode == 416) return C.RESULT_END_OF_INPUT
                    if (e.responseCode in DEAD_LINK) throw e
                    failure = e
                } catch (e: DataSourceException) {
                    if (e.reason == PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE) return C.RESULT_END_OF_INPUT
                    failure = e
                } catch (e: InterruptedIOException) {
                    throw e
                } catch (e: IOException) {
                    failure = e
                }
            }
        }
    }

    private fun pause(ms: Long) {
        try {
            sleeper(ms)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            throw InterruptedIOException("cancelled while reopening").apply { initCause(e) }
        }
    }

    override fun getUri(): Uri? = upstream.uri

    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun close() = upstream.close()

    class Factory(private val upstream: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = ResumingDataSource(upstream.createDataSource())
    }

    companion object {
        val PAUSES_MS = longArrayOf(100, 250, 500)
        private val DEAD_LINK = setOf(403, 404, 410)
        private const val FAILED = Int.MIN_VALUE
    }
}
