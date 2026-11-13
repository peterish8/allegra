package com.lyricflow.app.saf

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import java.io.FileNotFoundException

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
        val tree = Uri.parse(treeUri)
        val parentId = ensurePath(resolver, tree, path)
        findChild(resolver, tree, parentId, name)?.let { stale ->
            DocumentsContract.deleteDocument(resolver, docUri(tree, stale))
        }
        val created = DocumentsContract.createDocument(resolver, docUri(tree, parentId), mime, name)
            ?: throw FileNotFoundException("Could not create $name")
        try {
            resolver.openOutputStream(created, "w")?.use { out ->
                when {
                    sourceUri != null -> resolver.openInputStream(Uri.parse(sourceUri))?.use { it.copyTo(out) }
                        ?: throw FileNotFoundException("Could not read $sourceUri")
                    text != null -> out.write(text.toByteArray(Charsets.UTF_8))
                    else -> throw IllegalArgumentException("Nothing to write")
                }
            } ?: throw FileNotFoundException("Could not open $name for writing")
        } catch (e: Exception) {
            // A half-written file would read as a song; take it away.
            try { DocumentsContract.deleteDocument(resolver, created) } catch (_: Exception) {}
            throw e
        }
        return created.toString()
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
