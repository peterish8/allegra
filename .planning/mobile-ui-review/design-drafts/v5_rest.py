"""Round 5: every other verified screen, sheet and state, built from the same kit as the core five."""
from v5_kit import *  # noqa: F401,F403
from v5_kit import esc
import v5_core as C
from v5_core import ul, song_row, library_header, library_tabs, artist_row


def top(title="", back="Back", actions="", close=False):
    return (f'<div class="top">{ib("close" if close else "arrow_back", back)}<span class="tt">{esc(title)}</span>{actions}</div>')


def h1(text, pad="4px 16px 0"):
    return f'<h1 style="font:700 28px/34px Inter;padding:{pad}">{esc(text)}</h1>'


def scrim():
    return '<div class="scrim"></div>'


def card(cover_html, title, meta):
    return f'<div class="card" role="button">{cover_html}<b>{esc(title)}</b><s>{esc(meta)}</s></div>'


def cvimg(cover):
    return f'<img class="cv" src="{cov(cover)}" alt="">'


def tile_cover(icon, color="var(--t2)"):
    return f'<span class="cv tile" style="border-radius:12px" aria-hidden="true">{ic(icon, size=44, color=color)}</span>'


def avatar(letter, color, size=48):
    return f'<span class="av" style="width:{size}px;height:{size}px;background:{color};font-size:{int(size * .4)}px" aria-hidden="true">{letter}</span>'


def gen_circle(letter, tones):
    return f'<span class="art gen c" aria-hidden="true" style="background:linear-gradient(135deg,{tones[0]},{tones[1]})">{letter}</span>'


def nm_row(lead, title, meta, trailing="", last=False):
    return (f'<li class="row{" last" if last else ""}{"" if trailing else " nm"}">{lead}<button class="rt" style="border:0;background:none;padding:0;text-align:left;color:inherit">'
            f'<b>{esc(title)}</b><s><em>{esc(meta)}</em></s></button>{trailing}</li>')


# ================================================================= LIBRARY TABS
def lib_playlists(empty=False, sheet_html=""):
    if empty:
        body = (library_header() + library_tabs("playlists") + '<div style="flex:1;display:flex;align-items:center;padding-bottom:150px">'
                + empty_state("queue_music", "No playlists yet", "Group songs you saved or streamed. They sync with Allegra on the web.",
                              '<div style="margin-top:16px">' + btn("New playlist", "p", "add") + "</div>") + "</div>")
        return phone(body, shell("library"), sheet_html)
    grid = ('<div class="grid2">'
            + card(tile_cover("add", "var(--t1)"), "New playlist", "Create")
            + card(tile_cover("favorite", "var(--t1)"), "Liked songs", "Playlist · 42 songs")
            + card(cvimg("night-drive"), "Night drive", "Playlist · 24 songs")
            + card(cvimg("daily-mix"), "Monsoon mornings", "Playlist · 18 songs")
            + card(mosaic(["small-hours", "paper-lanterns", "static-rain", "fade"]).replace('class="mos"', 'class="mos cv"'), "Focus", "Playlist · 11 songs · from Allegra web")
            + card(tile_cover("queue_music"), "Road trip", "Playlist · No songs yet") + "</div>")
    body = library_header() + library_tabs("playlists") + '<p class="meta" style="padding:12px 16px 0">6 playlists · long press a playlist for Rename and Delete</p>' + grid
    return phone(body, shell("library"), sheet_html)


ARTISTS = [("Mira Vale", "12 songs", "mira-vale", None), ("Harbor Kids", "8 songs", None, ("#1d4e6e", "#4f8db8")),
           ("Kabir & The Monsoons", "7 songs", None, ("#1f4a3a", "#2f5a6a")), ("Neon Choir", "5 songs", None, ("#4a1f5c", "#7a2f5c")),
           ("Orla North", "4 songs", None, ("#2a3440", "#4a5664")), ("Sunny Arcade", "3 songs", None, ("#7a4a12", "#9a3a22")),
           ("The Overpass", "2 songs", None, ("#3a2b63", "#5a2430"))]


def lib_artists():
    rows = []
    for i, (n, m, c, t) in enumerate(ARTISTS):
        lead = art(c, circle=True) if c else gen_circle(n[0] if not n.startswith("The ") else n[4], t)
        rows.append(nm_row(lead, n, m, ic("chevron_right", color="var(--t3)") , last=(i == len(ARTISTS) - 1)))
    body = (library_header() + library_tabs("artists") + '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 4px 0 16px">'
            + C.sort_button("Most songs") + '<p class="meta">7 artists</p></div>' + ul(rows))
    return phone(body, shell("library"))


def lib_albums():
    grid = ('<div class="grid2">' + card(cvimg("small-hours"), "Small Hours", "Album · Mira Vale") + card(cvimg("baarish"), "Monsoon Sessions", "Album · Kabir & The Monsoons")
            + card(cvimg("static-rain"), "Static", "Album · Orla North") + card(cvimg("golden-hour"), "Arcade Summer", "Album · Sunny Arcade")
            + card(cvimg("fade"), "Choir", "Album · Neon Choir") + card(cvimg("night-drive"), "Overpass", "Album · The Overpass") + "</div>")
    body = library_header() + library_tabs("albums") + '<p class="meta" style="padding:12px 16px 0">Grouped from the album name of songs on this phone</p>' + grid
    return phone(body, shell("library"))


def lib_menu():
    inner = ('<div class="sh"><h2>Library</h2>' + ib("close", "Close") + "</div>" + opt("move_to_inbox", "Import from Spotify", "Bring your liked songs and playlists")
             + opt("join", "Blends", "Mix your taste with a friend") + opt("smartphone", "Add songs from this phone", "Find music files already on your device")
             + opt("visibility_off", "Hidden songs"))
    return C.library_songs(sheet_html=scrim() + sheet(inner, "Library options"))


def download_queue():
    def dl(key, meta, tr, last=False, ring=False):
        t, a, _, cvr, _ = SONGS[key]
        r = '<span class="ring" aria-hidden="true"></span>' if ring else ""
        return (f'<li class="row{" last" if last else ""}">{art(cvr)}<span class="rt"><b>{esc(t)}</b><s>{r}<em>{esc(meta)}</em></s></span>{tr}</li>')
    rows = ul([
        dl("baarish", "Saving · 40%", ib("pause", "Pause download", muted=True), ring=True),
        dl("drive", "Waiting for a slot", ib("close", "Cancel download", muted=True, size=20)),
        dl("glass", "Getting ready", ib("close", "Cancel download", muted=True, size=20)),
        dl("under", "Couldn’t download. Check your connection", ib("refresh", "Retry download")),
        dl("small", "Saved to your library", f'<span class="ib" aria-hidden="true">{ic("check", color="var(--t2)")}</span>', last=True),
    ])
    inner = '<div class="sh"><h2>Downloads</h2><button class="btn t sm">Clear finished</button>' + ib("close", "Close") + "</div>" + rows
    return C.library_songs(sheet_html=scrim() + sheet(inner, "Downloads"))


# ================================================================= PLAYLIST FLOWS
def name_sheet(title, value, action, error=None, empty=False):
    v = ('<span class="v ph-t">Playlist name</span>' if empty else f'<span class="v">{esc(value)}<span class="caret"></span></span>' + ib("close", "Clear name", muted=True, size=20))
    err = (f'<p style="display:flex;gap:6px;align-items:center;padding:8px 16px 0;font:400 13px/18px Inter;color:var(--danger)">{ic("error", size=16)}{esc(error)}</p>' if error
           else '<p class="cap12" style="padding:8px 16px 0">You can add songs next.</p>')
    inner = (f'<div class="sh"><h2>{esc(title)}</h2></div><div style="padding:0 16px"><label class="field focus">{v}</label></div>{err}'
             f'<div class="btns" style="margin-top:16px">{btn("Cancel", "s")}{btn(action, "p", extra="dis" if empty else "")}</div>')
    return sheet(inner, title, extra_style="bottom:300px;padding-bottom:16px;border-radius:16px 16px 0 0")


def create_playlist(error=None, empty=False):
    return lib_playlists(sheet_html=scrim() + name_sheet("New playlist", "Late night drive", "Create", error, empty) + keyboard(("Late", "night", "drive")))


def rename_playlist():
    return C.playlist_detail(sheet_html=scrim() + name_sheet("Rename playlist", "Night drive", "Save") + keyboard(("drive", "drives", "driver")))


