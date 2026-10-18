package com.lyricflow.app.island

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IslandLibraryTest {

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
}
