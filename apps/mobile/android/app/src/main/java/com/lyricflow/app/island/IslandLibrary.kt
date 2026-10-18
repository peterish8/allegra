package com.lyricflow.app.island

import android.os.Handler
import android.os.Looper
import org.json.JSONArray

/**
 * What the island lists, handed over by JavaScript whenever it changes (`DynamicIslandModule`): the listener's
 * playlists with their songs, the downloaded songs (for offline listening), and the answers to a search typed in
 * the island. A song picked in the island goes back to JavaScript (`onIslandPick`), which plays it the way the app
 * would: a playlist as the playlist page does (online songs resolved, a pick made while another device plays goes
 * there), a download from the downloads with its lyrics, a search answer with similar songs queued after it.
 */
object IslandLibrary {
    class Song(val id: String, val title: String, val artist: String, val cover: String)
    class Playlist(val id: String, val name: String, val cover: String, val count: Int, val songs: List<Song>)

    /** The list a pick names for the downloads and for search answers (playlists use their own id). */
    const val DOWNLOADS = "island:downloads"
    const val SEARCH = "island:search"

    @Volatile var playlists: List<Playlist> = emptyList()
        private set
    @Volatile var downloads: List<Song> = emptyList()
        private set
    /** The answers for [searchQuery]; the first is the best match. */
    @Volatile var searchResults: List<Song> = emptyList()
        private set
    @Volatile var searchQuery: String = ""
        private set
    /** True from a query until its answer (or the next query): the island shows that it is looking. */
    @Volatile var searching = false
        private set

    /** Set while JavaScript listens for searches; null when it does not (the island then says to open the app). */
    @Volatile var onSearch: ((query: String) -> Unit)? = null

    /** Told on the main thread whenever the playlists change. The island's view sets it while attached. */
    @Volatile var onChange: (() -> Unit)? = null

    /** Set while JavaScript listens for picks; null when it does not (the island then opens the app). */
    @Volatile var onPick: ((playlistId: String, songId: String) -> Unit)? = null

    private val main by lazy { Handler(Looper.getMainLooper()) }

    fun set(json: String) {
        playlists = parse(json)
        main.post { onChange?.invoke() }
    }

    fun setDownloads(json: String) {
        downloads = parseSongs(json)
        main.post { onChange?.invoke() }
    }

    /** Answers for [query]; answers to an older query than the one last asked are dropped. */
    fun setSearchResults(query: String, json: String) {
        if (query != searchQuery) return
        searchResults = parseSongs(json)
        searching = false
        main.post { onChange?.invoke() }
    }

    /** True when JavaScript will look [query] up; an empty query clears the answers. */
    fun search(query: String): Boolean {
        searchQuery = query
        if (query.isBlank()) {
            searchResults = emptyList()
            searching = false
            return true
        }
        val listener = onSearch ?: return false
        searching = true
        listener(query)
        return true
    }

    /** True when JavaScript took the pick; false when nothing listens, so the caller opens the app instead. */
    fun pick(playlistId: String, songId: String): Boolean {
        val listener = onPick ?: return false
        listener(playlistId, songId)
        return true
    }

    /** The link that plays [songId] from [playlistId] with the app opened (the widget's link, handled in JavaScript). */
    fun link(playlistId: String, songId: String): String =
        "lyricflow://widget/play?playlist=${android.net.Uri.encode(playlistId)}&song=${android.net.Uri.encode(songId)}"

    /**
     * `[{id, name, cover, count, songs: [{id, title, artist, cover}]}]`. Anything malformed is dropped rather than
     * thrown: a bad snapshot leaves the island with fewer rows, never with a crash in the accessibility service.
     */
    fun parse(json: String): List<Playlist> = try {
        val list = JSONArray(json)
        (0 until list.length()).mapNotNull { i ->
            val p = list.optJSONObject(i) ?: return@mapNotNull null
            val id = p.optString("id")
            if (id.isEmpty()) return@mapNotNull null
            val songs = songsOf(p.optJSONArray("songs") ?: JSONArray())
            Playlist(id, p.optString("name").ifEmpty { "Playlist" }, coverOf(p.optString("cover")), p.optInt("count", songs.size), songs)
        }
    } catch (_: Exception) {
        emptyList()
    }

    /** `[{id, title, artist, cover}]`, malformed rows dropped. */
    fun parseSongs(json: String): List<Song> = try {
        songsOf(JSONArray(json))
    } catch (_: Exception) {
        emptyList()
    }

    private fun songsOf(rows: JSONArray): List<Song> = (0 until rows.length()).mapNotNull { j ->
        val s = rows.optJSONObject(j) ?: return@mapNotNull null
        val songId = s.optString("id")
        if (songId.isEmpty()) null else Song(songId, s.optString("title"), s.optString("artist"), coverOf(s.optString("cover")))
    }

    /** Only addresses the island may load: files and content on the phone, covers over https. */
    private fun coverOf(uri: String): String {
        val scheme = uri.substringBefore(':', "").lowercase()
        return if (uri.length <= 4096 && (scheme == "file" || scheme == "content" || scheme == "https")) uri else ""
    }
}