def confirm(title, body, action, under):
    inner = (f'<div style="padding:8px 16px 0"><p class="lead">{esc(title)}</p><p class="body" style="margin-top:8px">{esc(body)}</p></div>'
             f'<div class="btns" style="margin-top:24px;flex-direction:column"><button class="btn d blk">{esc(action)}</button><button class="btn s blk">Cancel</button></div>')
    return under(scrim() + sheet(inner, title))


def playlist_longpress():
    inner = ('<div class="sh">' + art("night-drive") + '<span class="id"><b>Night drive</b><span class="meta">Playlist · 24 songs</span></span>' + ib("close", "Close") + "</div>"
             + opt("play_arrow", "Play") + opt("shuffle", "Shuffle") + opt("queue_play_next", "Play next") + '<div class="hr"></div>'
             + opt("edit", "Rename playlist") + opt("delete", "Delete playlist…", danger=True))
    return lib_playlists(sheet_html=scrim() + sheet(inner, "Night drive"))


def new_playlist_created():
    body = (C.playlist_top("Late night drive") + C.playlist_header("Late night drive", empty=True) + '<div style="flex:1;display:flex;align-items:center;padding-bottom:150px">'
            + empty_state("playlist_add", "No songs yet", "Add songs you saved or streamed.", '<div style="margin-top:16px">' + btn("Add songs", "p", "add") + "</div>") + "</div>")
    return phone(body, shell("library"), toast("Playlist created"))


# ================================================================= ADD TO PLAYLIST
def pl_row(cover_html, name, meta, member=False, last=False):
    tr = (f'<span class="ib" role="img" aria-label="Already in this playlist">{ic("check_circle", True)}</span>' if member else "")
    return (f'<button class="row{" last" if last else ""}{"" if member else " nm"}" style="width:100%;border:0;background:none;color:inherit;text-align:left">{cover_html}'
            f'<span class="rt"><b>{esc(name)}</b><s><em>{esc(meta)}</em></s></span>{tr}</button>')


def thumb_tile(icon):
    return f'<span class="art tile" aria-hidden="true">{ic(icon, size=22)}</span>'


def add_to_playlist_sheet(stream=False):
    key = "glass" if stream else "small"
    h = C.song_sheet_header(key, "Add to playlist")
    top_opts = ""
    if stream:
        top_opts = opt("download", "Save to library only", "Downloads it without a playlist") + '<div class="hr"></div>'
    rows = (pl_row(thumb_tile("add"), "New playlist", "Name it and add this song")
            + pl_row(thumb_tile("favorite"), "Liked songs", "42 songs", member=not stream)
            + pl_row(art("night-drive"), "Night drive", "24 songs", member=not stream)
            + pl_row(art("daily-mix"), "Monsoon mornings", "18 songs")
            + pl_row(mosaic(["small-hours", "paper-lanterns", "static-rain", "fade"], 48, 8), "Focus", "11 songs")
            + pl_row(thumb_tile("queue_music"), "Road trip", "No songs yet", last=True))
    field = '<div style="padding:4px 16px 8px"><label class="field">' + ic("search") + '<span class="v ph-t">Search playlists</span></label></div>'
    inner = h + top_opts + field + rows
    under = C.search_screen("results") if stream else C.library_songs()
    return _ov(under, scrim() + sheet(inner, "Add to playlist", top=120 if not stream else 64))


def _ov(phone_html, overlay):
    i = phone_html.rfind('<div class="sb"')
    return phone_html[:i] + overlay + phone_html[i:]


def add_songs_screen():
    rows = [song_row("low", "disabled", trailing="check"), song_row("lanterns", "selected", trailing="check"),
            song_row("golden", "selected", trailing="check"), song_row("fade", "unselected", trailing="check"),
            song_row("mix", "unselected", trailing="check"), song_row("static", "disabled", trailing="check"), song_row("drive", "unselected", trailing="check", last=True)]
    body = (top("Add to Night drive", "Close without adding", close=True)
            + '<div style="padding:0 16px"><label class="field">' + ic("search") + '<span class="v ph-t">Search your songs</span></label></div>'
            + '<p class="meta" style="padding:12px 16px 4px">2 selected · songs already in Night drive are dimmed</p>' + ul(rows))
    bar = ('<div style="position:absolute;left:0;right:0;bottom:0;z-index:20;background:var(--raised);padding:12px 16px 28px;border-top:1px solid var(--div)">'
           + btn("Add 2 songs", "p", block=True) + "</div>")
    return phone(body, bar)


def added_toast():
    return C.playlist_detail(toast_html=toast("Added 2 songs to Night drive"))


# ================================================================= STREAM
MOODS = ["Chill", "Energy", "Romance", "Focus", "Workout", "Sad"]


def stream_header():
    return (f'<header class="page"><h1>Stream</h1>{ib("download", "Downloads")}{ib("info", "About LuvLyrics", badge="1")}</header>')


def mood_chips(active=None):
    return ('<div class="chips" role="radiogroup" aria-label="Moods">' + "".join(
        f'<button class="chip{" on" if m == active else ""}" role="radio" aria-checked="{str(m == active).lower()}"><span>{ic("check") if m == active else ""}{m}</span></button>' for m in MOODS) + "</div>")


def shelf(items):
    return '<div class="shelf">' + "".join(card(cvimg(c), t, m) for c, t, m in items) + "</div>"


def stream_home(state="default"):
    if state == "loading":
        sk = '<div class="shelf">' + "".join('<div style="width:136px;flex-shrink:0"><span class="sk" style="display:block;width:136px;height:136px;border-radius:12px"></span><span class="sk" style="display:block;width:100px;height:12px;margin-top:10px"></span></div>' for _ in range(3)) + "</div>"
        body = stream_header() + mood_chips() + '<div class="sec"><span class="sk" style="width:140px;height:16px"></span></div>' + sk + '<div class="sec"><span class="sk" style="width:110px;height:16px"></span></div>' + skeleton_rows(3)
        return phone(body, shell("stream"))
    banner = ""
    if state == "error":
        banner = (f'<div style="display:flex;gap:12px;align-items:center;margin:4px 16px 4px;padding:8px 4px 8px 16px;border-radius:12px;background:var(--raised)">'
                  f'{ic("cloud_off", color="var(--t2)")}<p style="flex:1;font:400 13px/18px Inter">Can’t reach the catalog. Showing your last page.</p>{btn("Try again", "t", extra="sm")}</div>')
    mood = "Chill" if state == "mood" else None
    first = ("Your chill mix", "Mira Vale, Orla North and more") if mood else ("Jump back in", None)
    sec1 = (f'<div class="sec"><h2>{first[0]}</h2>' + (f'<button class="btn t sm">Play</button>' if mood else "") + "</div>")
    shelf1 = shelf([("small-hours", "Small Hours", "Mira Vale"), ("low-tide", "Low Tide", "Harbor Kids"), ("night-drive", "Night drive", "Playlist")]) if not mood else \
        shelf([("static-rain", "Static in the Rain", "Orla North"), ("paper-lanterns", "Paper Lanterns", "Mira Vale"), ("fade", "Fade", "Neon Choir")])
    picks = ul([song_row("glass", meta="Mira Vale"), song_row("under", meta="Mira Vale"), song_row("mix", meta="Kabir & The Monsoons", last=True)])
    body = (stream_header() + banner + mood_chips(mood) + sec1 + shelf1
            + '<div class="sec"><h2>Quick picks</h2><button class="btn t sm">Play all</button></div>' + picks
            + '<div class="sec"><h2>Daily discover</h2></div>' + shelf([("daily-mix", "Daily discover 1", "Updated today"), ("golden-hour", "Daily discover 2", "Updated today"), ("baarish", "Monsoon radio", "Radio")]))
    return phone(body, shell("stream"))


def add_list_sheet():
    def r(title, artist, status, icon, cover=None, last=False):
        lead = art(cover) if cover else f'<span class="art tile" aria-hidden="true">{ic("help", color="var(--t2)")}</span>'
        return (f'<li class="row nm{" last" if last else ""}">{lead}<span class="rt"><b>{esc(title)}</b><s>{ic(icon)}<em>{esc(artist)} · {esc(status)}</em></s></span></li>')
    rows = ul([r("Glasshouse", "Mira Vale", "Found", "check_circle", "golden-hour"), r("Undertow", "Mira Vale", "Found", "check_circle", "static-rain"),
               r("Small Hours", "Mira Vale", "Already on this phone", "smartphone", "small-hours"), r("hum of the city", "unknown", "Not found", "error", last=True)])
    inner = ('<div class="sh"><h2>Add a list</h2><button class="btn t sm">Edit list</button>' + ib("close", "Close") + "</div>"
             + '<p class="meta" style="padding:0 16px 8px">4 lines pasted · 2 found to save</p>' + rows
             + '<div style="padding:8px 4px 0 16px;display:flex;align-items:center;justify-content:space-between"><span class="meta">Add them to</span>' + C.sort_button("No playlist", "Playlist") + "</div>"
             + '<div class="btns" style="margin-top:12px">' + btn("Save 2 songs", "p", "download") + "</div>")
    return _ov(stream_home(), scrim() + sheet(inner, "Add a list"))


