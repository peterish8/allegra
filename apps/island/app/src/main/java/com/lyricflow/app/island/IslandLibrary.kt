package com.lyricflow.app.island

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import java.text.Normalizer

/**
 * What the island lists, handed over by JavaScript whenever it changes (`DynamicIslandModule`): the listener's
 * playlists with their songs, the downloaded songs (for offline listening), and the answers to a search typed in
 * the island. A song picked in the island goes back to JavaScript (`onIslandPick`), which plays it the way the app
 * would: a playlist as the playlist page does (online songs resolved, a pick made while another device plays goes
 * there), a download from the downloads with its lyrics, a search answer with similar songs queued after it.
 *
 * Search covers both: the downloads that match show on the keystroke (they are already here, so no wait and no
 * network), and the online answers join under them when JavaScript has them.
 */
object IslandLibrary {
    class Song(val id: String, val title: String, val artist: String, val cover: String, val downloaded: Boolean = false) {
        /** Title and artist folded for matching: lower case, accents off, words only. */
        val key: String by lazy { fold("$title $artist") }
    }
    class Playlist(val id: String, val name: String, val cover: String, val count: Int, val songs: List<Song>)

    /** The list a pick names for the downloads and for search answers (playlists use their own id). */
    const val DOWNLOADS = "island:downloads"
    const val SEARCH = "island:search"

    @Volatile var playlists: List<Playlist> = emptyList()
        private set
    @Volatile var downloads: List<Song> = emptyList()
        private set
    /** The answers for [searchQuery], downloads first; the first is the best match. */
    @Volatile var searchResults: List<Song> = emptyList()
        private set
    @Volatile var searchQuery: String = ""
        private set
    /** The downloads matching [searchQuery], shown before the online answers arrive. */
    private var localResults: List<Song> = emptyList()
    /** True from a query until its online answer (or the next query): the island shows that it is looking. */
    @Volatile var searching = false
        private set

    /** Set while JavaScript listens for searches; null when it does not (the island then says to open the app). */
    @Volatile var onSearch: ((query: String) -> Unit)? = null

    /** Told on the main thread whenever the playlists change. The island's view sets it while attached. */
    @Volatile var onChange: (() -> Unit)? = null

    /** Set while JavaScript listens for picks; null when it does not (the island then opens the app). */
    @Volatile var onPick: ((playlistId: String, songId: String) -> Unit)? = null

    /**
     * Set while JavaScript listens: keeps its timers running for a moment (`IslandJsAwake`). The island calls it
     * when the song changes behind another app, so that song's lyrics, fetched by JavaScript, still reach it.
     */
    @Volatile var onWake: (() -> Unit)? = null

    fun wakeJs() {
        onWake?.invoke()
    }

    private val main by lazy { Handler(Looper.getMainLooper()) }

    fun set(json: String) {
        playlists = parse(json)
        main.post { onChange?.invoke() }
    }

    fun setDownloads(json: String) {
        downloads = parseSongs(json, downloaded = true)
        main.post { onChange?.invoke() }
    }

    /**
     * Online answers for [query], joined under its downloads; answers to an older query are dropped. They come in
     * as they are found: until [done] the island still says it is looking. Parsed on the caller's (JavaScript's)
     * thread, applied on the main thread, where typing changes the query, so a keystroke in between never leaves
     * the last query's answers under the new one.
     */
    fun setSearchResults(query: String, json: String, done: Boolean = true) {
        val answers = parseSongs(json)
        main.post {
            if (query != searchQuery) return@post
            searchResults = merge(localResults, answers)
            searching = !done && onSearch != null
            onChange?.invoke()
        }
    }

    /** Typed [query]: its downloads show at once. The online answers are asked for with [search] once typing rests. */
    fun query(query: String) {
        if (query == searchQuery) return
        searchQuery = query
        localResults = if (query.isBlank()) emptyList() else matchDownloads(query)
        searchResults = localResults
        searching = query.isNotBlank() && onSearch != null
    }

    /** True when JavaScript will look [query] up online; false when nothing listens (only the downloads answer). */
    fun search(query: String): Boolean {
        query(query)
        if (query.isBlank()) return true
        val listener = onSearch
        if (listener == null) {
            searching = false
            return false
        }
        searching = true
        listener(query)
        return true
    }

    /**
     * The downloads whose title and artist hold every word of [query], best first: the title starting with it,
     * then a title word starting with it, then the rest (newest first within each).
     */
    fun matchDownloads(query: String, from: List<Song> = downloads): List<Song> {
        val q = fold(query)
        if (q.isEmpty()) return emptyList()
        val words = q.split(' ')
        return from.asSequence()
            .filter { song -> words.all { song.key.contains(it) } }
            .sortedBy { song ->
                val title = fold(song.title)
                when {
                    title.startsWith(q) -> 0
                    title.contains(" $q") -> 1
                    title.contains(q) -> 2
                    else -> 3
                }
            }
            .take(LOCAL_LIMIT)
            .toList()
    }

    /** [local] first, then the answers (their downloads before the online songs), each song once. */
    fun merge(local: List<Song>, answers: List<Song>): List<Song> {
        val ids = HashSet<String>()
        val keys = HashSet<String>()
        val out = ArrayList<Song>(local.size + answers.size)
        for (song in local + answers.filter { it.downloaded } + answers.filterNot { it.downloaded }) {
            if (song.id in ids || (song.key.isNotEmpty() && song.key in keys)) continue
            ids += song.id
            keys += song.key
            out += song
        }
        return out
    }

    /** Lower case, accents off, anything but letters and digits a single space: "Beyoncé – Halo" → "beyonce halo". */
    fun fold(text: String): String =
        Normalizer.normalize(text.lowercase(), Normalizer.Form.NFD)
            .replace(MARKS, "")
            .replace(NON_WORD, " ")
            .trim()

    private val MARKS = Regex("\\p{Mn}+")
    private val NON_WORD = Regex("[^\\p{L}\\p{N}]+")
    private const val LOCAL_LIMIT = 8

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

    /** `[{id, title, artist, cover, downloaded?}]`, malformed rows dropped; [downloaded] marks every row as on the phone. */
    fun parseSongs(json: String, downloaded: Boolean = false): List<Song> = try {
        songsOf(JSONArray(json), downloaded)
    } catch (_: Exception) {
        emptyList()
    }

    private fun songsOf(rows: JSONArray, downloaded: Boolean = false): List<Song> = (0 until rows.length()).mapNotNull { j ->
        val s = rows.optJSONObject(j) ?: return@mapNotNull null
        val songId = s.optString("id")
        if (songId.isEmpty()) null else Song(songId, s.optString("title"), s.optString("artist"), coverOf(s.optString("cover")),
            downloaded || s.optBoolean("downloaded", false))
    }

    /** Only addresses the island may load: files and content on the phone, covers over https. */
    private fun coverOf(uri: String): String {
        val scheme = uri.substringBefore(':', "").lowercase()
        return if (uri.length <= 4096 && (scheme == "file" || scheme == "content" || scheme == "https")) uri else ""
    }
}
