package com.lyricflow.app.island

import android.app.Application
import android.os.Looper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.After
import org.junit.Before
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class, sdk = [28])
@LooperMode(LooperMode.Mode.PAUSED)
class IslandLibraryTest {

    @Before
    fun resetSearch() {
        IslandLibrary.onSearch = {}
        IslandLibrary.onChange = null
        IslandLibrary.query("")
        IslandLibrary.setDownloads("[]")
        shadowOf(Looper.getMainLooper()).idle()
    }

    @After
    fun releaseListeners() {
        IslandLibrary.onSearch = null
        IslandLibrary.onChange = null
        shadowOf(Looper.getMainLooper()).idle()
    }

    @Test
    fun `partial online answers keep the searching footer until the final answer`() {
        IslandLibrary.setDownloads("""[{"id":"local","title":"Halo","artist":"Beyonce"}]""")
        shadowOf(Looper.getMainLooper()).idle()
        IslandLibrary.query("halo")
        IslandLibrary.setSearchResults("halo", """[{"id":"online","title":"Halo live","artist":"Beyonce"}]""", done = false)
        assertEquals("answers wait for the main looper", listOf("local"), IslandLibrary.searchResults.map { it.id })
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf("local", "online"), IslandLibrary.searchResults.map { it.id })
        assertTrue(IslandLibrary.searching)
        IslandLibrary.setSearchResults("halo", """[{"id":"online","title":"Halo live","artist":"Beyonce"}]""", done = true)
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(IslandLibrary.searching)
        assertEquals(listOf("local", "online"), IslandLibrary.searchResults.map { it.id })
    }

    @Test
    fun `a new keystroke rejects an older answer already queued on the main looper`() {
        IslandLibrary.query("old")
        IslandLibrary.setSearchResults("old", """[{"id":"old-answer","title":"Old"}]""", done = true)
        IslandLibrary.query("new")
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("new", IslandLibrary.searchQuery)
        assertTrue(IslandLibrary.searchResults.isEmpty())
        assertTrue("the newer query is still waiting", IslandLibrary.searching)
        IslandLibrary.setSearchResults("new", """[{"id":"new-answer","title":"New"}]""", done = true)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf("new-answer"), IslandLibrary.searchResults.map { it.id })
        assertFalse(IslandLibrary.searching)
    }

    @Test
    fun `playlists keep their songs and drop what cannot be shown`() {
        val list = IslandLibrary.parse(
            """[{"id":"p1","name":"Late night drive","cover":"https://x/c.jpg","count":3,
                 "songs":[{"id":"s1","title":"A","artist":"B","cover":"file:///c.jpg"},{"title":"no id"}]},
                {"name":"no id"},
                {"id":"p2","name":"","cover":"javascript:alert(1)"}]""",
        )
        assertEquals(2, list.size)
        assertEquals("Late night drive", list[0].name)
        assertEquals(3, list[0].count)
        assertEquals(listOf("s1"), list[0].songs.map { it.id })
        assertEquals("file:///c.jpg", list[0].songs[0].cover)
        assertEquals("a name always shows", "Playlist", list[1].name)
        assertEquals("only file, content and https covers load", "", list[1].cover)
        assertEquals(0, list[1].count)
    }

    @Test
    fun `a malformed snapshot leaves the lists empty instead of throwing`() {
        assertTrue(IslandLibrary.parse("not json").isEmpty())
        assertTrue(IslandLibrary.parseSongs("{").isEmpty())
    }

    @Test
    fun `downloads and search answers are plain song rows`() {
        val songs = IslandLibrary.parseSongs("""[{"id":"d1","title":"T","artist":"A","cover":"content://m/1"},{"id":""}]""")
        assertEquals(1, songs.size)
        assertEquals("content://m/1", songs[0].cover)
    }

    @Test
    fun `the fallback link plays the picked song through the widget link`() {
        assertEquals("lyricflow://widget/play?playlist=p%201&song=s%2F2", IslandLibrary.link("p 1", "s/2"))
    }

    @Test
    fun `search answers say which songs are on the phone`() {
        val songs = IslandLibrary.parseSongs("""[{"id":"d1","title":"T","artist":"A","downloaded":true},{"id":"o1","title":"T2","artist":"A"}]""")
        assertTrue(songs[0].downloaded)
        assertFalse(songs[1].downloaded)
        assertTrue("every row of the downloads is on the phone", IslandLibrary.parseSongs("""[{"id":"d2"}]""", downloaded = true)[0].downloaded)
    }

    private fun song(id: String, title: String, artist: String, downloaded: Boolean = true) =
        IslandLibrary.Song(id, title, artist, "", downloaded)

    @Test
    fun `downloads match every word typed, in any case and without accents, title matches first`() {
        val downloads = listOf(
            song("1", "Tum Hi Ho", "Arijit Singh"),
            song("2", "Kesariya", "Arijit Singh, Pritam"),
            song("3", "Halo", "Beyoncé"),
            song("4", "Arijit's Medley", "Various"),
        )
        assertEquals(listOf("4", "1", "2"), IslandLibrary.matchDownloads("arijit", downloads).map { it.id })
        assertEquals(listOf("2"), IslandLibrary.matchDownloads("KES arij", downloads).map { it.id })
        assertEquals(listOf("3"), IslandLibrary.matchDownloads("beyonce", downloads).map { it.id })
        assertEquals("only songs holding the words", listOf("1"), IslandLibrary.matchDownloads("ho", downloads).map { it.id })
        assertTrue(IslandLibrary.matchDownloads("  ", downloads).isEmpty())
        assertTrue(IslandLibrary.matchDownloads("zzz", downloads).isEmpty())
    }

    @Test
    fun `downloads lead the answers and a song shows once`() {
        val local = listOf(song("d1", "Kesariya", "Arijit Singh"))
        val answers = listOf(
            song("o1", "Kesariya", "Arijit Singh", downloaded = false),
            song("o2", "Kesariya (Remix)", "Arijit Singh", downloaded = false),
            song("d9", "Kesariya Lofi", "Arijit Singh"),
            song("d1", "Kesariya", "Arijit Singh"),
        )
        assertEquals(listOf("d1", "d9", "o2"), IslandLibrary.merge(local, answers).map { it.id })
    }

    @Test
    fun `search folds text the way the app does`() {
        assertEquals("beyonce halo", IslandLibrary.fold("  Beyoncé – Halo! "))
    }
}