# ================================================================= LUVS
def luvs(sheet_html=""):
    lanes = ('<div class="tabs" role="tablist" aria-label="Lanes">' + "".join(
        f'<button class="tab{" on" if i == 0 else ""}" role="tab" aria-selected="{str(i == 0).lower()}">{t}</button>' for i, t in enumerate(["For you", "Mira Vale", "Chill", "Energy", "Neon Choir"])) + "</div>")
    stack = (f'<div style="position:relative;height:372px;margin-top:12px">'
             f'<img src="{cov("paper-lanterns")}" alt="" aria-hidden="true" style="position:absolute;left:36px;top:0;width:318px;height:318px;border-radius:16px;object-fit:cover;opacity:.5">'
             f'<img src="{cov("small-hours")}" alt="Small Hours by Mira Vale" style="position:absolute;left:24px;top:22px;width:342px;height:342px;border-radius:16px;object-fit:cover;box-shadow:0 20px 40px rgba(0,0,0,.5)">'
             f'<span class="meta" style="position:absolute;right:36px;top:34px;padding:2px 8px;border-radius:6px;background:rgba(11,13,16,.6)">3 of 40</span></div>')
    info = (f'<div style="display:flex;align-items:center;padding:12px 12px 0 24px"><div style="flex:1"><p style="font:700 20px/26px Inter">Small Hours</p><p class="meta" style="font-size:15px">Mira Vale</p></div></div>'
            f'<div style="padding:10px 24px 0"><span style="display:block;height:3px;border-radius:2px;background:rgba(255,255,255,.18)"><span style="display:block;width:46%;height:3px;border-radius:2px;background:var(--t1)"></span></span></div>')
    acts = [("favorite", "Luv", True), ("download", "Save", False), ("playlist_add", "Playlist", False), ("play_circle", "Full song", False), ("share", "Share", False)]
    row = '<div style="display:grid;grid-template-columns:repeat(5,1fr);padding:12px 8px 0">' + "".join(
        f'<button aria-label="{l}" aria-pressed="{str(f).lower()}" style="height:64px;border:0;background:none;color:var(--t1);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font:400 12px Inter">{ic(i, f)}{l}</button>' for i, l, f in acts) + "</div>"
    body = (f'<header class="page"><h1>Luvs</h1>{ib("translate", "Languages for Luvs")}{ib("bookmarks", "Saved from Luvs")}</header>' + lanes + stack + info + row)
    bg = f'<div aria-hidden="true" style="position:absolute;inset:0;background:url({cov("small-hours")}) center/cover;filter:blur(60px);opacity:.35;transform:scale(1.2)"></div>'
    return phone(body, shell("luvs", None), sheet_html, bg=bg)


def luvs_languages():
    langs = ["Hindi", "English", "Tamil", "Telugu", "Punjabi", "Malayalam", "Kannada", "Bengali", "Marathi", "Korean"]
    on = {"Hindi", "English", "Tamil"}
    chips = '<div style="display:flex;flex-wrap:wrap;gap:0 8px;padding:0 16px">' + "".join(
        f'<button class="chip{" on" if l in on else ""}" role="checkbox" aria-checked="{str(l in on).lower()}"><span>{ic("check") if l in on else ""}{l}</span></button>' for l in langs) + "</div>"
    inner = ('<div class="sh"><h2>Languages for Luvs</h2></div><p class="body" style="padding:0 16px 8px">Luvs mixes songs in the ones you pick.</p>' + chips
             + '<div class="btns" style="margin-top:16px">' + btn("Cancel", "s") + btn("Save", "p") + "</div>")
    return luvs(scrim() + sheet(inner, "Languages for Luvs"))


def luvs_saved():
    rows = ul([song_row("small", meta="Mira Vale · saved"), song_row("lanterns", "downloading"), song_row("static", meta="Orla North", last=True)])
    inner = ('<div class="sh"><h2>Saved from Luvs</h2>' + ib("close", "Close") + "</div>" + rows
             + '<div class="btns" style="margin-top:12px">' + btn("Clear them", "s") + btn("Download all", "p", "download") + "</div>")
    return luvs(scrim() + sheet(inner, "Saved from Luvs"))


# ================================================================= BROWSE: ARTIST, COLLECTION
def artist_page(scrolled=False, error=False):
    if error:
        body = top("", "Back") + '<div style="flex:1;display:flex;align-items:center;padding-bottom:160px">' + empty_state(
            "cloud_off", "This artist couldn’t be loaded", "Check your connection, then try again.",
            '<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;width:100%">' + btn("Try again", "p", "refresh") + btn("Go back", "t") + "</div>") + "</div>"
        return phone(body, shell("library"))
    hero = (f'<div style="position:relative;height:300px;margin-top:-28px;flex-shrink:0"><img src="{cov("mira-vale")}" alt="Mira Vale" style="width:100%;height:300px;object-fit:cover;display:block">'
            f'<span aria-hidden="true" style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,13,16,.35) 0%,rgba(11,13,16,0) 30%,rgba(11,13,16,0) 55%,#0B0D10 100%)"></span>'
            f'<div style="position:absolute;top:28px;left:0;right:0">{top("", "Back", ib("more_vert", "More actions for Mira Vale"))}</div>'
            f'<div style="position:absolute;left:16px;right:16px;bottom:8px"><h1 style="font:700 34px/40px Inter">Mira Vale</h1><p class="meta" style="font-size:14px;color:#C9CBD1">1.2M subscribers · 12 songs on this phone</p></div></div>')
    actions = '<div class="btns" style="margin-top:12px">' + btn("Play", "p", "play_arrow", True) + btn("Shuffle", "s", "shuffle") + "</div>" + '<div style="display:flex;padding:4px 4px 0 4px">' + btn("Radio", "t", "radio") + btn("Follow", "t", "person_add") + "</div>"
    if not scrolled:
        body = (hero + actions + '<div class="sec" style="margin-top:0"><h2>On this phone</h2><button class="btn t sm">See all 12</button></div>'
                + ul([song_row("small"), song_row("lanterns", last=True)]) + '<div class="sec"><h2>Top songs</h2></div>' + ul([song_row("glass", meta="Mira Vale · 4.1M plays"), song_row("under", meta="Mira Vale · 2.7M plays", last=True)]))
        return phone(body, shell("library"))
    fans = '<div class="shelf">' + "".join(
        f'<div style="width:96px;flex-shrink:0;text-align:center"><span class="gen" aria-hidden="true" style="width:96px;height:96px;border-radius:50%;font-size:36px;'
        f'background:linear-gradient(135deg,{t[0]},{t[1]})">{n[0]}</span><p style="font:400 13px/18px Inter;margin-top:8px">{n}</p></div>'
        for n, t in [("Orla North", ("#2a3440", "#4a5664")), ("Neon Choir", ("#4a1f5c", "#7a2f5c")), ("Harbor Kids", ("#1d4e6e", "#4f8db8"))]) + "</div>"
    body = (top("Mira Vale", "Back", ib("more_vert", "More actions for Mira Vale"))
            + '<div class="sec" style="margin-top:0"><h2>Albums</h2><button class="btn t sm">See all</button></div>'
            + shelf([("small-hours", "Small Hours", "Album · 2024"), ("paper-lanterns", "Paper Lanterns", "Album · 2022"), ("golden-hour", "Glasshouse", "Single · 2021")])
            + '<div class="sec"><h2>Fans also like</h2></div>' + fans
            + '<div class="sec"><h2>About</h2></div><p class="body" style="padding:0 16px">Mira Vale writes quiet songs about the hours after midnight, recorded in a converted boathouse with a single microphone and whatever was in the room.</p>'
            + '<div style="padding:0 4px">' + btn("More", "t") + "</div>")
    return phone(body, shell("library"))


