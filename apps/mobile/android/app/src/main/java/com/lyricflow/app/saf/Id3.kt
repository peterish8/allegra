package com.lyricflow.app.saf

import java.io.ByteArrayOutputStream

/**
 * What the downloads folder writes into a song's own file, so a music player (or the phone's file manager) shows the
 * title, artist, album, cover and lyrics without LuvLyrics: an ID3v2.3 tag. Pure bytes, no Android, so it is tested
 * on the JVM.
 *
 * v2.3 with UTF-16 text is what players read most widely, and it carries Tamil, Hindi and every other script.
 * Only MP3 audio takes a tag: an MP4/M4A file keeps its own atoms and is left exactly as it came.
 */
object Id3 {
    enum class Audio { MP3, M4A, UNKNOWN }

    class Tags(
        val title: String,
        val artist: String,
        val album: String?,
        /** Plain text, not LRC (see [plainLyrics]). */
        val lyrics: String?,
        val cover: ByteArray?,
        val coverMime: String,
    )

    /** Length of the ID3v2 tag at the start of [head] (header, body and footer), or 0 when there is none. [head] needs 10 bytes. */
    fun tagLength(head: ByteArray): Int {
        if (head.size < 10) return 0
        if (head[0] != 'I'.code.toByte() || head[1] != 'D'.code.toByte() || head[2] != '3'.code.toByte()) return 0
        // The size is four 7-bit bytes ("synchsafe"); a byte with the top bit set is not an ID3 tag.
        for (i in 6..9) if (head[i].toInt() and 0x80 != 0) return 0
        val size = (head[6].toInt() shl 21) or (head[7].toInt() shl 14) or (head[8].toInt() shl 7) or head[9].toInt()
        val footer = if (head[5].toInt() and 0x10 != 0) 10 else 0
        return 10 + size + footer
    }

    /** What the audio is, from its first bytes (after any ID3 tag). */
    fun sniff(head: ByteArray): Audio {
        if (head.size >= 8 && head[4] == 'f'.code.toByte() && head[5] == 't'.code.toByte() && head[6] == 'y'.code.toByte() && head[7] == 'p'.code.toByte()) {
            return Audio.M4A
        }
        // An MPEG audio frame starts with eleven set bits.
        if (head.size >= 2 && head[0] == 0xFF.toByte() && (head[1].toInt() and 0xE0) == 0xE0) return Audio.MP3
        return Audio.UNKNOWN
    }

    /** "image/jpeg" or "image/png" from the picture's first bytes; null for anything else. */
    fun imageMime(bytes: ByteArray): String? = when {
        bytes.size >= 3 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() -> "image/jpeg"
        bytes.size >= 4 && bytes[0] == 0x89.toByte() && bytes[1] == 'P'.code.toByte() && bytes[2] == 'N'.code.toByte() && bytes[3] == 'G'.code.toByte() -> "image/png"
        else -> null
    }

    private val LRC_STAMP = Regex("""\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?]""")
    private val WORD_STAMP = Regex("""<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>""")

    /** Synced lyrics as plain lines: the time stamps are taken off, blank lines kept as stanza breaks. */
    fun plainLyrics(lrc: String): String =
        lrc.lineSequence()
            .map { line -> WORD_STAMP.replace(LRC_STAMP.replace(line, ""), "").trim() }
            .joinToString("\n")
            .trim()

    /** The whole tag, ready to write in front of the audio. */
    fun build(tags: Tags): ByteArray {
        val frames = ByteArrayOutputStream()
        frame(frames, "TIT2", textBody(tags.title))
        if (tags.artist.isNotBlank()) {
            frame(frames, "TPE1", textBody(tags.artist))
            frame(frames, "TPE2", textBody(tags.artist))
        }
        if (!tags.album.isNullOrBlank()) frame(frames, "TALB", textBody(tags.album))
        if (!tags.lyrics.isNullOrBlank()) frame(frames, "USLT", lyricsBody(tags.lyrics))
        val cover = tags.cover
        if (cover != null && cover.isNotEmpty()) frame(frames, "APIC", pictureBody(cover, tags.coverMime))

        val body = frames.toByteArray()
        val out = ByteArrayOutputStream(10 + body.size)
        out.write(byteArrayOf('I'.code.toByte(), 'D'.code.toByte(), '3'.code.toByte(), 3, 0, 0))
        out.write(synchsafe(body.size))
        out.write(body)
        return out.toByteArray()
    }

    private fun frame(out: ByteArrayOutputStream, id: String, body: ByteArray) {
        out.write(id.toByteArray(Charsets.ISO_8859_1))
        // v2.3 frame sizes are plain big-endian, not synchsafe.
        out.write(byteArrayOf((body.size ushr 24).toByte(), (body.size ushr 16).toByte(), (body.size ushr 8).toByte(), body.size.toByte()))
        out.write(byteArrayOf(0, 0))
        out.write(body)
    }

    private val BOM = byteArrayOf(0xFF.toByte(), 0xFE.toByte())

    /** Encoding byte 1 = UTF-16 with a byte-order mark. */
    private fun utf16(text: String): ByteArray = BOM + text.toByteArray(Charsets.UTF_16LE)

    private fun textBody(text: String): ByteArray = byteArrayOf(1) + utf16(text)

    private fun lyricsBody(text: String): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(1)
        out.write("und".toByteArray(Charsets.ISO_8859_1))
        // An empty content descriptor still carries its byte-order mark and a two-byte terminator.
        out.write(BOM)
        out.write(byteArrayOf(0, 0))
        out.write(utf16(text))
        return out.toByteArray()
    }

    private fun pictureBody(cover: ByteArray, mime: String): ByteArray {
        val out = ByteArrayOutputStream(cover.size + 32)
        out.write(0)
        out.write(mime.toByteArray(Charsets.ISO_8859_1))
        out.write(0)
        out.write(3) // front cover
        out.write(0) // empty description
        out.write(cover)
        return out.toByteArray()
    }

    private fun synchsafe(size: Int): ByteArray =
        byteArrayOf(((size shr 21) and 0x7F).toByte(), ((size shr 14) and 0x7F).toByte(), ((size shr 7) and 0x7F).toByte(), (size and 0x7F).toByte())
}
