"""Round 5 core: system + components boards, and the five validation screens with their states."""
from v5_kit import *  # noqa: F401,F403
from v5_kit import esc, SHELL_H

SONGS.update({
    "glass": ("Glasshouse", "Mira Vale", "3:47", "golden-hour", False),
    "under": ("Undertow", "Mira Vale", "4:02", "static-rain", False),
    "memo": ("Voice memo 14", "Unknown artist", "1:02", None, False),
})


def ul(rows):
    return "<ul>" + "".join(rows) + "</ul>"


# ================================================================= LIBRARY
def library_header(dl_badge=None):
    return (f'<header class="page"><h1>Library</h1>{ib("download", "Downloads" + (f", {dl_badge} in progress" if dl_badge else ""), badge=dl_badge)}'
            f'{ib("more_vert", "More library options")}</header>')


def library_tabs(active="songs"):
    tabs = [("songs", "Songs"), ("playlists", "Playlists"), ("artists", "Artists"), ("albums", "Albums")]
    return ('<div class="tabs" role="tablist" aria-label="Show in Library">' + "".join(
        f'<button class="tab{" on" if k == active else ""}" role="tab" aria-selected="{str(k == active).lower()}">{t}</button>' for k, t in tabs) + "</div>")


def sort_button(label, aria_prefix="Sort"):
    return (f'<button class="sortb" aria-haspopup="dialog" aria-label="{aria_prefix}: {esc(label)}. Change">'
            f'<span>{ic("swap_vert")}{esc(label)}{ic("expand_more", cls="c")}</span></button>')


def library_tools(sort="Recently added", count=248, query=None):
    field = (f'<label class="field{" focus" if query else ""}">{ic("search")}'
             + (f'<span class="v">{esc(query)}<span class="caret"></span></span>{ib("close", "Clear filter", muted=True, size=20)}' if query
                else f'<span class="v ph-t">Filter {count} songs</span>')
             + "</label>")
    return (f'<div style="padding:12px 16px 0">{field}</div>'
            f'<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 4px 0 16px">{sort_button(sort)}'
            f'<button class="btn t sm" aria-label="Shuffle all {count} songs">{ic("shuffle")}<span class="bl">Shuffle</span></button></div>')


LIB_RECENT = ["low", "baarish", "static", "small", "lanterns", "fade", "golden", "drive"]
LIB_AZ = ["baarish", "fade", "golden", "low", "mix", "drive", "lanterns", "small"]


def library_songs(state="default", mini="playing", sheet_html="", pressed=None, pk=None):
    if state == "loading":
        body = library_header() + library_tabs() + library_tools() + skeleton_rows(7)
        return phone(body, shell("library", mini))
    if state == "empty":
        body = (library_header() + library_tabs() + '<div style="flex:1;display:flex;align-items:center;padding-bottom:120px">'
                + empty_state("library_music", "Your library is empty",
                              "Songs you save from Stream, or add from this phone, show up here.",
                              '<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;width:100%">'
                              + btn("Find songs on Stream", "p", "radio") + btn("Add songs from this phone", "s", "smartphone") + "</div>")
                + "</div>")
        return phone(body, shell("library", None), glow_cover=None)
    if state == "denied":
        body = (library_header() + library_tabs() + '<div style="flex:1;display:flex;align-items:center;padding-bottom:120px">'
                + empty_state("folder_off", "LuvLyrics can’t see your music files",
                              "You turned off access to audio. Allow it in Android settings to add songs from this phone.",
                              '<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;width:100%">'
                              + btn("Open Android settings", "p", "open_in_new") + btn("Not now", "t") + "</div>")
                + "</div>")
        return phone(body, shell("library", None), glow_cover=None)
    order = LIB_AZ if state == "az" else LIB_RECENT
    sort = "Title A–Z" if state == "az" else "Recently added"
    rows = []
    for i, k in enumerate(order):
        st = "playing" if k == "low" and mini == "playing" else "paused" if k == "low" and mini == "paused" else None
        rows.append(song_row(k, st, pressed=(k == pressed)))
    body = library_header() + library_tabs() + library_tools(sort) + ul(rows)
    overlay = ""
    if state == "az":
        overlay = ('<div aria-hidden="true" style="position:absolute;right:4px;top:300px;z-index:30;display:flex;align-items:center;gap:8px">'
                   '<span style="width:56px;height:56px;border-radius:28px 28px 4px 28px;background:var(--t1);color:var(--base);display:flex;align-items:center;justify-content:center;font:700 26px Inter">M</span>'
                   '<span style="width:6px;height:48px;border-radius:3px;background:var(--t2)"></span></div>')
    return phone(body, shell("library", mini), overlay + sheet_html, **(pk or {}))


