"""Build every round-5 board into ./project, plus a local preview (covers mapped to local files)."""
import os
import re
import sys
import shutil

from v5_kit import COVERS, board, cell, sheet, opt, ib, ic, song_row, toast, SHELL_H
import v5_core as C

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "project")
PREVIEW = sys.argv[1] if len(sys.argv) > 1 else None  # folder holding covers/<name>.jpg


def boards():
    B = {}
    B["V5-System.dc.html"] = ("Design system", C.system_board(), 1320, 900, "accent")
    B["V5-Components.dc.html"] = ("Components", C.components_board(), 1320, 1250, "accent")

    B["V5-Library.dc.html"] = ("1 · Library: songs", board("Library", [
        cell("Songs, playing", "List first: tabs, filter (count in the placeholder), a labelled sort button and Shuffle sit above the songs. ⋮ on every row.",
             C.library_songs(), proposals=["Search and You join the bar; Playlists becomes a Library tab; the header keeps only Downloads and ⋮ (Import, Blends)"]),
        cell("Sort sheet open", "Half-height sheet with only the three supported sorts; the choice applies at once.",
             C.library_songs(sheet_html=C.sort_sheet(["Recently added", "Title A–Z", "Artist"], "Recently added", note="Your choice is kept for next time.")),
             proposals=["Remember the sort (today it resets)"]),
        cell("Sorted A–Z, scrolling", "A fast-scroll thumb with the letter appears while you drag the list edge, then hides, so it never covers ⋮.",
             C.library_songs("az"), proposals=["Replaces the always-on A–Z rail"]),
        cell("Loading", "Placeholders in the shape of rows; tabs and tools are usable at once.", C.library_songs("loading")),
        cell("Empty library", "First use: two real ways in. No mini player until something has played.", C.library_songs("empty")),
        cell("No access to music files", "Only after the listener chose “Add songs from this phone” and refused the permission.", C.library_songs("denied"),
             proposals=["Copy for an existing permission flow"]),
    ]), None, None, "accent")

    B["V5-Playlist.dc.html"] = ("2 · Playlist", board("Playlist", [
        cell("Playlist", "Cover beside the name keeps five songs above the fold. Play is the one white action; Shuffle secondary; order and Add songs share one row.", C.playlist_detail()),
        cell("Order sheet", "Custom order, Title, Artist, Recently added: what the app supports.",
             C.playlist_detail(sheet_html=C.sort_sheet(["Custom order", "Title", "Artist", "Recently added"], "Custom order", "Order songs by"))),
        cell("Playlist options (⋮)", "Everything about the playlist in one sheet.",
             C.playlist_detail(sheet_html='<div class="scrim"></div>' + sheet(
                 '<div class="sh"><span class="id"><b>Night drive</b><span class="meta">Playlist · 24 songs</span></span>' + ib("close", "Close") + "</div>"
                 + opt("add", "Add songs") + opt("reorder", "Edit order") + opt("photo_library", "Cover from your photos") + opt("grid_view", "Use the songs’ covers")
                 + '<div class="hr"></div>' + opt("edit", "Rename playlist") + opt("delete", "Delete playlist…", danger=True), "Playlist options")),
             proposals=["Rename and Delete also here (today only on long press in Playlists)"]),
        cell("Edit order", "Drag handles replace ⋮; screen readers get Move up / Move down actions. Done saves.", C.playlist_detail("edit")),
        cell("Removed a song", "Removing is reversible, so it acts at once and offers Undo.",
             C.playlist_detail(toast_html=toast("Removed “Static in the Rain”", "Undo")), proposals=["Undo instead of today’s confirmation"]),
        cell("Empty playlist", "One clear next step.", C.playlist_detail("empty")),
    ]), None, None, "accent")

    B["V5-Search.dc.html"] = ("3 · Search", board("Search", [
        cell("Idle", "Recent searches (up to 10) with Clear; each can be removed. No mood tiles here: moods live on Stream.", C.search_screen("idle"),
             proposals=["Search is a tab", "Mic moves into the field", "Mood tiles leave Search (they stay on Stream)"]),
        cell("Typing", "Results group as you type: artists, on this phone (instant), online (loading). The shell steps aside for the keyboard.", C.search_screen("typing"),
             proposals=["Hide the shell while the keyboard is up"]),
        cell("Results", "Scopes filter: All, On this phone, Online. Query and scroll position survive opening a result and coming back.", C.search_screen("results")),
        cell("No results", "Says what was searched and what to try.", C.search_screen("none")),
        cell("Catalog unreachable", "Online part failed; phone results still show. Try again retries only the online part.", C.search_screen("error")),
    ]), None, None, "accent")

    B["V5-NowPlaying.dc.html"] = ("4 · Now playing", board("Now playing", [
        cell("Playing", "Depth from the cover itself: blurred full-screen behind, lifted by its own coloured shadow, darkened only under the controls. One frosted play disc; text in on-media whites. No volume row: device keys handle volume, and the space goes to the cover (342) and calmer gaps.", C.now_playing("playing")),
        cell("Loading", "Only the play disc changes: a spinner until the player reports audio (aria-busy; TalkBack says “Loading”). Reduce Motion: the spinner holds still as a ring. Nothing moves.", C.now_playing("loading"),
             gaps=["show the buffering state the player already reports (playWhenReady vs isPlaying)"]),
        cell("Couldn’t play", "The disc becomes Try again (retry icon); an error mark appears in the empty middle of the time row. Shape, not colour, carries it; TalkBack announces the failure once.", C.now_playing("error"),
             gaps=["surface MainPlayer.onPlaybackError (exists, never shown)"]),
        cell("Couldn’t play: details", "Tapping the error mark opens a short explanation with Try again, above the controls; it closes on tap outside or Back.", C.now_playing("error_detail")),
        cell("Lyrics", "Lyrics take the screen. Kept: the cover (tap it, or the lit lyrics button, to go back), the seek line and previous · play · next. Lines far from the sung one soften.", C.now_playing_lyrics()),
        cell("Up next (half)", "Top half: the playing cover with the next three fanned behind it, then title, seek, transport. Bottom half: a glass panel with source, shuffle and repeat, one segmented filter and calm 56 rows; autoplay songs are labelled.", C.now_playing_upnext()),
        cell("Up next (pulled up)", "Drag the panel up for the whole queue; the playing song shrinks to a compact row with play/pause.", C.upnext_full()),
        cell("Player ⋮", "The same song actions as everywhere, then the player’s own tools. Rows the song can’t use are left out.", C.now_playing(sheet_html=C.player_menu()),
             proposals=["One action model: today’s Radio/Add/Share pills become rows; Shuffle, Repeat, Like and Lyrics leave the menu because they are on the screen"]),
    ]), None, None, "accent")

    B["V5-SongActions.dc.html"] = ("5 · Song actions", board("Song actions", [
        cell("Library song (⋮ or long press)", "One sheet, grouped: play and organise · lyrics and sharing · edit · hide and delete.",
             C.library_songs(sheet_html='<div class="scrim"></div>' + C.song_actions("library"), pressed="small"),
             proposals=["Add to playlist and Go to artist join the Library sheet", "Cover options move to a second sheet"]),
        cell("Playlist song", "Adds “Remove from this playlist”, which is not deleting the song.",
             C.playlist_detail(sheet_html='<div class="scrim"></div>' + C.song_actions("playlist", "small"))),
        cell("Streamed song (Stream, Search)", "Only what a stream can do.",
             _with_overlay(C.search_screen("results"), '<div class="scrim"></div>' + C.song_actions("stream", "glass"))),
        cell("Change cover…", "Second level, back returns to the first sheet.", C.library_songs(sheet_html='<div class="scrim"></div>' + C.cover_submenu())),
        cell("Delete song…", "Irreversible, so it asks. The button names the action.",
             C.library_songs(sheet_html='<div class="scrim"></div>' + sheet(
                 '<div style="padding:8px 16px 0"><p class="lead">Delete “Small Hours”?</p><p class="body" style="margin-top:8px">It’s removed from this phone and from every playlist. This can’t be undone.</p></div>'
                 + '<div class="btns" style="margin-top:24px;flex-direction:column">' + '<button class="btn d blk">Delete song</button><button class="btn s blk">Cancel</button></div>', "Delete song?"))),
    ]), None, None, "accent")
    return B