def collection_page():
    rows = ul([song_row("small", num=1, meta="Mira Vale · 2:58"), song_row("lanterns", num=2, meta="Mira Vale · 3:33"), song_row("glass", num=3, meta="Mira Vale · 3:47"),
               song_row("under", num=4, meta="Mira Vale · 4:02"), song_row("static", num=5, meta="Mira Vale, Orla North · 4:05", last=True)])
    body = (top("", "Back", ib("more_vert", "More actions for Small Hours")) + C.playlist_header("Small Hours", cover="small-hours").replace(
        "Playlist · No songs yet", "").replace("Playlist · 24 songs · 1 h 32 min", "Album · Mira Vale · 2024</p><p class=\"meta\">8 songs · 31 min")
        + '<div class="btns" style="margin-top:16px">' + btn("Play", "p", "play_arrow", True) + btn("Shuffle", "s", "shuffle") + "</div><div style=\"height:12px\"></div>" + rows)
    return phone(body, shell("library"))


# ================================================================= PLAYER SHEETS
def np_with(sheet_inner, label, top_px=None):
    from v5_player import player_sheet
    return C.now_playing(sheet_html=scrim() + player_sheet(sheet_inner, label, top=top_px))


def sleep_timer(active=False):
    if active:
        inner = ('<div class="sh"><h2>Sleep timer</h2>' + ib("close", "Close") + "</div>"
                 + '<p class="code" style="padding:8px 16px 4px;letter-spacing:0">12:04</p><p class="meta" style="padding:0 16px 16px">Music pauses when the timer ends.</p>'
                 + opt("add", "Add 15 minutes") + opt("timer_off", "Turn off timer"))
    else:
        inner = ('<div class="sh"><h2>Sleep timer</h2>' + ib("close", "Close") + "</div>" + opt("timer", "15 minutes") + opt("timer", "30 minutes") + opt("timer", "45 minutes")
                 + opt("timer", "60 minutes") + opt("music_note", "End of this song"))
    return np_with(inner, "Sleep timer")


def connect_devices(signed_in=True):
    if signed_in:
        inner = ('<div class="sh"><h2>Connect devices</h2>' + ib("close", "Close") + "</div>"
                 + opt("smartphone", "This phone", "Playing here", on=True, trailing=ic("check", cls="ck"))
                 + opt("computer", "Living room PC", "Ready")
                 + opt("language", "Allegra on the web", "Offline · last played yesterday").replace('class="opt"', 'class="opt" style="opacity:.5"')
                 + '<div class="hr"></div>' + opt("cast", "Cast to a speaker or TV") + opt("edit", "Rename this phone"))
    else:
        inner = ('<div class="sh"><h2>Connect devices</h2>' + ib("close", "Close") + "</div>"
                 + '<p class="body" style="padding:0 16px 16px">Sign in with Google to play on your other devices. Everything else works without an account.</p>'
                 + '<div class="btns">' + btn("Sign in with Google", "p") + "</div>" + '<div class="hr" style="margin-top:16px"></div>' + opt("cast", "Cast to a speaker or TV"))
    return np_with(inner, "Connect devices")


def lyrics_sources():
    def src(name, kind, line, inuse=False):
        return (f'<button class="opt{" on" if inuse else ""}" role="menuitemradio" aria-checked="{str(inuse).lower()}" style="min-height:72px">'
                f'{ic("lyrics")}<span class="ot">{esc(name)}<small>{esc(kind)}</small><small style="color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">“{esc(line)}”</small></span>'
                f'{ic("check", cls="ck") if inuse else ""}</button>')
    inner = ('<div class="sh"><h2>Lyrics sources</h2>' + ib("close", "Close") + "</div>" + '<p class="meta" style="padding:0 16px 4px">Asked every source at once; best matches first.</p>'
             + src("BetterLyrics", "Word by word · 96% match · In use", "and the harbour lights go out", True) + src("LRCLIB", "Synced lines · 91% match", "and the harbour lights go out")
             + src("Paxsenix", "Synced lines · 88% match", "And the harbor lights go out") + src("Lyrica", "Plain text · 72% match", "and the harbour lights")
             + '<p class="meta" style="padding:8px 16px 0;display:flex;gap:8px;align-items:center"><span class="ring" aria-hidden="true"></span>Still asking 3 sources</p>')
    return np_with(inner, "Lyrics sources", 120)


def details_sheet():
    def kv(k, v):
        return f'<div style="display:flex;justify-content:space-between;gap:16px;padding:10px 16px;font:400 15px/20px Inter"><span style="color:var(--t2)">{k}</span><span style="text-align:right">{v}</span></div>'
    inner = ('<div class="sh"><h2>Details</h2>' + ib("close", "Close") + "</div>" + kv("Title", "Low Tide") + kv("Artist", "Harbor Kids") + kv("Album", "Harbour Lights") + kv("Length", "3:41")
             + kv("Plays from", "This phone") + kv("Lyrics", "Synced") + '<div class="hr"></div>' + opt("edit_note", "Edit lyrics") + opt("image", "Change cover"))
    return np_with(inner, "Details")


def tempo_sheet():
    def sl(label, val, pct):
        return (f'<div style="padding:8px 16px"><div style="display:flex;justify-content:space-between;font:400 15px/20px Inter"><span>{label}</span><span style="font-variant-numeric:tabular-nums">{val}</span></div>'
                f'<div role="slider" aria-label="{label}" aria-valuetext="{val}" style="position:relative;height:48px;display:flex;align-items:center"><span style="position:absolute;left:0;right:0;height:4px;border-radius:2px;background:rgba(255,255,255,.18)"></span>'
                f'<span style="position:absolute;left:0;width:{pct}%;height:4px;border-radius:2px;background:var(--t1)"></span><span style="position:absolute;left:calc({pct}% - 10px);width:20px;height:20px;border-radius:10px;background:var(--t1)"></span></div></div>')
    inner = ('<div class="sh"><h2>Tempo and pitch</h2><button class="btn t sm">Reset</button>' + ib("close", "Close") + "</div>" + sl("Tempo", "1.10×", 55) + sl("Pitch", "1.00×", 50)
             + '<p class="cap12" style="padding:4px 16px 0">Applies to this song until you reset it.</p>')
    return np_with(inner, "Tempo and pitch")


def ambient():
    body = (f'<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding-bottom:40px">'
            f'<img src="{cov("low-tide")}" alt="Cover of Low Tide" style="width:300px;height:300px;border-radius:12px;object-fit:cover">'
            f'<div style="text-align:center"><p style="font:700 22px/28px Inter">Low Tide</p><p class="meta" style="font-size:15px">Harbor Kids</p></div>'
            f'<p class="cap12">Tap anywhere or press Back to return</p></div>')
    return phone(body, "", "", bg=glow("low-tide", np=True, opacity=.5))


def remote_player():
    return C.now_playing(remote=True, art_size=296)


# ================================================================= YOU, SETTINGS
def you_hub():
    acct = (f'<div style="display:flex;align-items:center;gap:12px;margin:4px 16px 8px;padding:12px;border-radius:12px;background:var(--raised)">'
            f'{avatar("A", "#5b4a7c", 48)}<div style="flex:1"><p style="font:600 15px/20px Inter">Asha</p><p class="meta">Signed in to Allegra · library synced</p></div>{ic("chevron_right", color="var(--t3)")}</div>')
    g1 = li("graphic_eq", "Your DJ", "Ask for a mood, a song, or a set") + li("join", "Blends", "2 Blends · 1 waiting for a friend") + li("group", "LuvLink", "Listen with friends in sync")
    g2 = li("download", "Downloads", "2 in progress") + li("move_to_inbox", "Import from Spotify") + li("devices", "Connect devices", "Living room PC is ready")
    g3 = li("settings", "Settings", "Playback, lyrics, look") + li("info", "About LuvLyrics", "Update available · 1.36.0")
    body = (f'<header class="page"><h1>You</h1></header>' + acct + '<p class="gt">Listening</p>' + g1 + '<p class="gt">Library</p>' + g2 + '<p class="gt">App</p>' + g3)
    return phone(body, shell("you"))


def today_more():
    """Today's ••• menu, for reference."""
    tiles = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 16px">' + "".join(
        f'<span style="height:80px;border-radius:12px;background:var(--control);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font:400 13px Inter">{ic(i)}{t}</span>'
        for i, t in [("graphic_eq", "Your DJ"), ("search", "Search"), ("queue_music", "Playlists")]) + "</div>"
    inner = '<div class="sh"><h2>More</h2></div>' + tiles + '<div style="height:8px"></div>' + li("settings", "Settings", "Playback, lyrics, look")
    under = C.library_songs()
    return _ov(under, scrim() + sheet(inner, "More"))