# ================================================================= PLAYLIST
def playlist_header(name="Night drive", count=24, dur="1 h 32 min", cover="night-drive", empty=False):
    a = (f'<span class="tile" style="width:120px;height:120px;border-radius:12px;flex-shrink:0" aria-hidden="true">{ic("queue_music", size=44, color="var(--t2)")}</span>'
         if empty else f'<img src="{cov(cover)}" alt="" style="width:120px;height:120px;border-radius:12px;object-fit:cover;flex-shrink:0;box-shadow:0 12px 28px rgba(0,0,0,.4)">')
    meta = "Playlist · No songs yet" if empty else f"Playlist · {count} songs · {dur}"
    return (f'<div style="display:flex;gap:16px;align-items:flex-end;padding:8px 16px 0">{a}'
            f'<div style="display:flex;flex-direction:column;gap:4px;min-width:0;padding-bottom:4px"><h1 style="font:700 24px/30px Inter">{esc(name)}</h1>'
            f'<p class="meta">{meta}</p></div></div>')


def playlist_top(name="Night drive"):
    return (f'<div class="top">{ib("arrow_back", "Back to Library")}<span class="tt"></span>'
            f'{ib("search", f"Find in {name}")}{ib("more_vert", f"{name} options")}</div>')


PL_ROWS = ["low", "small", "baarish", "static", "fade", "golden", "drive"]


def playlist_detail(state="default", mini="playing", sheet_html="", toast_html="", pk=None):
    bg = ""
    if state == "edit":
        top = (f'<div class="top">{ib("close", "Stop editing order")}<span class="tt">Edit order</span>'
               f'<button class="btn t">Done</button></div>')
        rows = [song_row(k, "playing" if k == "low" else None, trailing="drag") for k in PL_ROWS]
        body = top + '<p class="meta" style="padding:4px 16px 12px">Drag a song by its handle, or use the screen reader’s Move up and Move down actions.</p>' + ul(rows)
        return phone(body, shell("library", mini), sheet_html, bg=bg)
    if state == "empty":
        body = (playlist_top("Road trip") + playlist_header("Road trip", empty=True)
                + '<div style="flex:1;display:flex;align-items:center;padding-bottom:150px">'
                + empty_state("playlist_add", "No songs yet", "Add songs you saved or streamed.",
                              '<div style="margin-top:16px">' + btn("Add songs", "p", "add") + "</div>") + "</div>")
        return phone(body, shell("library", mini), sheet_html)
    rows = [song_row(k, "playing" if (k == "low" and mini == "playing") else None) for k in PL_ROWS]
    body = (playlist_top() + playlist_header()
            + '<div class="btns" style="margin-top:16px">' + btn("Play", "p", "play_arrow", True) + btn("Shuffle", "s", "shuffle") + "</div>"
            + '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 4px 0 16px">'
            + sort_button("Custom order", "Order") + f'<button class="btn t sm">{ic("add")}Add songs</button></div>' + ul(rows))
    return phone(body, shell("library", mini), sheet_html + toast_html, bg=bg, **(pk or {}))


# ================================================================= SHEETS shared by many screens
def song_sheet_header(key, extra_meta=None):
    title, artist, _, cover, dl = SONGS[key]
    meta = extra_meta or (artist + (" · On this phone" if dl else " · Streaming"))
    return (f'<div class="sh">{art(cover)}<span class="id"><b>{esc(title)}</b><span class="meta">{esc(meta)}</span></span>'
            f'{ib("close", "Close")}</div><div class="hr" style="margin:4px 0 4px"></div>')


def song_actions(context="library", key="small"):
    h = song_sheet_header(key)
    if context == "stream":
        inner = h + opt("queue_play_next", "Play next") + opt("download", "Save to library", "Downloads it to this phone") + opt("playlist_add", "Add to playlist") \
            + opt("person", "Go to artist", SONGS[key][1]) + opt("share", "Share")
        return sheet(inner, "Song actions").replace('class="sheet"', 'class="sheet deep"', 1)
    groups = [
        opt("queue_play_next", "Play next") + opt("playlist_add", "Add to playlist") + opt("person", "Go to artist", SONGS[key][1]),
        opt("lyrics", "Find lyrics") + opt("translate", "Another language or version") + opt("share", "Share the audio"),
        opt("image", "Change cover…") + opt("edit", "Edit title and artist"),
    ]
    if context == "playlist":
        groups.append(opt("playlist_remove", "Remove from this playlist", "The song stays in your library"))
    groups.append(opt("visibility_off", "Hide this song") + opt("delete", "Delete song…", danger=True))
    inner = h + '<div class="hr"></div>'.join(groups)
    return sheet(inner, "Song actions").replace('class="sheet"', 'class="sheet deep"', 1)


def cover_submenu(key="small"):
    inner = (song_sheet_header(key, "Change cover") + opt("photo_library", "Cover from your photos") + opt("travel_explore", "Find a cover online")
             + opt("hide_image", "Remove the cover", "Goes back to the generated cover"))
    return sheet(inner, "Change cover").replace('class="sheet"', 'class="sheet deep"', 1)


def sort_sheet(options, current, title="Sort songs by", note=None):
    inner = f'<div class="sh"><h2>{esc(title)}</h2>{ib("close", "Close")}</div>'
    inner += "".join(opt(None, o, check=True, on=(o == current)) for o in options)
    if note:
        inner += f'<p class="cap12" style="padding:12px 16px 0">{esc(note)}</p>'
    return '<div class="scrim"></div>' + sheet(inner, title)


