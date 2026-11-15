package com.lyricflow.app.playback

import android.app.Application
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException

@OptIn(UnstableApi::class)
@RunWith(RobolectricTestRunner::class)
// Pinned like IslandFlowTest: the default (the compile SDK) needs Java 21, CI and this repo run Java 17.
@Config(manifest = Config.NONE, application = Application::class, sdk = [28])
class ResumingDataSourceTest {

    private val source = ByteArray(1000) { (it % 251).toByte() }
    private val uri = Uri.parse("https://cdn.example/a.mp4")

    /**
     * Serves [source] from each open's position. `cuts` makes the open with that index end early after that many
     * bytes; `readFailures` makes it throw instead; `openCodes` makes the open with that index answer an HTTP code.
     */
    private inner class FakeUpstream(
        val cuts: Map<Int, Int> = emptyMap(),
        val readFailures: Set<Int> = emptySet(),
        val openCodes: Map<Int, Int> = emptyMap(),
        val knownLength: Boolean = true,
    ) : DataSource {
        val opened = ArrayList<DataSpec>()
        private var at = 0
        private var served = 0
        private var limit = Int.MAX_VALUE

        override fun addTransferListener(transferListener: TransferListener) = Unit
        override fun open(dataSpec: DataSpec): Long {
            val index = opened.size
            opened += dataSpec
            openCodes[index]?.let { throw HttpDataSource.InvalidResponseCodeException(it, null, null, emptyMap(), dataSpec, ByteArray(0)) }
            at = dataSpec.position.toInt()
            served = 0
            limit = cuts[index] ?: Int.MAX_VALUE
            if (index in readFailures) limit = -1
            val remaining = source.size - at
            return if (!knownLength) C.LENGTH_UNSET.toLong() else if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length else remaining.toLong()
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (limit == -1) throw IOException("connection reset")
            if (at >= source.size || served >= limit) return C.RESULT_END_OF_INPUT
            val n = minOf(length, source.size - at, limit - served)
            System.arraycopy(source, at, buffer, offset, n)
            at += n; served += n
            return n
        }
        override fun getUri(): Uri = uri
        override fun close() = Unit
    }

    private val slept = ArrayList<Long>()
    private fun resuming(upstream: DataSource) = ResumingDataSource(upstream, ResumingDataSource.PAUSES_MS) { slept += it }

    private fun readAll(source: DataSource, spec: DataSpec = DataSpec(uri)): ByteArray {
        source.open(spec)
        val out = ByteArrayOutputStream()
        val buf = ByteArray(64)
        while (true) {
            val n = source.read(buf, 0, buf.size)
            if (n == C.RESULT_END_OF_INPUT) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    @Test
    fun `a full body passes through untouched`() {
        val up = FakeUpstream()
        assertArrayEquals(source, readAll(resuming(up)))
        assertEquals(1, up.opened.size)
        assertEquals(emptyList<Long>(), slept)
    }

    @Test
    fun `an early end reopens at the position plus the bytes delivered`() {
        val up = FakeUpstream(cuts = mapOf(0 to 300))
        val spec = DataSpec.Builder().setUri(uri).setPosition(100).build()
        assertArrayEquals(source.copyOfRange(100, 1000), readAll(resuming(up), spec))
        assertEquals(400L, up.opened[1].position)
        assertEquals(600L, up.opened[1].length)
    }

    @Test
    fun `a read failure reopens and carries on`() {
        val up = FakeUpstream(readFailures = setOf(0))
        assertArrayEquals(source, readAll(resuming(up)))
        assertEquals(0L, up.opened[1].position)
    }

    @Test
    fun `it gives up after three reopen attempts and rethrows`() {
        val up = FakeUpstream(readFailures = setOf(0, 1, 2, 3))
        assertThrows(IOException::class.java) { readAll(resuming(up)) }
        assertEquals(4, up.opened.size)
        assertEquals(listOf(100L, 250L, 500L), slept)
    }

    @Test
    fun `an early end that never recovers ends with an error, not a silent end`() {
        val up = FakeUpstream(cuts = mapOf(0 to 10, 1 to 0, 2 to 0, 3 to 0))
        assertThrows(EOFException::class.java) { readAll(resuming(up)) }
    }

    @Test
    fun `a dead link on reopen is rethrown, not retried`() {
        val up = FakeUpstream(cuts = mapOf(0 to 300), openCodes = mapOf(1 to 403))
        val error = assertThrows(HttpDataSource.InvalidResponseCodeException::class.java) { readAll(resuming(up)) }
        assertEquals(403, error.responseCode)
        assertEquals(2, up.opened.size)
    }

    @Test
    fun `416 on reopen is a clean end`() {
        val up = FakeUpstream(cuts = mapOf(0 to 300), openCodes = mapOf(1 to 416))
        assertEquals(300, readAll(resuming(up)).size)
    }

    @Test
    fun `an early end with no known length is accepted as the end`() {
        val up = FakeUpstream(cuts = mapOf(0 to 300), knownLength = false)
        assertEquals(300, readAll(resuming(up)).size)
        assertEquals(1, up.opened.size)
    }

    @Test
    fun `the pauses are 100, 250 and 500 ms`() {
        assertArrayEquals(longArrayOf(100, 250, 500), ResumingDataSource.PAUSES_MS)
    }
}