def _with_overlay(phone_html, overlay):
    """Insert an overlay into a rendered phone (before the status bar)."""
    i = phone_html.rfind('<div class="sb"')
    return phone_html[:i] + overlay + phone_html[i:]


C._with_overlay = _with_overlay


def main():
    os.makedirs(OUT, exist_ok=True)
    import v5_round6 as R6  # patches the kit before anything renders
    import v6_finish as V6
    try:
        import v5_rest as R
        extra = R.boards(_with_overlay)
    except ImportError:
        extra = {}
    import v5_map as M
    all_b = {"V5-Navigation.dc.html": ("Navigation map", M.ia_board(), 1360, 980, "accent")}
    all_b.update(boards())
    all_b.update(extra)
    all_b.update(R6.boards())
    all_b = {k: (t, h.replace('class="btn s blk">Cancel', 'class="btn t blk">Cancel'), w, hh, p) for k, (t, h, w, hh, p) in all_b.items()}
    all_b["V5-Coverage.dc.html"] = ("Coverage", M.coverage_board(), 1360, 2700, "full")
    all_b = V6.finish(all_b)
    with open(os.path.join(HERE, "coverage-matrix.md"), "w", encoding="utf-8") as f:
        f.write(M.markdown_matrix() + "\n")
    for name, (title, html, w, h, page) in all_b.items():
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
            f.write(html)
    if PREVIEW:
        os.makedirs(PREVIEW, exist_ok=True)
        inv = {v: k for k, v in COVERS.items()}
        parts = []
        for name, (title, html, w, h, page) in all_b.items():
            body = html.split("</helmet>", 1)[1].split("</x-dc>", 1)[0]
            body = re.sub(r"/_blob/([0-9a-f]{32})", lambda m: f"{inv[m.group(1)]}.jpg", body)
            parts.append(f'<h1 style="font:700 22px Inter;color:#fff;margin:40px 32px 0">{title} <span style="color:#888;font-weight:400;font-size:14px">{name}</span></h1>{body}')
            hd = html.split("<helmet>", 1)[1].split("</helmet>", 1)[0]
            with open(os.path.join(PREVIEW, name.replace(".dc.html", ".html")), "w", encoding="utf-8") as f:
                f.write(f'<!doctype html><html><head><meta charset="utf-8">{hd}</head><body style="display:inline-block">{body}</body></html>')
        head = all_b["V5-System.dc.html"][1].split("<helmet>", 1)[1].split("</helmet>", 1)[0]
        with open(os.path.join(PREVIEW, "index.html"), "w", encoding="utf-8") as f:
            f.write(f'<!doctype html><html><head><meta charset="utf-8"><title>LuvLyrics V6 designs</title>{head}</head><body>{"".join(parts)}</body></html>')
    for folder in (OUT, PREVIEW):
        if folder:
            os.makedirs(os.path.join(folder, "assets"), exist_ok=True)
            shutil.copyfile(os.path.join(HERE, "assets", "Ionicons.ttf"), os.path.join(folder, "assets", "Ionicons.ttf"))
            shutil.copyfile(os.path.join(HERE, "assets", "IONICONS-LICENSE.txt"), os.path.join(folder, "assets", "IONICONS-LICENSE.txt"))
    print(len(all_b), "boards")
    return all_b


if __name__ == "__main__":
    main()