def player_menu(key="low"):
    title, artist, _, cover, _ = SONGS[key]
    h = song_sheet_header(key, artist + " · Night drive")
    groups = [
        opt("queue_play_next", "Play next") + opt("playlist_add", "Add to playlist") + opt("radio", "Start radio") + opt("share", "Share"),
        opt("person", "View artist", artist) + opt("lyrics", "Lyrics sources…") + opt("download", "Download"),
        opt("cast", "Cast to…") + opt("devices", "Connect devices", "Move playback to your other devices") + opt("group", "LuvLink", "Listen with friends in sync"),
        opt("fullscreen", "Ambient mode") + opt("info", "Details", "Song information, edit lyrics, cover") + opt("equalizer", "Equalizer")
        + opt("tune", "Tempo and pitch") + opt("refresh", "Reload the song") + opt("notifications", "Set as ringtone"),
    ]
    inner = h + '<div class="hr"></div>'.join(groups)
    return '<div class="scrim"></div>' + sheet(inner, "Player actions", top=40, extra_style="overflow:hidden")


# ================================================================= SEARCH
def search_field(query=None, focus=False):
    if query:
        inner = f'<span class="v">{esc(query)}{"<span class=caret></span>" if focus else ""}</span>{ib("close", "Clear search", muted=True, size=20)}'
    else:
        inner = f'<span class="v ph-t">Songs, artists, playlists</span>{ib("mic", "Search by voice", muted=True)}'
    return f'<div style="padding:4px 16px 0"><label class="field{" focus" if focus else ""}" role="search">{ic("search")}{inner}</label></div>'


def scopes(active="All"):
    return ('<div class="chips" role="radiogroup" aria-label="Search in" style="margin-top:4px">' + "".join(
        f'<button class="chip{" on" if s == active else ""}" role="radio" aria-checked="{str(s == active).lower()}"><span>{ic("check") if s == active else ""}{s}</span></button>'
        for s in ("All", "On this phone", "Online")) + "</div>")


def recent_row(kind, title, meta, cover=None, last=False):
    if kind == "artist":
        lead = art(cover, circle=True)
    elif kind == "query":
        lead = f'<span class="tile art" aria-hidden="true">{ic("history", color="var(--t2)")}</span>'
    else:
        lead = art(cover)
    return (f'<li class="row{" last" if last else ""}">{lead}<button class="rt" style="border:0;background:none;padding:0;text-align:left;color:inherit">'
            f'<b>{esc(title)}</b><s><em>{esc(meta)}</em></s></button>{ib("close", f"Remove {title} from recent searches", muted=True, size=20)}</li>')


def artist_row(name="Mira Vale", meta="Artist", cover="mira-vale", trailing=True, last=False):
    tr = ib("more_vert", f"More actions for {name}", muted=True) if trailing else ""
    return (f'<li class="row{" last" if last else ""}{"" if trailing else " nm"}">{art(cover, circle=True)}<button class="rt" style="border:0;background:none;padding:0;text-align:left;color:inherit">'
            f'<b>{esc(name)}</b><s><em>{esc(meta)}</em></s></button>{tr}</li>')


def search_screen(state="idle", pk=None):
    head = '<header class="page"><h1>Search</h1></header>'
    if state == "idle":
        body = (head + search_field()
                + '<div class="sec"><h2>Recent searches</h2><button class="btn t sm" aria-label="Clear recent searches">Clear</button></div>'
                + "<ul>" + recent_row("song", "Paper Lanterns", "Song · Mira Vale", "paper-lanterns")
                + recent_row("artist", "Mira Vale", "Artist", "mira-vale")
                + recent_row("query", "rainy morning hindi", "Search")
                + recent_row("song", "Low Tide", "Song · Harbor Kids", "low-tide")
                + recent_row("playlist", "Night drive", "Playlist · 24 songs", "night-drive", last=True) + "</ul>")
        return phone(body, shell("search"))
    if state == "typing":
        body = (head + search_field("mira", focus=True) + scopes("All")
                + '<p class="lbl" style="margin-top:8px">Artists</p><ul>' + artist_row(last=True) + "</ul>"
                + '<p class="lbl" style="margin-top:8px">On this phone</p><ul>' + song_row("small") + song_row("lanterns", last=True) + "</ul>"
                + '<p class="lbl" style="margin-top:8px">Online</p>' + skeleton_rows(1))
        return phone(body, "", keyboard(), **(pk or {}))
    if state == "results":
        body = (head + search_field("mira") + scopes("All")
                + '<p class="lbl" style="margin-top:8px">Artists</p><ul>' + artist_row(last=True) + "</ul>"
                + '<p class="lbl" style="margin-top:8px">On this phone</p><ul>' + song_row("small") + song_row("lanterns", last=True) + "</ul>"
                + '<p class="lbl" style="margin-top:8px">Online</p><ul>' + song_row("glass", meta="Song · Mira Vale") + song_row("under", meta="Song · Mira Vale") + "</ul>")
        return phone(body, shell("search"))
    if state == "none":
        body = (head + search_field("mira valee") + scopes("All")
                + '<div style="flex:1;display:flex;align-items:center;padding-bottom:180px">'
                + empty_state("search_off", "No results for “mira valee”", "Check the spelling, or try fewer words.") + "</div>")
        return phone(body, shell("search"))
    if state == "error":
        body = (head + search_field("mira") + scopes("All")
                + '<p class="lbl" style="margin-top:8px">On this phone</p><ul>' + song_row("small") + song_row("lanterns", last=True) + "</ul>"
                + '<p class="lbl" style="margin-top:8px">Online</p>'
                + '<div style="display:flex;gap:12px;align-items:flex-start;margin:8px 16px 0;padding:16px;border-radius:12px;background:var(--raised)">'
                + ic("cloud_off", color="var(--t2)") + '<div style="flex:1"><p style="font:600 15px/20px Inter">Can’t reach the catalog</p>'
                + '<p class="meta" style="margin-top:2px">Songs on this phone still show. Check your connection, then try again.</p>'
                + '<div style="margin-top:12px">' + btn("Try again", "s", "refresh") + "</div></div></div>")
        return phone(body, shell("search"))
    raise ValueError(state)