def settings_top(scroll=0):
    chips = ('<div class="chips" style="margin-top:4px">' + "".join(
        f'<button class="chip"><span>{t}</span></button>' for t in ["Player", "Playback", "Lyrics", "Navigation and voice", "Discover"]) + "</div>")
    if scroll == 0:
        groups = ('<p class="gt">Player</p>' + li(None, "Player background", value="Apple + glow") + li(None, "Apple Music inspired", "Full-width cover that melts into its blur", switch=True)
                  + li(None, "Canvas", "Motion artwork when a song has it", switch=True) + li(None, "Hide volume slider", switch=False) + li(None, "Keep screen on", "While Now Playing is open", switch=False)
                  + '<p class="gt">Playback</p>' + li(None, "Keep playing similar songs", "When the queue is about to end, songs like the one playing are added.", switch=True)
                  + li(None, "Stay on the list when a song starts", "Off opens Now Playing every time you pick a song.", switch=True))
    else:
        groups = ('<p class="gt">Library and data</p>' + li(None, "Library sync", "Signed in · synced 2 minutes ago")
                  + li(None, "Add songs from this phone", "Find music files already on your device.") + li(None, "Export library", "Songs, lyrics and playlists as one file.")
                  + li(None, "Import a backup") + li(None, "Hidden songs", value="3") + li(None, "Reset settings", "Put everything on this page back to how it started. Your songs stay.", chevron=False)
                  + li(None, "Delete all library data", "Every song and playlist on this phone. This cannot be undone.", chevron=False, danger=True))
    body = top("", "Back") + h1("Settings", "0 16px 4px") + (chips if scroll == 0 else "") + groups
    return phone(body, shell("you"))


def choice_sheet():
    inner = ('<div class="sh"><h2>Player background</h2>' + ib("close", "Close") + "</div>"
             + opt(None, "Apple + glow", "Apple Music for the cover, glow once lyrics open", on=True, check=True)
             + opt(None, "Apple Music", "The cover blurred soft behind a sharp hero", check=True)
             + opt(None, "Cover glow", "Black middle, the cover’s colours from the edges", check=True)
             + opt(None, "YouTube", "The cover’s colour washing into black", check=True))
    return _ov(settings_top(), scrim() + sheet(inner, "Player background"))


def hidden_songs(empty=False):
    if empty:
        body = top("Hidden songs", "Back") + '<div style="flex:1;display:flex;align-items:center;padding-bottom:160px">' + empty_state("visibility", "No hidden songs", "Songs you hide from your library are listed here.") + "</div>"
        return phone(body, shell("you"))
    rows = ul([song_row("memo", "selected", trailing="check", meta="Unknown artist"), song_row("fade", "selected", trailing="check"), song_row("mix", "unselected", trailing="check", last=True)])
    body = top("Hidden songs", "Back", '<button class="btn t">Select all</button>') + '<p class="meta" style="padding:0 16px 8px">Hidden songs stay on this phone but don’t show in your library.</p>' + rows
    bar = ('<div style="position:absolute;left:0;right:0;bottom:0;z-index:20;background:var(--raised);padding:12px 16px 28px;border-top:1px solid var(--div)">' + btn("Show 2 songs again", "p", block=True) + "</div>")
    return phone(body, bar)


def sync_choice():
    inner = ('<div class="sh"><h2>Choose how to sync your library</h2></div>'
             + '<p class="body" style="padding:0 16px 8px">This phone has 248 songs and 6 playlists. Your Allegra account has 1,204 likes and 14 playlists. Downloads stay on this phone either way.</p>'
             + opt("merge", "Merge both", "Likes and playlists from both sides, kept the same here and on the website", on=True, check=True)
             + opt("cloud_download", "Use your account’s library", "This phone’s likes and playlists are replaced by your account’s.", check=True)
             + '<div class="btns" style="margin-top:16px">' + btn("Cancel", "s") + btn("Start syncing", "p") + "</div>")
    return _ov(settings_top(1), scrim() + sheet(inner, "Choose how to sync"))


# ================================================================= SOCIAL: BLENDS, LUVLINK
def pair(a, b, c1, c2):
    return f'<span style="position:relative;width:56px;height:48px;flex-shrink:0" aria-hidden="true"><span style="position:absolute;left:0;top:4px">{avatar(a, c1, 40)}</span><span style="position:absolute;left:18px;top:4px">{avatar(b, c2, 40)}</span></span>'


def blends(signed_in=True):
    if not signed_in:
        body = top("Blends", "Back", ib("help", "What is a Blend?")) + '<div style="flex:1;display:flex;align-items:center;padding-bottom:160px">' + empty_state(
            "join", "Blend your taste with a friend", "A Blend is a shared playlist made from what you both play. Sign in with Google to make one.",
            '<div style="margin-top:16px">' + btn("Sign in with Google", "p") + "</div>") + "</div>"
        return phone(body, shell("you"))
    rows = ("<ul>" + nm_row(pair("A", "R", "#5b4a7c", "#7a4a12"), "You + Riya", "82% match · Updated today", ic("chevron_right", color="var(--t3)"))
            + nm_row(pair("A", "S", "#5b4a7c", "#1f4a3a"), "You + Sam", "Waiting for your friend · Invite sent", ib("share", "Share invite again", muted=True), last=True) + "</ul>")
    body = top("", "Back", ib("help", "What is a Blend?")) + h1("Blends", "0 16px 8px") + '<div class="btns" style="margin:4px 0 8px">' + btn("Create a Blend", "p", "add") + "</div>" + rows
    return phone(body, shell("you"))


def blend_detail():
    head = (f'<div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 16px 0">{pair("A", "R", "#5b4a7c", "#7a4a12").replace("width:56px", "width:56px;transform:scale(1.4);margin:8px 0")}'
            f'<h1 style="font:700 24px/30px Inter">You + Riya</h1><p class="meta">82% match · 40 songs · Updated today</p></div>')
    story = li("auto_stories", "Your Blend story", "Your match, shared songs and who brought what")
    rows = ul([song_row("small", meta="Both of you"), song_row("golden", meta="Riya brought this"), song_row("static", meta="You brought this", last=True)])
    body = (top("", "Back", ib("more_vert", "Blend options: refresh, invite, leave")) + head + '<div class="btns" style="margin-top:16px">' + btn("Play", "p", "play_arrow", True) + btn("Shuffle", "s", "shuffle") + "</div>"
            + '<div style="height:8px"></div>' + story + rows)
    return phone(body, shell("you"))


def blend_join(error=False):
    err = (f'<p style="display:flex;gap:6px;align-items:center;justify-content:center;margin-top:12px;font:400 13px/18px Inter;color:var(--danger)">{ic("error", size=16)}That did not work. Check the link and try again.</p>' if error else "")
    body = (top("Join a Blend", "Back") + '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:0 32px 180px;text-align:center">'
            + avatar("R", "#7a4a12", 72) + '<p class="lead">Riya invited you to a Blend</p><p class="body">A shared playlist from what you both play. It refreshes every day.</p>' + err
            + '<div style="display:flex;flex-direction:column;gap:8px;width:100%;margin-top:12px">' + btn("Try again" if error else "Join Blend", "p") + btn("Not now", "t") + "</div></div>")
    return phone(body, shell("you"))


def luvlink(in_room=False):
    if not in_room:
        body = (top("", "Back", ib("help", "About LuvLink")) + h1("LuvLink", "0 16px 4px") + '<p class="body" style="padding:0 16px 16px">Your people, your music, in sync. Make a room, share a song, stay in sync.</p>'
                + '<p class="lbl">Your name</p><div style="padding:6px 16px 0"><label class="field"><span class="v">Asha</span></label></div>'
                + '<div class="btns" style="margin-top:12px">' + btn("Start a room", "p", "add") + "</div>"
                + '<div class="hr" style="margin:24px 16px"></div><p class="lbl">Join with an invite code</p>'
                + '<div style="display:flex;gap:8px;padding:6px 16px 0"><label class="field" style="flex:1"><span class="v ph-t">Invite code</span></label>' + btn("Join", "s") + "</div>"
                + '<div style="height:16px"></div>' + li(None, "Share my listening taste", "Optional suggestions from opted-in listeners", switch=False))
        return phone(body, shell("you"))
    req = (f'<div style="display:flex;align-items:center;gap:12px;margin:8px 16px;padding:12px;border-radius:12px;background:var(--raised)">{avatar("S", "#1f4a3a", 40)}'
           f'<p style="flex:1;font:400 15px/20px Inter"><b style="font-weight:600">Sam</b> wants to join</p>{btn("Decline", "t", extra="sm")}{btn("Let in", "s", extra="sm")}</div>')
    people = ("<ul>" + nm_row(avatar("A", "#5b4a7c"), "Asha (you)", "Host") + nm_row(avatar("R", "#7a4a12"), "Riya", "Listening")
              + nm_row(avatar("K", "#3a2b63").replace("box-shadow", "opacity:.5;box-shadow"), "Kiran", "Offline", last=True) + "</ul>")
    body = (top("", "Back", ib("more_vert", "Room options")) + h1("Your LuvLink", "0 16px 4px")
            + '<div style="display:flex;align-items:center;gap:4px;padding:8px 4px 0 16px"><div style="flex:1"><p class="cap12" style="color:var(--t2)">Room code</p><p class="code">K7MQ2P</p></div>'
            + ib("content_copy", "Copy room code") + ib("share", "Share invite") + "</div>" + req + '<p class="gt">Listening · 3</p>' + people
            + '<div style="padding:8px 4px">' + btn("Leave room", "t").replace('class="btn t"', 'class="btn t" style="color:var(--danger)"') + "</div>")
    return phone(body, shell("you"))


