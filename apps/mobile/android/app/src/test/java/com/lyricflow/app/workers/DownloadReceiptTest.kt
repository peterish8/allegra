package com.lyricflow.app.workers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class DownloadReceiptTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val receipt = DownloadReceipt(
        id = "stream:saavn:abc 1",
        audioUri = "file:///data/music/abc/audio.mp3",
        coverUri = null,
        meta = """{"title":"Tum Hi Ho","artist":"Arijit Singh"}""",
        finishedAtMs = 1_793_000_000_000L,
    )

    @Test
    fun `a receipt comes back as it was written`() {
        assertEquals(receipt, DownloadReceipt.decode(receipt.encode()))
    }

    @Test
    fun `a cut-short, other-version or empty receipt reads as none`() {
        val text = receipt.encode()
        assertNull(DownloadReceipt.decode(text.substring(0, text.length / 2)))
        assertNull(DownloadReceipt.decode(text.replace("\"v\":1", "\"v\":2")))
        assertNull(DownloadReceipt.decode("""{"v":1,"id":"","audioUri":"file:///a"}"""))
        assertNull(DownloadReceipt.decode("nonsense"))
    }

    @Test
    fun `receipts are written whole, read back, and cleared one by one`() {
        val dir = File(folder.root, "receipts")
        val other = receipt.copy(id = "song-2", coverUri = "file:///data/music/2/cover.jpg")
        assertTrue(DownloadReceipt.write(dir, receipt))
        assertTrue(DownloadReceipt.write(dir, other))
        // A temporary file from a write the app was killed in is not a receipt.
        File(dir, "song-3.json.tmp").writeText(other.copy(id = "song-3").encode())

        assertEquals(setOf(receipt, other), DownloadReceipt.readAll(dir).toSet())

        assertTrue(DownloadReceipt.clear(dir, receipt.id))
        assertEquals(listOf(other), DownloadReceipt.readAll(dir))
        // Clearing what is already gone is fine.
        assertTrue(DownloadReceipt.clear(dir, receipt.id))
    }

    @Test
    fun `writing the same song again replaces its receipt`() {
        val dir = File(folder.root, "receipts")
        DownloadReceipt.write(dir, receipt)
        DownloadReceipt.write(dir, receipt.copy(audioUri = "content://saf/abc"))
        assertEquals(listOf("content://saf/abc"), DownloadReceipt.readAll(dir).map { it.audioUri })
    }
}