# ================================================================= NOW PLAYING
def np_top(source="Night drive"):
    return (f'<div class="top">{ib("expand_more", "Close player")}<button style="flex:1;border:0;background:none;color:inherit;display:flex;flex-direction:column;align-items:center;height:48px;justify-content:center" '
            f'aria-label="Playing from {esc(source)}. Open"><span class="cap12" style="color:var(--t2)">Playing from</span><span style="font:600 13px/18px Inter">{esc(source)}</span></button>'
            f'{ib("more_vert", "More actions for Low Tide")}</div>')


def np_title(liked=True, status=None):
    st = ""
    if status == "error":
        st = f'<p style="display:flex;align-items:center;gap:6px;margin-top:6px;font:400 13px/18px Inter;color:var(--t1)">{ic("error", size=16)}Couldn’t play this song. Check your connection.</p>'
    elif status == "loading":
        st = f'<p class="meta" style="display:flex;align-items:center;gap:6px;margin-top:6px"><span class="ring" aria-hidden="true"></span>Loading the song…</p>'
    return (f'<div style="display:flex;align-items:center;gap:8px;padding:0 12px 0 24px"><div style="flex:1;min-width:0">'
            f'<h1 style="font:700 22px/28px Inter">Low Tide</h1><button style="border:0;background:none;padding:0;font:400 16px/22px Inter;color:var(--t2)" aria-label="Harbor Kids. Go to artist">Harbor Kids</button>{st}</div>'
            f'{ib("favorite", "Liked" if liked else "Like", fill=liked, pressed=liked)}</div>')


def np_slider(pct=38, a="1:24", b="-2:17", dim=False):
    c = "var(--t2)" if dim else "var(--t1)"
    return (f'<div style="padding:12px 24px 0"><div role="slider" aria-label="Song position" aria-valuetext="{a} of 3:41" style="position:relative;height:48px;margin:-12px 0;display:flex;align-items:center">'
            f'<span style="position:absolute;left:0;right:0;height:4px;border-radius:2px;background:rgba(255,255,255,.18)"></span>'
            f'<span style="position:absolute;left:0;width:{pct}%;height:4px;border-radius:2px;background:{c}"></span>'
            f'<span style="position:absolute;left:calc({pct}% - 6px);width:12px;height:12px;border-radius:6px;background:{c}"></span></div>'
            f'<div style="display:flex;justify-content:space-between;font:400 12px Inter;color:var(--t2);font-variant-numeric:tabular-nums"><span>{a}</span><span>{b}</span></div></div>')


def np_transport(state="playing"):
    if state == "playing":
        mid = f'<button aria-label="Pause" style="width:72px;height:72px;border-radius:36px;border:0;background:var(--t1);color:var(--base);display:flex;align-items:center;justify-content:center">{ic("pause", True, 40)}</button>'
    elif state == "loading":
        mid = ('<button aria-label="Loading. Pause" aria-busy="true" style="width:72px;height:72px;border-radius:36px;border:0;background:var(--t1);display:flex;align-items:center;justify-content:center">'
               '<span class="ring lg" style="border-color:#C9CACD;border-top-color:var(--base);border-right-color:var(--base);width:28px;height:28px;border-width:3px" aria-hidden="true"></span></button>')
    else:
        mid = f'<button aria-label="Play" style="width:72px;height:72px;border-radius:36px;border:0;background:var(--t1);color:var(--base);display:flex;align-items:center;justify-content:center">{ic("play_arrow", True, 40)}</button>'
    big = 'style="width:56px;height:56px;border:0;background:none;color:var(--t1);display:flex;align-items:center;justify-content:center"'
    return (f'<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 16px 0">'
            f'{ib("shuffle", "Shuffle what plays next", muted=True)}'
            f'<button aria-label="Previous song" {big}>{ic("skip_previous", True, 40)}</button>{mid}'
            f'<button aria-label="Next song" {big}>{ic("skip_next", True, 40)}</button>'
            f'{ib("repeat_one", "Repeat this song", muted=True, pressed=False)}</div>')