# ================================================================= TOOLS: DJ, IMPORT, EDITORS
def dj(sheet_html=""):
    sugg = (opt("cloud", "Rainy evening, slow and warm", "A set of 20 songs") + opt("person", "More like Mira Vale", "From your library and the catalog")
            + opt("bolt", "/energy", "Pick up the pace from here"))
    now = ('<div style="margin:8px 16px;padding:4px 0;border-radius:12px;background:var(--raised)"><p class="lbl" style="padding-top:8px">This set · 18 songs</p>'
           + ul([song_row("low", "playing", meta="Harbor Kids · now"), song_row("small", trailing="close", meta="Mira Vale · next").replace("from recent searches", "from this set"), song_row("static", trailing="close", meta="Orla North", last=True).replace("from recent searches", "from this set")])
           + '<div style="display:flex;gap:8px;padding:4px 16px 12px">' + btn("Save as playlist", "s", "playlist_add") + "</div></div>")
    ask = ('<div style="position:absolute;left:0;right:0;bottom:146px;z-index:15;padding:8px 16px;background:var(--base)">'
           '<label class="field">' + ic("graphic_eq") + '<span class="v ph-t">Ask for a mood, a song, or type /</span>' + ib("send", "Ask the DJ") + "</label></div>")
    body = top("", "Back", ib("tune", "DJ settings")) + h1("Your DJ", "0 16px 0") + now + '<p class="gt">Try</p>' + sugg
    return phone(body, shell("you"), ask + sheet_html)


def dj_settings():
    inner = ('<div class="sh"><h2>DJ settings</h2>' + ib("close", "Close") + "</div>" + '<p class="lbl">Who picks the songs</p>'
             + opt(None, "On this phone", "Model ready on this phone", on=True, check=True) + opt(None, "Gemini", "Uses your API key", check=True)
             + opt(None, "OpenAI", "Uses your API key", check=True) + opt(None, "OpenRouter", "Uses your API key and a tool-calling model ID", check=True)
             + '<div class="hr"></div>' + opt("key_off", "Forget key"))
    return dj(scrim() + sheet(inner, "DJ settings"))


def import_screen(step="choose"):
    if step == "choose":
        rows = ("<ul>" + "".join(
            f'<li class="row"><span class="art tile" aria-hidden="true">{ic(i, size=22)}</span><span class="rt"><b>{n}</b><s><em>{m}</em></s></span>'
            f'<button class="ib{"" if on else " m"}" role="checkbox" aria-checked="{str(on).lower()}" aria-label="Bring {n}">{ic("check_box" if on else "check_box_outline_blank", on)}</button></li>'
            for i, n, m, on in [("favorite", "Liked songs", "412 songs", True), ("queue_music", "Night drive", "24 songs", True), ("queue_music", "Gym", "38 songs", False),
                                ("queue_music", "Monsoon", "57 songs", True)]) + "</ul>")
        body = (top("", "Back", ib("help", "How importing works")) + h1("Bring your music", "0 16px 4px")
                + '<p class="body" style="padding:0 16px 8px">Pick what to bring from Spotify. Songs are matched in the catalog and stream until you download them.</p>'
                + '<p class="lbl" style="padding-top:8px">Choose what to bring</p>' + rows)
        bar = ('<div style="position:absolute;left:0;right:0;bottom:0;z-index:20;background:var(--raised);padding:12px 16px 28px;border-top:1px solid var(--div)">' + btn("Bring 3 lists · 493 songs", "p", block=True) + "</div>")
        return phone(body, bar)
    if step == "progress":
        body = (top("", "Back") + h1("Import in progress", "0 16px 4px") + '<p class="body" style="padding:0 16px 16px">This keeps going if you leave. Stream shows how it is doing.</p>'
                + '<div style="padding:0 16px"><span style="display:block;height:4px;border-radius:2px;background:rgba(255,255,255,.18)"><span style="display:block;width:58%;height:4px;border-radius:2px;background:var(--t1)"></span></span>'
                + '<p class="meta" style="margin-top:8px;font-variant-numeric:tabular-nums">286 of 493 songs matched · 4 not found</p></div>'
                + '<p class="gt" style="margin-top:12px">Just matched</p>' + ul([song_row("glass", meta="Mira Vale · Liked songs"), song_row("mix", meta="Kabir & The Monsoons · Monsoon", last=True)]))
        return phone(body, shell("you"))
    body = (top("", "Back") + '<div style="flex:1;display:flex;align-items:center;padding-bottom:180px">' + empty_state(
        "check_circle", "Your music is in Allegra", "489 songs and 3 playlists are in your library. 4 songs weren’t found in the catalog.",
        '<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;width:100%">' + btn("Open Library", "p") + btn("See the 4 not found", "t") + "</div>") + "</div>")
    return phone(body, shell("you"))


def lyrics_editor():
    def fld(label, val, ph=False):
        return f'<p class="lbl" style="padding-top:12px">{label}</p><div style="padding:6px 16px 0"><label class="field"><span class="v{" ph-t" if ph else ""}">{esc(val)}</span></label></div>'
    lrc = ("[00:12.40] and the harbour lights go out<br>[00:16.85] one by one, like the years we lost<br>[00:21.10] I count them on the water<br>[00:25.60] every light a name I used to know")
    body = (top("Edit lyrics", "Close without saving", '<button class="btn t">Save</button>', close=True)
            + '<p class="gt" style="padding-top:4px">Song</p>' + fld("Title", "Low Tide") + fld("Artist", "Harbor Kids")
            + '<p class="gt" style="margin-top:12px">Lyrics</p><div style="display:flex;gap:8px;padding:4px 16px 8px">' + btn("Choose a source", "s", "travel_explore") + btn("Paste", "s", "content_paste") + "</div>"
            + f'<div style="margin:0 16px;padding:12px;border-radius:12px;background:var(--raised);font:400 14px/22px Inter;color:var(--t1);font-variant-numeric:tabular-nums">{lrc}</div>'
            + '<p class="gt" style="margin-top:12px">Timing</p><div style="display:flex;align-items:center;gap:8px;padding:4px 16px">'
            + '<span class="body" style="flex:1;color:var(--t1)">Shift all lines</span>' + ib("remove", "Earlier by half a second") + '<span style="font:600 15px Inter;font-variant-numeric:tabular-nums">+0.5 s</span>' + ib("add", "Later by half a second") + "</div>")
    return phone(body)


def cover_search():
    covers = ["small-hours", "paper-lanterns", "static-rain", "golden-hour", "fade", "night-drive", "daily-mix", "baarish", "low-tide"]
    grid = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px 16px">' + "".join(
        f'<button aria-label="Cover {i + 1}{", selected" if i == 0 else ""}" aria-pressed="{str(i == 0).lower()}" style="position:relative;border:0;padding:0;background:none;aspect-ratio:1">'
        f'<img src="{cov(c)}" alt="" style="width:100%;height:100%;border-radius:8px;object-fit:cover;display:block{";box-shadow:0 0 0 3px var(--base),0 0 0 5px var(--t1)" if i == 0 else ""}">'
        + (f'<span style="position:absolute;right:6px;top:6px;width:24px;height:24px;border-radius:12px;background:var(--t1);color:var(--base);display:flex;align-items:center;justify-content:center">{ic("check", size=18)}</span>' if i == 0 else "")
        + "</button>" for i, c in enumerate(covers)) + "</div>"
    body = (top("Change cover", "Back") + '<div style="padding:0 16px"><label class="field">' + ic("search") + '<span class="v">Small Hours Mira Vale</span>' + ib("close", "Clear", muted=True, size=20) + "</label></div>"
            + '<p class="meta" style="padding:12px 16px 0">From iTunes and Saavn · 9 covers</p>' + grid)
    bar = ('<div style="position:absolute;left:0;right:0;bottom:0;z-index:20;background:var(--raised);padding:12px 16px 28px;border-top:1px solid var(--div)">' + btn("Use this cover", "p", block=True) + "</div>")
    return phone(body, bar)


