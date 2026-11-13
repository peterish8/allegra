package com.lyricflow.app.saf

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class Id3Test {
    private fun tags(
        title: String = "Tum Hi Ho",
        artist: String = "Arijit Singh",
        album: String? = "Aashiqui 2",
        lyrics: String? = null,
        cover: ByteArray? = null,
    ) = Id3.Tags(title, artist, album, lyrics, cover, "image/jpeg")

    private fun frameIds(tag: ByteArray): List<String> {
        val ids = ArrayList<String>()
        var at = 10
        while (at + 10 <= tag.size) {
            val id = String(tag, at, 4, Charsets.ISO_8859_1)
            val size = ((tag[at + 4].toInt() and 0xFF) shl 24) or ((tag[at + 5].toInt() and 0xFF) shl 16) or
                ((tag[at + 6].toInt() and 0xFF) shl 8) or (tag[at + 7].toInt() and 0xFF)
            ids += id
            at += 10 + size
        }
        return ids
    }

    @Test
    fun theTagStartsWithAnId3v23HeaderWhoseSizeCoversTheFrames() {
        val tag = Id3.build(tags())
        assertEquals("ID3", String(tag, 0, 3, Charsets.ISO_8859_1))
        assertEquals(3, tag[3].toInt())
        assertEquals(0, tag[4].toInt())
        assertEquals(tag.size, Id3.tagLength(tag))
    }

    @Test
    fun carriesTitleArtistAlbumAndAlbumArtist() {
        assertEquals(listOf("TIT2", "TPE1", "TPE2", "TALB"), frameIds(Id3.build(tags())))
    }

    @Test
    fun leavesOutWhatIsMissing() {
        assertEquals(listOf("TIT2"), frameIds(Id3.build(tags(artist = "", album = null))))
        assertEquals(listOf("TIT2", "TPE1", "TPE2"), frameIds(Id3.build(tags(album = "  "))))
    }

    @Test
    fun addsLyricsAndACover() {
        val tag = Id3.build(tags(lyrics = "line one\nline two", cover = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1, 2, 3)))
        assertEquals(listOf("TIT2", "TPE1", "TPE2", "TALB", "USLT", "APIC"), frameIds(tag))
        assertEquals(tag.size, Id3.tagLength(tag))
    }

    @Test
    fun keepsEveryScriptIntact() {
        val tag = Id3.build(tags(title = "மொழியே", artist = "சித் ஸ்ரீராம்", album = null))
        // The text is in the tag as UTF-16, exactly as written.
        assertTrue(indexOf(tag, "மொழியே".toByteArray(Charsets.UTF_16LE)) >= 0)
        assertTrue(indexOf(tag, "சித் ஸ்ரீராம்".toByteArray(Charsets.UTF_16LE)) >= 0)
    }

    @Test
    fun readsTheLengthOfAnExistingTagAndIgnoresAnythingElse() {
        val existing = Id3.build(tags())
        assertEquals(existing.size, Id3.tagLength(existing + ByteArray(50)))
        assertEquals(0, Id3.tagLength("RIFF....................".toByteArray()))
        assertEquals(0, Id3.tagLength(ByteArray(4)))
        // A size byte with its top bit set is not a synchsafe size.
        val broken = existing.copyOf()
        broken[7] = 0x80.toByte()
        assertEquals(0, Id3.tagLength(broken))
    }

    @Test
    fun aFooterAddsTenBytes() {
        val withFooter = Id3.build(tags()).copyOf()
        withFooter[5] = 0x10
        assertEquals(Id3.build(tags()).size + 10, Id3.tagLength(withFooter))
    }

    @Test
    fun tellsMp3FromM4aFromAnythingElse() {
        assertEquals(Id3.Audio.MP3, Id3.sniff(byteArrayOf(0xFF.toByte(), 0xFB.toByte(), 0x90.toByte(), 0, 0, 0, 0, 0)))
        // ADTS AAC also opens with eleven set bits and is tagged the same way.
        assertEquals(Id3.Audio.MP3, Id3.sniff(byteArrayOf(0xFF.toByte(), 0xF1.toByte(), 0x50, 0x80.toByte(), 0, 0, 0, 0)))
        val m4a = byteArrayOf(0, 0, 0, 0x20, 'f'.code.toByte(), 't'.code.toByte(), 'y'.code.toByte(), 'p'.code.toByte(), 'M'.code.toByte(), '4'.code.toByte(), 'A'.code.toByte(), ' '.code.toByte())
        assertEquals(Id3.Audio.M4A, Id3.sniff(m4a))
        assertEquals(Id3.Audio.UNKNOWN, Id3.sniff("<html>not audio</html>".toByteArray()))
        assertEquals(Id3.Audio.UNKNOWN, Id3.sniff(ByteArray(1)))
    }

    @Test
    fun readsAPicturesTypeFromItsFirstBytes() {
        assertEquals("image/jpeg", Id3.imageMime(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte())))
        assertEquals("image/png", Id3.imageMime(byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte())))
        assertNull(Id3.imageMime("GIF89a".toByteArray()))
        assertNull(Id3.imageMime(ByteArray(0)))
    }

    @Test
    fun takesTheTimeStampsOffLyrics() {
        val lrc = "[00:12.50]first line\n[00:15.00]<00:15.00>sec<00:15.40>ond line\n\n[01:02.3]third"
        assertEquals("first line\nsecond line\n\nthird", Id3.plainLyrics(lrc))
        assertEquals("already plain", Id3.plainLyrics("already plain"))
        assertEquals("", Id3.plainLyrics("   "))
    }

    private fun indexOf(haystack: ByteArray, needle: ByteArray): Int {
        outer@ for (i in 0..haystack.size - needle.size) {
            for (j in needle.indices) if (haystack[i + j] != needle[j]) continue@outer
            return i
        }
        return -1
    }
}