def np_volume():
    return (f'<div style="display:flex;align-items:center;gap:8px;height:48px;padding:0 24px;margin-top:8px;color:var(--t2)" role="group" aria-label="Volume">'
            f'{ic("volume_down", size=20)}<span role="slider" aria-label="Volume" aria-valuetext="60 percent" style="position:relative;flex:1;height:48px;display:flex;align-items:center"><span style="position:relative;flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.18)">'
            f'<span style="position:absolute;left:0;top:0;width:60%;height:4px;border-radius:2px;background:var(--t2)"></span></span></span>{ic("volume_up", size=20)}</div>')


def np_bottom(lyrics_on=False, sleep_on=False):
    return (f'<div style="display:flex;align-items:center;justify-content:space-between;padding:0 12px;margin-top:auto;margin-bottom:28px">'
            f'{ib("queue_music", "Up next")}'
            f'<button style="display:flex;align-items:center;gap:6px;height:48px;padding:0 12px;border:0;background:none;color:var(--t2);font:400 13px Inter" aria-label="Playing on this phone. Choose where it plays">{ic("devices", size=20)}This phone</button>'
            f'{ib("bedtime", "Sleep timer" + (", 12 minutes left" if sleep_on else ""), fill=sleep_on)}'
            f'{ib("lyrics", "Lyrics", fill=lyrics_on, pressed=lyrics_on)}</div>')


def now_playing(state="playing", art_size=342, sheet_html="", volume=True, pk=None):
    bg = glow("low-tide", np=True)
    a = f'<img src="{cov("low-tide")}" alt="Cover of Low Tide" style="width:{art_size}px;height:{art_size}px;border-radius:12px;object-fit:cover;align-self:center;margin-top:12px;box-shadow:0 24px 48px rgba(0,0,0,.45)">'
    status = {"loading": "loading", "error": "error"}.get(state)
    tstate = {"playing": "playing", "loading": "loading", "error": "paused", "paused": "paused"}[state]
    body = (np_top() + a + '<div style="height:24px"></div>' + np_title(status=status) + np_slider(dim=(state == "error"))
            + np_transport(tstate) + (np_volume() if volume else "") + np_bottom(sleep_on=False))
    return phone(body, "", sheet_html, bg=bg, **(pk or {}))


LYRICS = ["and the harbour lights go out", "one by one, like the years we lost", "I count them on the water",
          "every light a name I used to know", "and the tide comes in"]


def now_playing_lyrics():
    bg = glow("low-tide", np=True)
    head = (f'<div style="display:flex;align-items:center;gap:12px;padding:8px 12px 0 24px">{art("low-tide", 48)}'
            f'<div style="flex:1;min-width:0"><p style="font:600 15px/20px Inter">Low Tide</p><p class="meta">Harbor Kids</p></div>{ib("favorite", "Liked", True, pressed=True)}</div>')
    lines = "".join(
        f'<p style="font:700 26px/34px Inter;margin-bottom:18px;opacity:{1 if i == 1 else .42}"' + (' aria-current="true"' if i == 1 else "") + f">{esc(t)}</p>"
        for i, t in enumerate(LYRICS))
    body = (np_top() + head + f'<div role="list" aria-label="Lyrics" style="padding:40px 24px 0;height:380px;overflow:hidden">{lines}</div>'
            + np_slider() + np_transport("playing") + np_bottom(lyrics_on=True))
    return phone(body, "", "", bg=bg)


def now_playing_upnext():
    bg = glow("low-tide", np=True, opacity=.45)
    compact = (f'<div style="display:flex;align-items:center;gap:12px;padding:4px 12px 0 24px">{art("low-tide", 56, radius=8)}'
               f'<div style="flex:1;min-width:0"><p style="font:700 18px/24px Inter">Low Tide</p><p class="meta">Harbor Kids</p></div>{ib("favorite", "Liked", True, pressed=True)}</div>')
    panel_rows = "".join(song_row(k, trailing="drag") for k in ["small", "baarish", "static", "fade"])
    panel = (f'<section aria-label="Up next" style="position:absolute;left:0;right:0;top:372px;bottom:0;background:var(--raised);border-radius:16px 16px 0 0;padding-top:8px;display:flex;flex-direction:column">'
             f'<div class="gr" aria-hidden="true"></div>'
             f'<div style="display:flex;align-items:center;padding:4px 4px 0 16px"><div style="flex:1"><p class="cap12" style="color:var(--t2)">Playing from</p><p style="font:600 15px/20px Inter">Night drive</p></div>'
             f'<button class="btn s" style="height:40px;padding:0 14px;margin-right:12px">{ic("shuffle")}Shuffle</button></div>'
             f'<div class="chips" role="radiogroup" aria-label="Show">'
             + "".join(f'<button class="chip{" on" if c == "All" else ""}" role="radio" aria-checked="{str(c == "All").lower()}"><span>{ic("check") if c == "All" else ""}{c}</span></button>' for c in ("All", "Familiar", "Discover"))
             + f'</div><ul>{panel_rows}</ul></section>')
    body = np_top() + compact + np_slider() + np_transport("playing")
    return phone(body, "", panel, bg=bg)