def version_search():
    rows = ul([song_row("baarish", meta="Tamil · 4:58 · Saavn"), song_row("baarish", meta="Hindi · 5:12 · In use").replace('class="row"', 'class="row on"'),
               song_row("baarish", meta="Unplugged · 3:44 · Gaana", last=True)])
    inner = ('<div class="sh"><h2>Another version</h2>' + ib("close", "Close") + "</div><div style=\"padding:0 16px 8px\"><label class=\"field focus\">" + ic("search")
             + '<span class="v">baarish tamil<span class="caret"></span></span></label></div>' + '<p class="meta" style="padding:4px 16px">The new version replaces this one everywhere it appears.</p>' + rows)
    return _ov(C.library_songs(), scrim() + sheet(inner, "Another version", top=200))


def edit_song():
    inner = ('<div class="sh"><h2>Edit title and artist</h2></div>'
             '<p class="lbl">Title</p><div style="padding:6px 16px 0"><label class="field focus"><span class="v">Small Hours<span class="caret"></span></span></label></div>'
             '<p class="lbl" style="padding-top:12px">Artist</p><div style="padding:6px 16px 0"><label class="field"><span class="v">Mira Vale</span></label></div>'
             f'<div class="btns" style="margin-top:16px">{btn("Cancel", "s")}{btn("Save", "p")}</div>')
    return _ov(C.library_songs(), scrim() + sheet(inner, "Edit title and artist", extra_style="bottom:300px;padding-bottom:16px") + keyboard(("Hours", "Hour", "Hourly")))


# ================================================================= OVERLAYS
def voice(state="listening"):
    if state == "listening":
        bars = "".join(f'<span style="width:4px;height:{h}px;border-radius:2px;background:var(--t1)"></span>' for h in (10, 22, 34, 18, 28, 12, 24, 16, 8))
        card_html = (f'<div role="status" aria-live="polite" style="position:absolute;left:12px;right:12px;bottom:154px;z-index:45;padding:16px;border-radius:16px;background:var(--pressed);box-shadow:0 12px 32px rgba(0,0,0,.45)">'
                     f'<div style="display:flex;align-items:center;gap:12px"><span style="display:flex;align-items:center;gap:3px;height:36px">{bars}</span><div style="flex:1"><p style="font:600 15px/20px Inter">Listening</p><p class="meta">Let go when you’re done</p></div></div>'
                     f'<p style="font:400 20px/26px Inter;margin-top:12px">mira vale small…</p></div>')
    else:
        card_html = (f'<div role="dialog" aria-label="Voice result" style="position:absolute;left:12px;right:12px;bottom:154px;z-index:45;padding:12px 4px 16px 16px;border-radius:16px;background:var(--pressed);box-shadow:0 12px 32px rgba(0,0,0,.45)">'
                     f'<div style="display:flex;align-items:center;gap:12px">{art("small-hours", 56)}<div style="flex:1;min-width:0"><p style="font:600 16px/21px Inter">Small Hours</p><p class="meta">Mira Vale · In your library</p></div>{ib("close", "Close")}</div>'
                     f'<div style="display:flex;gap:8px;margin-top:12px;padding-right:12px">' + btn("Play", "p", "play_arrow", True).replace('class="btn p"', 'class="btn p" style="flex:1"')
                     + btn("Play next", "s", "queue_play_next").replace('class="btn s"', 'class="btn s" style="flex:1"') + "</div></div>")
    return _ov(C.search_screen("idle"), card_html)


def play_here_confirm():
    inner = ('<div style="padding:8px 16px 0"><p class="lead">Play on this phone?</p><p class="body" style="margin-top:8px">“Voice memo 14” is only on this phone, so it can’t play on Living room PC. Playing it here stops the music there.</p></div>'
             '<div class="btns" style="margin-top:24px;flex-direction:column"><button class="btn p blk">Play on this phone</button><button class="btn s blk">Cancel</button></div>')
    return _ov(C.library_songs(), scrim() + sheet(inner, "Play on this phone?"))


def join_request_banner():
    card_html = (f'<div role="alert" style="position:absolute;left:12px;right:12px;top:36px;z-index:45;display:flex;align-items:center;gap:12px;padding:12px 4px 12px 12px;border-radius:16px;background:var(--pressed);box-shadow:0 12px 32px rgba(0,0,0,.45)">'
                 f'{avatar("S", "#1f4a3a", 40)}<p style="flex:1;font:400 14px/19px Inter"><b style="font-weight:600">Sam</b> wants to join your LuvLink</p>{btn("Decline", "t", extra="sm")}{btn("Let in", "s", extra="sm")}</div>')
    return _ov(stream_home(), card_html)


def about_sheet():
    inner = ('<div class="sh"><h2>About LuvLyrics</h2>' + ib("close", "Close") + "</div>"
             + '<div style="margin:0 16px 8px;padding:12px 16px;border-radius:12px;background:var(--control)"><p style="font:600 15px/20px Inter">Update available · 1.36.0</p><p class="meta" style="margin-top:2px">18 MB · Polished sheets, faster playlists</p>'
             + '<div style="display:flex;gap:8px;margin-top:12px">' + btn("Download update", "p") + btn("What’s new", "t") + "</div></div>"
             + '<p class="body" style="padding:8px 16px 8px">LuvLyrics started as one person’s lyrics player and grew from there. It’s free and has no ads.</p>'
             + opt("language", "Website") + opt("photo_camera", "Instagram") + opt("coffee", "Buy me a coffee")
             + '<div class="hr"></div><p class="lbl" style="padding-top:8px">Found a bug?</p>'
             + '<div style="padding:6px 16px 0;display:flex;flex-direction:column;gap:8px"><label class="field" style="height:72px;align-items:flex-start;padding-top:12px"><span class="v ph-t">What went wrong?</span></label>'
             + '<label class="field"><span class="v ph-t">Email or Instagram, if you want a reply</span></label></div>'
             + '<div class="btns" style="margin-top:12px">' + btn("Send report", "s") + "</div>" + opt("shield", "Privacy"))
    return _ov(stream_home(), scrim() + sheet(inner, "About", top=64))


def error_boundary():
    body = ('<div style="flex:1;display:flex;align-items:center;padding-bottom:120px">' + empty_state(
        "sync_problem", "This screen stopped working", "Your music keeps playing. Reopen the screen, or copy the details for a bug report.",
        '<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;width:100%">' + btn("Reopen", "p", "refresh") + btn("Copy details", "t", "content_copy") + "</div>") + "</div>")
    return phone(body, shell("library"))


# ================================================================= RESPONSIVE
def responsive():
    small_lib = C.library_songs(pk={"w": 320, "h": 640})
    big_text = C.library_songs(pk={"w": 360, "h": 780, "cls": "x2"})
    short_np = C.now_playing(art_size=208, volume=False, pk={"w": 360, "h": 640})
    large_pl = C.playlist_detail(pk={"w": 430, "h": 932})
    kb = C.search_screen("typing", pk={"w": 360, "h": 740})
    return [
        cell("320 × 640, small phone", "Nothing overlaps, but only three and a half rows show: the shell takes 146 of 640. The list scrolls under it.", small_lib,
             proposals=["on screens under 700 tall, a 56 mini player and 72 nav (saves 16); open question"], w=320),
        cell("360 × 780 at 200% text", "Rows grow to two-line titles instead of clipping; tabs scroll; nav labels cap at 1.3×.", big_text,
             proposals=["Cap nav label growth at 1.3× so five labels fit"], w=360),
        cell("360 × 640, short screen player", "The cover gives way first (208 here); controls never shrink below 48. There is no volume row on any size.", short_np, w=360),
        cell("430 × 932, large phone", "Extra width goes to the list, not to bigger controls.", large_pl, w=430),
        cell("360 × 740 with keyboard", "Results stay above the keyboard; the shell is hidden while typing.", kb, w=360),
    ]


