package com.lyricflow.app.saf

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import org.json.JSONObject
import java.io.FileNotFoundException
import java.io.InputStream
import java.io.OutputStream

/** One child of a folder in the listener's chosen downloads folder. */
data class SafEntry(val name: String, val uri: String, val isDirectory: Boolean)

/**
 * The listener's downloads folder, reached through Android's Storage Access Framework with the one tree
 * permission they granted (kept across restarts by `takePersistableUriPermission`). Songs live in
 * `All songs/`, each playlist in `Playlists/<name>/`; every function takes the path below the chosen folder.
 *
 * Plain DocumentsContract calls, no DocumentFile dependency. Names are used as given: the caller has already
 * made them safe for a file system (services/folder/folderNames.ts).
 */
object SafLibrary {
    const val ALL_SONGS = "All songs"
    const val PLAYLISTS = "Playlists"

    private fun docUri(tree: Uri, docId: String): Uri = DocumentsContract.buildDocumentUriUsingTree(tree, docId)

    /** The document id of the child called [name] under [parentId], or null when there is none. */
    fun findChild(resolver: ContentResolver, tree: Uri, parentId: String, name: String): String? {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
        val columns = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        resolver.query(children, columns, null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) {
                if (cursor.getString(1) == name) return cursor.getString(0)
            }
        }
        return null
    }

    /** The folder called [name] under [parentId]; made when it is missing. Returns its document id. */
    fun ensureDirectory(resolver: ContentResolver, tree: Uri, parentId: String, name: String): String {
        findChild(resolver, tree, parentId, name)?.let { return it }
        val created = DocumentsContract.createDocument(resolver, docUri(tree, parentId), DocumentsContract.Document.MIME_TYPE_DIR, name)
            ?: throw FileNotFoundException("Could not create folder $name")
        return DocumentsContract.getDocumentId(created)
    }

    /** Walks [path] from the chosen folder, making each step that is missing. Returns the last folder's document id. */
    fun ensurePath(resolver: ContentResolver, tree: Uri, path: List<String>): String {
        var id = DocumentsContract.getTreeDocumentId(tree)
        for (step in path) id = ensureDirectory(resolver, tree, id, step)
        return id
    }

    /** Walks [path] without making anything. Null when a step is missing. */
    fun resolvePath(resolver: ContentResolver, tree: Uri, path: List<String>): String? {
        var id: String = DocumentsContract.getTreeDocumentId(tree)
        for (step in path) id = findChild(resolver, tree, id, step) ?: return null
        return id
    }

    /**
     * Writes a file called [name] in [path], replacing one of that name. The bytes come from [sourceUri]
     * (file:// or content://) or are [text]. Returns the new document's uri.
     */
    fun write(
        context: Context,
        treeUri: String,
        path: List<String>,
        name: String,
        mime: String,
        sourceUri: String?,
        text: String?,
    ): String {
        val resolver = context.contentResolver
        return writeStream(resolver, treeUri, path, name, mime) { out ->
            when {
                sourceUri != null -> resolver.openInputStream(Uri.parse(sourceUri))?.use { it.copyTo(out) }
                    ?: throw FileNotFoundException("Could not read $sourceUri")
                text != null -> out.write(text.toByteArray(Charsets.UTF_8))
                else -> throw IllegalArgumentException("Nothing to write")
            }
        }
    }

    /** Creates [name] in [path] (replacing one of that name), lets [fill] write its bytes, and returns its uri. */
    private fun writeStream(
        resolver: ContentResolver,
        treeUri: String,
        path: List<String>,
        name: String,
        mime: String,
        fill: (OutputStream) -> Unit,
    ): String {
        val tree = Uri.parse(treeUri)
        val parentId = ensurePath(resolver, tree, path)
        findChild(resolver, tree, parentId, name)?.let { stale ->
            DocumentsContract.deleteDocument(resolver, docUri(tree, stale))
        }
        val created = DocumentsContract.createDocument(resolver, docUri(tree, parentId), mime, name)
            ?: throw FileNotFoundException("Could not create $name")
        try {
            resolver.openOutputStream(created, "w")?.use(fill)
                ?: throw FileNotFoundException("Could not open $name for writing")
        } catch (e: Exception) {
            // A half-written file would read as a song; take it away.
            try { DocumentsContract.deleteDocument(resolver, created) } catch (_: Exception) {}
            throw e
        }
        return created.toString()
    }

    /** What the library knows about a song when it is copied into the folder (services/folder/libraryFolder.ts). */
    class SongExport(
        val id: String,
        val title: String,
        val artist: String,
        val album: String?,
        val duration: Double,
        val originId: String?,
        val coverRemoteUri: String?,
        /** Synced lyrics as LRC text. */
        val lyrics: String?,
        /** The audio on the phone: file:// or content://. */
        val audioUri: String,
        /** The cover on the phone, or null. */
        val coverUri: String?,
        /** The file name to try first, without an extension: the song's name. */
        val base: String,
    )

    class ExportResult(val base: String, val audioName: String, val audioUri: String, val coverName: String?)

    /** A [SongExport] from the JSON JavaScript sends (`FolderSongInput`). */
    fun songFromJson(json: JSONObject): SongExport {
        fun text(key: String): String? = json.optString(key, "").takeIf { it.isNotEmpty() }
        return SongExport(
            id = json.getString("id"),
            title = json.getString("title"),
            artist = json.optString("artist", ""),
            album = text("album"),
            duration = json.optDouble("duration", 0.0),
            originId = text("originId"),
            coverRemoteUri = text("coverRemoteUri"),
            lyrics = text("lyrics"),
            audioUri = json.getString("audioUri"),
            coverUri = text("coverUri"),
            base = json.getString("base"),
        )
    }

    private const val MAX_SAME_NAME = 99
    private const val MAX_COVER_BYTES = 4 * 1024 * 1024

    /**
     * Copies one song into `All songs/` under its own name: the audio with its title, artist, album, cover and lyrics
     * written into the file (MP3), the cover as a picture beside it, and a small JSON file the library reads back after
     * a reinstall. Another song that already has the name keeps it and this one becomes "Name (2)", "Name (3)" and so
     * on; the same song again takes its own files over. An MP4/M4A file keeps its own format and gets the .m4a name.
     * The JSON goes last, so a song only counts as saved once everything about it is there.
     */
    fun exportSong(context: Context, treeUri: String, song: SongExport): ExportResult {
        val resolver = context.contentResolver
        val tree = Uri.parse(treeUri)
        val path = listOf(ALL_SONGS)
        val folderId = ensurePath(resolver, tree, path)

        var base = song.base
        var attempt = 1
        while (true) {
            val jsonId = findChild(resolver, tree, folderId, "$base.json") ?: break
            if (sidecarId(resolver, tree, jsonId) == song.id) break
            attempt += 1
            if (attempt > MAX_SAME_NAME) throw FileNotFoundException("Too many songs called ${song.base}")
            base = "${song.base} ($attempt)"
        }

        val head = audioHead(resolver, song.audioUri)
        val kind = Id3.sniff(head.afterTag)
        val audioName = if (kind == Id3.Audio.M4A) "$base.m4a" else "$base.mp3"
        val audioMime = if (kind == Id3.Audio.M4A) "audio/mp4" else "audio/mpeg"

        val cover = song.coverUri?.let { readLimited(resolver, it, MAX_COVER_BYTES) }
        val coverMime = cover?.let { Id3.imageMime(it) }
        val coverName = if (cover != null && coverMime != null) "$base.${if (coverMime == "image/png") "png" else "jpg"}" else null

        val audioUri = writeStream(resolver, treeUri, path, audioName, audioMime) { out ->
            val input = resolver.openInputStream(Uri.parse(song.audioUri)) ?: throw FileNotFoundException("Could not read ${song.audioUri}")
            input.use { raw ->
                if (kind == Id3.Audio.MP3) {
                    // Our tag replaces whatever the file came with.
                    skipFully(raw, head.tagBytes)
                    out.write(
                        Id3.build(
                            Id3.Tags(
                                title = song.title,
                                artist = song.artist,
                                album = song.album,
                                lyrics = song.lyrics?.let { Id3.plainLyrics(it) },
                                cover = if (coverMime != null) cover else null,
                                coverMime = coverMime ?: "image/jpeg",
                            ),
                        ),
                    )
                }
                raw.copyTo(out)
            }
        }
        // The other extension of the same song (it was saved as .mp3 before and is .m4a now, or the reverse) is stale.
        val otherAudio = if (kind == Id3.Audio.M4A) "$base.mp3" else "$base.m4a"
        findChild(resolver, tree, folderId, otherAudio)?.let { try { DocumentsContract.deleteDocument(resolver, docUri(tree, it)) } catch (_: Exception) {} }

        if (cover != null && coverName != null && coverMime != null) {
            try {
                writeStream(resolver, treeUri, path, coverName, coverMime) { it.write(cover) }
            } catch (_: Exception) {
                // A missing picture is not a missing song.
            }
        }
        val coverSaved = coverName?.takeIf { findChild(resolver, tree, folderId, it) != null }

        val sidecar = JSONObject().apply {
            put("v", 1)
            put("id", song.id)
            put("title", song.title)
            put("artist", song.artist)
            song.album?.takeIf { it.isNotBlank() }?.let { put("album", it) }
            put("duration", if (song.duration.isFinite()) song.duration else 0.0)
            song.originId?.takeIf { it.isNotBlank() }?.let { put("originId", it) }
            song.coverRemoteUri?.takeIf { it.isNotBlank() }?.let { put("coverRemoteUri", it) }
            song.lyrics?.takeIf { it.isNotBlank() }?.let { put("lyrics", it) }
            put("file", audioName)
            coverSaved?.let { put("cover", it) }
        }
        writeStream(resolver, treeUri, path, "$base.json", "application/json") { it.write(sidecar.toString().toByteArray(Charsets.UTF_8)) }
        return ExportResult(base, audioName, audioUri, coverSaved)
    }

    /** The id inside a details file, or null when it cannot be read. */
    private fun sidecarId(resolver: ContentResolver, tree: Uri, docId: String): String? = try {
        resolver.openInputStream(docUri(tree, docId))?.use { JSONObject(String(it.readBytes(), Charsets.UTF_8)).optString("id").takeIf { id -> id.isNotEmpty() } }
    } catch (_: Exception) {
        null
    }

    private class AudioHead(val tagBytes: Long, val afterTag: ByteArray)

    /** The size of any ID3 tag the audio starts with, and its first bytes after it (what [Id3.sniff] reads). */
    private fun audioHead(resolver: ContentResolver, uri: String): AudioHead {
        val first = ByteArray(10)
        val tagBytes = resolver.openInputStream(Uri.parse(uri))?.use { input ->
            val read = readUpTo(input, first)
            if (read < 10) 0L else Id3.tagLength(first).toLong()
        } ?: throw FileNotFoundException("Could not read $uri")
        val after = ByteArray(16)
        val read = resolver.openInputStream(Uri.parse(uri))?.use { input ->
            skipFully(input, tagBytes)
            readUpTo(input, after)
        } ?: 0
        return AudioHead(tagBytes, after.copyOf(read))
    }

    private fun readUpTo(input: InputStream, into: ByteArray): Int {
        var total = 0
        while (total < into.size) {
            val n = input.read(into, total, into.size - total)
            if (n < 0) break
            total += n
        }
        return total
    }

    private fun skipFully(input: InputStream, count: Long) {
        var left = count
        while (left > 0) {
            val skipped = input.skip(left)
            if (skipped > 0) {
                left -= skipped
            } else if (input.read() >= 0) {
                left -= 1
            } else {
                return
            }
        }
    }

    private fun readLimited(resolver: ContentResolver, uri: String, limit: Int): ByteArray? = try {
        resolver.openInputStream(Uri.parse(uri))?.use { input ->
            val buffer = ByteArray(limit + 1)
            val read = readUpTo(input, buffer)
            if (read > limit || read == 0) null else buffer.copyOf(read)
        }
    } catch (_: Exception) {
        null
    }

    /** Renames a file in [path]; false when the provider does not allow it or nothing by that name exists. */
    fun rename(context: Context, treeUri: String, path: List<String>, from: String, to: String): Boolean {
        val resolver = context.contentResolver
        val tree = Uri.parse(treeUri)
        val folderId = resolvePath(resolver, tree, path) ?: return false
        val id = findChild(resolver, tree, folderId, from) ?: return false
        if (findChild(resolver, tree, folderId, to) != null) return false
        return try {
            DocumentsContract.renameDocument(resolver, docUri(tree, id), to) != null
        } catch (_: Exception) {
            false
        }
    }

    /** What [path] holds; empty when the folder is not there. */
    fun list(context: Context, treeUri: String, path: List<String>): List<SafEntry> {
        val resolver = context.contentResolver
        val tree = Uri.parse(treeUri)
        val folderId = resolvePath(resolver, tree, path) ?: return emptyList()
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, folderId)
        val columns = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
        )
        val entries = ArrayList<SafEntry>()
        resolver.query(children, columns, null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) {
                entries.add(
                    SafEntry(
                        name = cursor.getString(1),
                        uri = docUri(tree, cursor.getString(0)).toString(),
                        isDirectory = cursor.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR,
                    )
                )
            }
        }
        return entries
    }

    /** True while the grant for [treeUri] is still held (an uninstall drops it; so does removing the folder). */
    fun canWrite(context: Context, treeUri: String): Boolean {
        val tree = Uri.parse(treeUri)
        return context.contentResolver.persistedUriPermissions.any { it.uri == tree && it.isWritePermission }
    }
}