# ================================================================= SYSTEM + COMPONENTS boards (wide)
def swatch(color, name, note, border=False):
    b = ";box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)" if border else ""
    return (f'<div style="display:flex;align-items:center;gap:10px"><span style="width:36px;height:36px;border-radius:8px;background:{color}{b};flex-shrink:0"></span>'
            f'<span style="font:400 12px/16px Inter"><b style="font-weight:600;display:block">{name}</b><span style="color:var(--t2)">{note}</span></span></div>')


def h2(t, mt=0):
    return f'<h2 style="font:600 13px/18px Inter;color:var(--t2);margin:{mt}px 0 10px">{esc(t)}</h2>'


def note(t):
    return f'<p style="font:400 12px/17px Inter;color:var(--t2);margin-top:10px">{t}</p>'


def system_board():
    col1 = ('<h1 style="font:700 28px/34px Inter;margin-bottom:6px">System</h1><p style="font:400 13px/19px Inter;color:var(--t2);margin-bottom:22px">'
            'One quiet ground, white for the one primary action and selected states, colour only from artwork. Every board on this canvas is generated from these tokens.</p>'
            + h2("Colour roles")
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
            + swatch("#0B0D10", "Base #0B0D10", "Page", True) + swatch("#17191E", "Raised #17191E", "Shell, sheets, fields")
            + swatch("#22252C", "Control #22252C", "Secondary button, chip") + swatch("#2A2D34", "Pressed #2A2D34", "Pressed, toast, track")
            + swatch("#F4F4F5", "Text 1 · Accent", "Text, primary action") + swatch("#A3A5AE", "Text 2 #A3A5AE", "Meta, idle icons")
            + swatch("#8A8D96", "Text 3 #8A8D96", "Hints, placeholders") + swatch("#FF6B61", "Danger #FF6B61", "Delete only")
            + "</div>"
            + note("Contrast on Base / Raised: Text 1 17.7 / 16.0 · Text 2 7.9 / 7.2 · Text 3 5.9 / 5.3 · Danger 7.0 / 6.3 (all pass 4.5:1). Switch outline 4.6:1 (UI 3:1). Dividers white 6% (decorative). Scrim black 40%.")
            + h2("Backgrounds by screen type", 22)
            + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font:400 12px/16px Inter;color:var(--t2)">'
            + '<div><span style="display:block;height:64px;border-radius:8px;background:#0B0D10;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);margin-bottom:6px"></span>Browse roots: flat</div>'
            + '<div><span style="display:block;position:relative;overflow:hidden;height:64px;border-radius:8px;background:#0B0D10;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);margin-bottom:6px"><i style="position:absolute;left:-20px;top:-36px;width:150px;height:70px;border-radius:50%;background:#3a2b63;filter:blur(18px);opacity:.7"></i></span>Detail: cover tint, top</div>'
            + '<div><span style="display:block;position:relative;overflow:hidden;height:64px;border-radius:8px;background:#0B0D10;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);margin-bottom:6px"><i style="position:absolute;left:-10px;top:-10px;width:140px;height:100px;border-radius:50%;background:#1d4e6e;filter:blur(18px);opacity:.95"></i></span>Player: immersive</div></div>')
    col2 = (h2("Type roles (SF Pro in the app; Inter stands in here)")
            + '<div style="display:flex;flex-direction:column;gap:8px">'
            + '<div style="font:700 28px/34px Inter">Title 28 / 700</div>'
            + '<div style="font:700 24px/30px Inter">Detail title 24 / 700</div>'
            + '<div style="font:700 22px/28px Inter">Player title 22 / 700</div>'
            + '<div style="font:600 18px/24px Inter">Section, sheet title 18 / 600</div>'
            + '<div style="font:400 15px/20px Inter">Row title 15 / 400 · <b style="font-weight:600">playing 600</b></div>'
            + '<div style="font:600 15px/20px Inter">Button 15 / 600</div>'
            + '<div style="font:400 13px/18px Inter;color:var(--t2)">Meta 13 / 400</div>'
            + '<div style="font:600 13px/18px Inter;color:var(--t2)">Label 13 / 600 (list group labels)</div>'
            + '<div style="font:400 12px/16px Inter;color:var(--t2)">Navigation 12 / 400 · <b style="font-weight:600;color:var(--t1)">active 600</b></div></div>'
            + note("Only Regular, Semibold and Bold ship in the app (500 renders as Regular), so the round-4 weight 500 is gone. Sentence case, no tracking, nothing under 12. Text scales with the system font size; rows grow instead of clipping.")
            + h2("Spacing, shape, targets", 22)
            + '<div style="display:flex;align-items:flex-end;gap:12px;font:400 11px Inter;color:var(--t2)">'
            + "".join(f'<span style="display:flex;flex-direction:column;align-items:center;gap:4px"><span style="width:{s}px;height:{s}px;background:var(--t1);border-radius:2px"></span>{s}</span>' for s in (4, 8, 12, 16, 24, 32))
            + "</div>"
            + note("Gutter 16. Radius: thumbnails 8, small controls and chips 8, large artwork, buttons and fields 12, sheets 16. Circles only for people (artists) and the play button; the only pill shapes are switch and slider tracks. Every touch target 48 × 48, even when the visible control is smaller.")
            + h2("Icons", 22)
            + '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">'
            + "".join(ic(n) for n in ("radio", "favorite", "library_music", "search", "account_circle", "more_vert", "swap_vert", "shuffle", "repeat_one", "queue_music", "lyrics", "bedtime", "devices"))
            + "</div>" + '<div style="display:flex;gap:14px;align-items:center;margin-top:10px">' + "".join(ic(n, True) for n in ("radio", "favorite", "library_music", "search", "account_circle", "play_arrow", "pause", "skip_next")) + "</div>"
            + note("One family: Ionicons, 24, weight 400. Outlined at rest; filled only for selected, active or media transport. Ionicons and this outlined/filled mapping are already shipped."))
    col3 = (h2("Motion (existing tokens in src/ui)")
            + '<div style="display:flex;flex-direction:column;gap:6px;font:400 12px/17px Inter">'
            + "".join(f'<div style="display:flex;gap:8px"><b style="font-weight:600;width:132px;flex-shrink:0">{a}</b><span style="color:var(--t2)">{b}</span></div>' for a, b in [
                ("Press", "Tactile spring, sink + dim, held 70 ms"),
                ("Small state", "Motion.duration.fast 160, decelerate"),
                ("Sheet open / close", "Motion.spring.open (critically damped); a release keeps finger speed"),
                ("Player expand", "One sheet from the mini player; open spring 400, fling 1500"),
                ("List change", "Rows slide with transforms; 40 ms stagger, max 6"),
                ("Reduce Motion", "Every move becomes a fade; no feature removed"),
            ])
            + "</div>"
            + note("Transform and opacity only. No idle loops on browse screens; at most two self-running effects per screen (player glow + canvas).")
            + h2("Interaction rules", 22)
            + '<div style="display:flex;flex-direction:column;gap:6px;font:400 12px/17px Inter;color:var(--t2)">'
            + "".join(f"<p>{t}</p>" for t in [
                "<b style='color:var(--t1);font-weight:600'>Row tap plays.</b> ⋮ and long press open the same sheet; long press is a shortcut, never the only way.",
                "<b style='color:var(--t1);font-weight:600'>Playback shows the player’s truth.</b> A tap on Play shows pressed feedback, then a spinner until audio starts. The playing badge appears only when the player reports playing.",
                "<b style='color:var(--t1);font-weight:600'>Sheets:</b> one component; Back, a swipe down or the scrim closes and focus returns to the control that opened it.",
                "<b style='color:var(--t1);font-weight:600'>Undo before confirm:</b> reversible actions (remove from playlist) act at once with Undo; irreversible ones (delete song, delete playlist) ask first.",
                "<b style='color:var(--t1);font-weight:600'>Sort:</b> a labelled button opens a half-height sheet; the choice applies at once and is remembered per list.",
                "<b style='color:var(--t1);font-weight:600'>Back:</b> closes the top sheet, then the player, then pops the page, then leaves the tab for Stream.",
            ]) + "</div>")
    inner = (f'<div style="width:1320px;height:900px;padding:32px 36px;background:var(--base);display:grid;grid-template-columns:380px 430px 400px;column-gap:40px">'
             f'<section>{col1}</section><section>{col2}</section><section>{col3}</section></div>')
    return board("Design system", inner, 1320, 900, raw=True)