# ================================================================= BOARD MAP
def boards(with_overlay):
    B = {}

    def add(name, title, cells, page="full"):
        B[name] = (title, board(title, cells), None, None, page)

    add("V5-LibraryMore.dc.html", "Library: other tabs and tools", [
        cell("Playlists tab", "Grid: playlist art, name, “Playlist · n songs”. New playlist is the first tile. Online playlists from the website show their source.", lib_playlists(),
             proposals=["Playlists folds into Library as a tab (today a header button and a ••• item)"]),
        cell("Playlists: none yet", "One way forward.", lib_playlists(empty=True)),
        cell("Artists tab", "People are circles. Tap opens the artist page, which already has an “On this phone” section.", lib_artists(),
             proposals=["Artists tab replaces the “Your artists” orbit filter", "Sort artists by most songs or A–Z"]),
        cell("Albums tab", "Grouped from the album field of downloaded songs; album cards say “Album · artist”, playlists say “Playlist · n songs”.", lib_albums(),
             proposals=["New tab: the app has album names but no album view today"]),
        cell("Library ⋮", "Less-used tools leave the header.", lib_menu(), proposals=["Import and Blends move here from four header circles"]),
        cell("Downloads", "From the header icon (badge shows how many are running). Every state of a download.", download_queue()),
    ])
    add("V5-PlaylistFlows.dc.html", "Playlist: create, rename, delete", [
        cell("New playlist", "Sheet sits on the keyboard; Create stays disabled until there is a name.", create_playlist(empty=True)),
        cell("New playlist: typed", "Create is enabled; one tap creates and opens the new playlist (the button turns busy so a double tap can’t make two).", create_playlist()),
        cell("New playlist: failed", "Says what happened; the name is kept for another try.", create_playlist(error="Couldn’t create the playlist. Try again.")),
        cell("Created", "Opens the new playlist with Add songs as the next step.", new_playlist_created(), proposals=["Open the new playlist after creating it"]),
        cell("Long press a playlist", "Shortcuts, then Rename and Delete.", playlist_longpress()),
        cell("Rename", "Same sheet as New playlist, prefilled.", rename_playlist()),
        cell("Delete playlist", "Irreversible, so it asks; the body says the songs stay.",
             confirm("Delete “Night drive”?", "Songs stay in your library.", "Delete playlist", lambda o: C.playlist_detail(sheet_html=o))),
    ])
    add("V5-AddToPlaylist.dc.html", "Adding songs to playlists", [
        cell("Add to playlist (library song)", "Ticks show playlists that already have the song. Tap a playlist to add and close; New playlist names one inline.", add_to_playlist_sheet(),
             proposals=["Show which playlists already have the song"]),
        cell("Add to playlist (streamed song)", "A stream can also be saved without a playlist, as today.", add_to_playlist_sheet(stream=True)),
        cell("Add songs (from a playlist)", "Full screen: the title names the playlist being filled; songs already in it are dimmed; the button counts.", add_songs_screen()),
        cell("Added", "Back on the playlist, a toast confirms.", added_toast()),
    ])
    add("V5-Stream.dc.html", "Stream (home)", [
        cell("Stream", "Why open Stream instead of Library: what to play next, from the catalog and your history. Moods are real YouTube Music chips that load their own shelves.", stream_home(),
             proposals=["“Jump back in” moves here from Library", "Stream’s own search field goes: Search is a tab"]),
        cell("Mood chosen", "A chip loads your mix for that mood first, then its shelves.", stream_home("mood")),
        cell("Loading (first open only)", "Stream opens on its last page from cache; placeholders only when there is none.", stream_home("loading")),
        cell("Catalog unreachable", "Keeps the last page and says so.", stream_home("error")),
        cell("Add a list", "Paste songs one per line; each is matched; wrong matches can be swapped.", add_list_sheet()),
        cell("LuvLink join request", "Appears over any screen.", join_request_banner()),
    ])
    add("V5-Luvs.dc.html", "Luvs", [
        cell("Luvs", "A taste map: lanes across, a stack of clips in each. Swipe up for the next clip. The mini player hides here (Luvs plays its own clips).", luvs()),
        cell("Languages", "Multi-select chips; Save applies.", luvs_languages()),
        cell("Saved from Luvs", "Clips you saved, ready to download.", luvs_saved(), proposals=["Name: “Saved from Luvs” (copy)"]),
    ])
    add("V5-Browse.dc.html", "Artist and album pages", [
        cell("Artist", "Photo band, not a full-screen hero: songs start above the fold. Play is the one white action.", artist_page()),
        cell("Artist, scrolled", "Shelves reuse the card; people stay circles.", artist_page(scrolled=True)),
        cell("Album (YouTube Music collection)", "Like a playlist page but with track numbers instead of covers, and album metadata.", collection_page()),
        cell("Couldn’t load", "Try again, or go back.", artist_page(error=True)),
    ])
    add("V5-PlayerTools.dc.html", "Player sheets and modes", [
        cell("Sleep timer", "The five choices the app has.", sleep_timer()),
        cell("Sleep timer running", "Countdown, extend, or turn off. The moon icon fills on the player.", sleep_timer(True)),
        cell("Connect devices", "Where playback runs. Offline devices are dimmed and say when they last played.", connect_devices()),
        cell("Connect, signed out", "Explains the one thing an account adds.", connect_devices(False)),
        cell("Lyrics sources", "Long press on Lyrics, or from ⋮. Every source asked at once; each answer listed as it lands.", lyrics_sources()),
        cell("Details", "From ⋮ › Details.", details_sheet()),
        cell("Tempo and pitch", "Android only.", tempo_sheet()),
        cell("Ambient mode", "Full screen cover, screen kept on.", ambient()),
        cell("Playing on another device", "The same player, remote: a chip names the device; controls send commands to it.", remote_player()),
    ])
    add("V5-You.dc.html", "You and Settings", [
        cell("You", "One place for everything that isn’t listening or browsing: today’s ••• menu plus the Library header tools.", you_hub(),
             proposals=["New tab replacing ••• (Your DJ, Settings, Playlists, Search live elsewhere)"]),
        cell("Today: ••• menu (reference)", "What the You tab replaces.", today_more()),
        cell("Settings", "Grouped list; values on the right open a sheet; switches act at once.", settings_top(),
             proposals=["Retire App background, Mini player background and Bottom bar style: the shell and screen backgrounds are now fixed (open question)"]),
        cell("Settings: library and data", "Destructive rows are red and ask first.", settings_top(1)),
        cell("A choice sheet", "Every multi-choice setting uses this.", choice_sheet()),
        cell("First sync", "Signing in with a library on both sides asks once.", sync_choice()),
        cell("Hidden songs", "Select and show again.", hidden_songs()),
        cell("Hidden songs: none", "Says what would appear here.", hidden_songs(empty=True)),
    ])
    add("V5-Social.dc.html", "Blends and LuvLink", [
        cell("Blends", "One primary action; each Blend says its state.", blends()),
        cell("Blends, signed out", "Explains, then one way in.", blends(False)),
        cell("A Blend", "Who brought each song, in the meta line.", blend_detail()),
        cell("Join a Blend", "From an invite link.", blend_join()),
        cell("Join failed", "Inline, with a retry.", blend_join(error=True)),
        cell("LuvLink", "Start a room or join with a code.", luvlink()),
        cell("In a room", "Room code (the one place letters are spaced), requests, who’s listening.", luvlink(True)),
    ])
    add("V5-Tools.dc.html", "DJ, import and editors", [
        cell("Your DJ", "The set so far, then suggestions; the ask field sits above the shell.", dj()),
        cell("DJ settings", "Where the picks come from.", dj_settings()),
        cell("Import: choose", "Pick lists to bring.", import_screen()),
        cell("Import: running", "Keeps going if you leave.", import_screen("progress")),
        cell("Import: done", "What arrived and what didn’t.", import_screen("done")),
        cell("Edit lyrics", "Song fields, source or paste, shift timing.", lyrics_editor()),
        cell("Change cover", "Search iTunes and Saavn; pick one.", cover_search()),
        cell("Another version", "Find the song in another language or version.", version_search()),
        cell("Edit title and artist", "From the song sheet. Save is disabled while the title is empty.", edit_song()),
    ])
    add("V5-Overlays.dc.html", "Voice, notices and app states", [
        cell("Voice: listening", "Hold the mic in the search field; the card shows the live level and words.", voice(), proposals=["Mic lives in the search field (today a tab-bar button)"]),
        cell("Voice: result", "Best match, with Play and Play next.", voice("result")),
        cell("Play on this phone?", "A song only this phone has, while another device is playing.", play_here_confirm()),
        cell("About and updates", "Update first when there is one; bug report form.", about_sheet(), gaps=["copy: today’s coffee row has an emoji, which the copy rules forbid"]),
        cell("A screen crashed", "Error boundary: the player keeps playing.", error_boundary(), proposals=["Copy for the existing Reopen screen"]),
    ])
    add("V5-Responsive.dc.html", "Sizes and large text", responsive())
    return B