def comp_frame(title, content, w=None):
    st = f"width:{w}px;" if w else ""
    return f'<div style="{st}display:flex;flex-direction:column">{h2(title)}{content}</div>'


def components_board():
    rows = ul([
        song_row("static", meta="Orla North"),
        song_row("fade", pressed=True, meta="Pressed"),
        song_row("low", "playing"),
        song_row("low", "paused"),
        song_row("baarish"),
        song_row("memo", "noart", meta="Unknown artist · no cover, generated art"),
        song_row("golden", "unavailable"),
        song_row("drive", "downloading"),
        song_row("small", "selected", trailing="check", meta="Selected (adding songs)"),
        song_row("lanterns", "disabled", trailing="check"),
        song_row("small", num=3, meta="Mira Vale · album track"),
        song_row("static", trailing="drag", meta="Queue / edit order", last=True),
    ])
    rowbox = f'<div style="width:390px;border-radius:12px;background:var(--base);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);overflow:hidden">{rows}</div>'
    rowcol = comp_frame("Song row: one component, every list", rowbox + note(
        "64 tall, 48 artwork, ⋮ with its own 48 target, divider inset to the text. Default · pressed · playing (artwork kept, badge, 600 title, “Playing”) · paused · downloaded · no cover (the app’s generated cover, never a grey box) · can’t play · saving · selected · already in the playlist · album track number · drag handle. Long titles: one line, ellipsis; TalkBack reads the full title."), 390)
    buttons = ('<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">'
               + btn("Play", "p", "play_arrow", True) + btn("Shuffle", "s", "shuffle") + btn("Add songs", "t", "add")
               + btn("Delete song", "d") + btn("Create", "p", extra="dis") + ib("more_vert", "More") + "</div>"
               + note("Primary (white, one per screen) · secondary · text · destructive · disabled · icon. All 48 tall, radius 12."))
    controls = (library_tabs("songs").replace('padding:0 16px', 'padding:0')
                + '<div style="height:12px"></div>' + scopes("On this phone").replace("padding:0 16px", "padding:0")
                + '<div style="display:flex;gap:10px;margin-top:8px;align-items:center">' + sort_button("Recently added")
                + '<span class="sw on" role="switch" aria-checked="true" aria-label="On"><i></i></span><span class="sw" role="switch" aria-checked="false" aria-label="Off"><i></i></span></div>'
                + '<div style="margin-top:8px;display:flex;flex-direction:column;gap:8px"><label class="field">' + ic("search") + '<span class="v ph-t">Filter 248 songs</span></label>'
                + '<label class="field focus">' + ic("search") + '<span class="v">mira<span class="caret"></span></span>' + ib("close", "Clear", muted=True, size=20) + "</label></div>"
                + note("Tabs move between places (thin underline). Chips filter what is shown (white fill + tick when chosen). Sort is a labelled button with its current value. Switch and field: focus adds a white edge, not colour alone."))
    shells = ""
    for st, label in (("playing", "Playing"), ("paused", "Paused"), ("buffering", "Loading: spinner, progress line pulses"), ("error", "Couldn’t play: says so, offers Try again"),
                      ("remote", "Playing on another device (Connect): controls go there")):
        shells += (f'<p class="cap12" style="margin:8px 0 4px;color:var(--t2)">{label}</p><div style="position:relative;width:390px;border-radius:12px;overflow:hidden;background:var(--raised)">'
                   + mini_player(st) + "</div>")
    shells += ('<p class="cap12" style="margin:8px 0 4px;color:var(--t2)">Nothing played yet: navigation only</p><div style="width:390px;border-radius:12px;overflow:hidden;background:var(--raised)">'
               + nav_bar("library", top_border=False) + "</div>")
    shellcol = comp_frame("Playback + navigation shell", shells + note(
        "One opaque surface anchored to the bottom edge: 24 px seek + 56 px mini player + 64 px navigation + 16 px bottom inset = 160 px total, or 152 px compact. Progress is its top edge; a 6% divider separates playback from navigation. State comes from the player, not from the tap. The shell hides while the keyboard is up and under the full player."), 390)
    feedback = ('<div style="position:relative;height:56px">' + toast("Removed from Night drive", "Undo", bottom=0).replace("left:12px;right:12px", "left:0;right:0") + "</div>"
                + '<div style="margin-top:12px;padding:20px 0;border-radius:12px;background:var(--base);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)">'
                + empty_state("playlist_add", "No songs yet", "Add songs you saved or streamed.", '<div style="margin-top:12px">' + btn("Add songs", "p", "add") + "</div>") + "</div>"
                + '<div style="margin-top:12px;border-radius:12px;background:var(--base);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)">' + skeleton_rows(2) + "</div>"
                + note("Toast above the shell for results, with Undo when it can be undone. Empty states name the next step. Loading keeps the shape of what is coming."))
    sheetdemo = ('<div style="position:relative;height:300px;border-radius:12px;overflow:hidden;background:var(--base)">' + '<div class="scrim"></div>'
                 + sheet('<div class="sh"><h2>Sort songs by</h2>' + ib("close", "Close") + "</div>" + opt(None, "Recently added", check=True, on=True) + opt(None, "Title A–Z", check=True) + opt(None, "Artist", check=True), "Sheet") + "</div>"
                 + note("Sheet: grabber, 18/600 title, close, 52-tall options with 24 icons. Destructive options in red at the end of the list."))
    inner = (f'<div style="width:1320px;padding:32px 36px;background:#121418;display:grid;grid-template-columns:390px 390px 420px;column-gap:40px;row-gap:28px">'
             f'<div>{rowcol}</div><div>{shellcol}<div style="height:28px"></div>{comp_frame("Buttons", buttons)}</div>'
             f'<div>{comp_frame("Controls", controls)}<div style="height:28px"></div>{comp_frame("Feedback", feedback)}<div style="height:28px"></div>{comp_frame("Sheet", sheetdemo)}</div></div>')
    return board("Components", inner, 1320, 1250, raw=True)


# Second player pass (depth, frosted controls, Up next deck, lyrics-first view) replaces the first one above.
from v5_player import now_playing, now_playing_lyrics, now_playing_upnext, upnext_full, player_menu  # noqa: E402,F401,F811
