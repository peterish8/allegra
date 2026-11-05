"""Round 6 refinements, applied on top of the round-5 kit so every board inherits them.

- Mini player: the progress line is a seek band (rest, scrubbing, disabled).
- Hierarchy pass: one compact primary action per state; the rest are text actions.
- Library: search moves into the tab row; a quiet sort trigger; no Shuffle row.
- Playlist: cover above the title, compact Play disc + Shuffle, quiet utilities; loading and partial-error states.
- Stream: one filter row, Jump back in grid, Quick picks, one "Made for you" shelf instead of many.
- Empty library and music-access states with a small deck illustration.
"""
import v5_kit as K
import v5_core as C
import v5_rest as R
import v5_player as P
from v5_kit import SONGS, cov, esc, ic, ib, btn, art, phone, shell, sheet, opt, song_row, toast, keyboard, skeleton_rows, cell, board, gen_art, mosaic

R6_CSS = """
/* mini player seek band: the line is the top edge; the band is its own 20 tall touch strip */
.sband{position:relative;height:24px}
.sband .tr{position:absolute;left:0;right:0;top:0;height:2px;background:rgba(255,255,255,.14)}
.sband .tr i{display:block;height:2px;background:var(--t1)}
.sband.scrub .tr{height:4px;top:-1px}
.sband.scrub .tr i{height:4px}
.sband .th{position:absolute;top:-6px;width:14px;height:14px;border-radius:7px;background:var(--t1);box-shadow:0 2px 6px rgba(0,0,0,.4)}
.sband .bub{position:absolute;bottom:calc(100% + 10px);padding:6px 10px;border-radius:8px;background:rgba(18,20,24,.9);backdrop-filter:blur(16px);
    font:600 13px Inter;color:var(--t1);font-variant-numeric:tabular-nums;white-space:nowrap;box-shadow:0 8px 20px rgba(0,0,0,.35)}
.sband.off .tr{background:repeating-linear-gradient(90deg,rgba(255,255,255,.22) 0 6px,transparent 6px 10px)}
.mini{height:56px}
.mini .id{height:56px}
.mini.dim{opacity:.4}

/* hierarchy: secondary actions are text; a text button never stretches */
.btns:has(.btn.t){justify-content:flex-end;align-items:center}
.btns:has(.btn.t) .btn{flex:0 0 auto}
.empty{gap:6px;padding:0 40px}
.empty .lead{font:700 19px/25px Inter}
.empty .body{font:400 14px/20px Inter;max-width:280px}
.empty .ei{width:52px;height:52px;border-radius:14px;margin-bottom:6px}
.empty .ei .ms{font-size:26px}
.acts{display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:14px}
.acts .btn.t{color:var(--t2)}
.jt .pr{position:absolute;left:0;bottom:0;width:56px;height:3px;background:rgba(0,0,0,.5)}
.jt .pr i{display:block;height:3px;background:var(--t1)}

/* library: search lives in the tab row; quiet sort */
.tabs.ws{padding-right:4px;align-items:center}
.tabs.ws .sp{flex:1}
.sortq{height:48px;display:flex;align-items:center;gap:4px;border:0;background:none;padding:0 8px;margin-left:8px;font:600 13px Inter;color:var(--t2)}
.sortq .ms{font-size:18px}
.lsearch{display:flex;align-items:center;gap:4px;height:48px;margin:4px 12px 0;padding:0 4px;border-radius:12px;
    background:rgba(255,255,255,.08);backdrop-filter:blur(18px) saturate(1.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.lsearch .v{flex:1;min-width:0;font:400 15px Inter;color:var(--t1);white-space:nowrap;overflow:hidden}

/* playlist */
.pstage{position:relative;align-self:center;width:184px;height:184px;margin-top:4px;flex-shrink:0}
.pstage .amb{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:12px;filter:blur(26px) saturate(1.6);opacity:.65;transform:translateY(18px) scale(.86)}
.pstage .cv{position:relative;display:block;width:100%;height:100%;object-fit:cover;border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.22),0 22px 44px -10px rgba(0,0,0,.55)}
.pstage .rim{position:absolute;inset:0;border-radius:12px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.ptitle{flex-shrink:0;font:700 24px/30px Inter;text-align:center;padding:0 24px;margin-top:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pact{flex-shrink:0;display:flex;align-items:center;gap:4px;padding:10px 12px 0 16px}
.pact .m{flex:1;min-width:0;font:400 13px/18px Inter;color:var(--t2)}
.gshuf{width:48px;height:48px;border:0;background:none;padding:0;display:flex;align-items:center;justify-content:center}
.gshuf span{width:44px;height:44px;border-radius:22px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.1);color:var(--t1);box-shadow:inset 0 1px 0 rgba(255,255,255,.1)}
.pplay{width:56px;height:56px;border-radius:28px;border:0;padding:0;display:flex;align-items:center;justify-content:center;background:var(--t1);color:var(--base);margin-left:4px}
.pplay .ms{font-size:32px}
.putil{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:6px 4px 0 0}
.qbtn{height:48px;display:flex;align-items:center;gap:4px;border:0;background:none;padding:0 12px;font:600 13px Inter;color:var(--t2)}
.qbtn .ms{font-size:18px}
.note{display:flex;align-items:center;gap:10px;margin:6px 16px 2px;padding:8px 4px 8px 12px;border-radius:10px;background:rgba(255,255,255,.06);font:400 13px/18px Inter;color:var(--t1)}
.note .x{flex:1}

/* stream */
.jgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 16px}
.jt{position:relative;display:flex;align-items:center;gap:10px;height:56px;padding-right:8px;border-radius:8px;overflow:hidden;background:rgba(255,255,255,.06);border:0;color:inherit;text-align:left}
.jt img,.jt .gen{width:56px;height:56px;object-fit:cover;flex-shrink:0;border-radius:0}
.jt img.c{width:40px;height:40px;border-radius:20px;margin-left:8px}
.jt span{display:flex;flex-direction:column;min-width:0}
.jt b{font:600 13px/17px Inter;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jt s{text-decoration:none;font:400 12px/16px Inter;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sh2{display:flex;align-items:center;height:48px;padding:0 4px 0 16px;margin-top:12px}
.sh2 h2{flex:1;font:600 18px/24px Inter}
.mcard{width:148px;flex-shrink:0}
.mcard .cv{width:148px;height:148px;border-radius:12px;object-fit:cover;display:block}
.mcard b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:8px;font:400 15px/20px Inter}
.mcard s{display:block;text-decoration:none;font:400 13px/18px Inter;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.acard{width:96px;flex-shrink:0;text-align:center}
.acard img,.acard .gen{width:96px;height:96px;border-radius:48px;object-fit:cover;display:flex}
.acard b{display:block;margin-top:8px;font:400 13px/18px Inter;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* illustration: a small fanned deck with a note */
.deckill{position:relative;width:150px;height:118px;margin-bottom:10px}
.deckill i{position:absolute;left:45px;top:14px;width:62px;height:62px;border-radius:10px;box-shadow:0 10px 24px rgba(0,0,0,.4),inset 0 0 0 1px rgba(255,255,255,.08)}
.deckill .n{position:absolute;color:var(--t1)}
.x2 .jgrid{grid-template-columns:1fr}
.x2 .jt{height:auto;min-height:64px}
.x2 .jt b{font-size:22px;line-height:28px;white-space:normal}
.x2 .jt s{font-size:20px;line-height:26px}
.x2 .sh2 h2,.x2 .ptitle{font-size:34px;line-height:40px}
.x2 .pact .m{font-size:22px;line-height:28px}
.x2 .chip>span{font-size:22px;height:auto;min-height:40px}
"""
K.CSS += R6_CSS

_btn = K.btn


def btn2(label, kind="p", *a, **kw):
    """Hierarchy rule: Cancel and Not now are never filled."""
    if label in ("Cancel", "Not now") and kind == "s":
        kind = "t"
    return _btn(label, kind, *a, **kw)


for m in (K, C, R):
    m.btn = btn2
btn = btn2


# ------------------------------------------------------------------ mini player with a seek band
def mini_player(state="playing", song="low", progress=38):
    title, artist, _, cover, _ = SONGS[song]
    dim = ""
    if state == "scrub":
        band = (f'<div class="sband scrub" role="slider" aria-label="Song position" aria-valuetext="2:03 of 3:41">'
                f'<span class="tr"><i style="width:56%"></i></span><span class="th" style="left:calc(56% - 7px)"></span>'
                f'<span class="bub" style="left:calc(56% - 46px)">2:03 / 3:41</span></div>')
        dim = " dim"
    elif state == "nodur":
        band = '<div class="sband off" role="slider" aria-label="Song position" aria-disabled="true" aria-valuetext="Length not known yet"><span class="tr"></span></div>'
    elif state == "buffering":
        band = f'<div class="sband" role="slider" aria-label="Song position" aria-valuetext="1:24 of 3:41, loading"><span class="tr"><i style="width:{progress}%;opacity:.5"></i></span></div>'
    else:
        band = f'<div class="sband" role="slider" aria-label="Song position" aria-valuetext="1:24 of 3:41"><span class="tr"><i style="width:{progress}%"></i></span></div>'
    if state == "buffering":
        sub = f"<s>{esc(artist)}</s>"
        ctrl = ('<button class="ib" aria-label="Loading. Pause" aria-busy="true"><span class="ring lg" aria-hidden="true"></span></button>' + ib("skip_next", "Next song", True))
    elif state == "remote":
        sub = f'<s>{ic("computer")}Playing on Living room PC</s>'
        ctrl = ib("pause", "Pause on Living room PC", True, size=32) + ib("skip_next", "Next song", True)
    elif state == "error":
        sub = f'<s class="err">{ic("error")}Couldn’t play</s>'
        ctrl = ib("refresh", "Couldn’t play. Try again") + ib("skip_next", "Next song", True)
    else:
        sub = f"<s>{esc(artist)}</s>"
        play = state in ("playing", "scrub")
        ctrl = ib("pause" if play else "play_arrow", "Pause" if play else "Play", True, size=32) + ib("skip_next", "Next song", True)
    return (band + f'<div class="mini{dim}" role="group" aria-label="Now playing"><button class="id" style="border:0;background:none;padding:0;color:inherit;text-align:left" '
            f'aria-label="{esc(title)} by {esc(artist)}. Open player">{art(cover, 44)}<span class="tx"><b>{esc(title)}</b>{sub}</span></button>{ctrl}</div>')


K.mini_player = mini_player
C.mini_player = mini_player


# ------------------------------------------------------------------ hierarchy: compact empty states
def empty_state(icon, title, body, actions="", illo=None):
    lead = illo if illo is not None else f'<span class="ei" aria-hidden="true">{ic(icon)}</span>'
    if actions:
        # one compact primary; anything else becomes text; nothing full width
        actions = (actions.replace("btn s", "btn t").replace("btn p blk", "btn p").replace("width:100%", "")
                   .replace('style="display:flex;flex-direction:column;gap:8px;margin-top:16px;"', 'class="acts"')
                   .replace('style="display:flex;flex-direction:column;gap:8px;margin-top:16px"', 'class="acts"')
                   .replace('style="margin-top:16px"', 'class="acts"').replace('style="margin-top:12px"', 'class="acts"'))
    return f'<div class="empty">{lead}<p class="lead">{esc(title)}</p><p class="body">{esc(body)}</p>{actions}</div>'


for m in (K, C, R):
    m.empty_state = empty_state


def deck_illustration(frame=3):
    """frame 1..3 = entrance (stacked → fanned); 3 is also the reduced-motion and resting state."""
    pos = {1: [(0, 0, .0), (0, 0, .0), (0, 0, 1)], 2: [(-8, -14, .6), (8, 14, .6), (0, 0, 1)], 3: [(-14, -30, 1), (14, 30, 1), (0, 0, 1)]}[frame]
    tones = [("#3b4a7a", "#6b3b5c"), ("#1f4a3a", "#2f6a7c"), ("#7a4a12", "#9a3a22")]
    cards = ""
    for (rot, dx, op), (a, b) in zip(pos, tones):
        cards += f'<i style="background:linear-gradient(135deg,{a},{b});transform:translateX({dx}px) rotate({rot}deg);opacity:{op}"></i>'
    note_op = {1: 0, 2: .4, 3: 1}[frame]
    note_y = {1: 10, 2: 4, 3: 0}[frame]
    note = (f'<span class="n" style="left:92px;top:{70 + note_y}px;opacity:{note_op};width:34px;height:34px;border-radius:17px;background:var(--t1);color:var(--base);'
            f'display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,.4)">{ic("music_note", True, 20)}</span>')
    return f'<div class="deckill" aria-hidden="true">{cards}{note}</div>'


def phone_illustration():
    return ('<div aria-hidden="true" style="position:relative;width:84px;height:104px;margin-bottom:10px">'
            '<span style="position:absolute;left:18px;top:4px;width:48px;height:86px;border-radius:10px;box-shadow:inset 0 0 0 2px var(--t2)"></span>'
            '<span style="position:absolute;left:36px;top:10px;width:12px;height:3px;border-radius:2px;background:var(--t2)"></span>'
            f'<span style="position:absolute;left:28px;top:30px;color:var(--t1)">{ic("library_music", True, 28)}</span>'
            f'<span style="position:absolute;right:2px;bottom:4px;width:30px;height:30px;border-radius:15px;background:var(--t1);color:var(--base);display:flex;align-items:center;justify-content:center">{ic("add", size=20)}</span></div>')


# ------------------------------------------------------------------ library
def library_tabs(active="songs"):
    tabs = [("songs", "Songs"), ("playlists", "Playlists"), ("artists", "Artists"), ("albums", "Albums")]
    names = dict(tabs)
    return ('<div class="tabs ws" role="tablist" aria-label="Show in Library">' + "".join(
        f'<button class="tab{" on" if k == active else ""}" role="tab" aria-selected="{str(k == active).lower()}">{t}</button>' for k, t in tabs)
        + f'<span class="sp"></span>{ib("search", f"Search in {names[active]}")}</div>')


def sort_quiet(label, aria="Sort"):
    return (f'<button class="sortq" aria-haspopup="dialog" aria-label="{aria}: {esc(label)}. Change">{ic("swap_vert")}{esc(label)}{ic("expand_more")}</button>')


LIB = ["low", "baarish", "static", "small", "lanterns", "fade", "golden", "drive", "mix"]
LIB_AZ = ["baarish", "fade", "golden", "low", "mix", "drive", "lanterns", "small", "static"]


def library_songs(state="default", mini="playing", sheet_html="", pressed=None, pk=None, query=None):
    head = C.library_header()
    if state == "empty":
        body = (head + library_tabs() + '<div style="flex:1;display:flex;align-items:center;padding-bottom:110px">'
                + empty_state(None, "Your next favorite starts here", "Save songs from Stream, or add music files from this phone.",
                              '<div class="acts">' + btn("Find music on Stream", "p", "radio") + btn("Add songs from this phone", "t", "smartphone") + "</div>",
                              illo=deck_illustration(3)) + "</div>")
        return phone(body, shell("library", None), sheet_html, glow_cover=None, **(pk or {}))
    if state in ("ask", "settings"):
        line = ("Allow access to music and audio to see the songs stored on this phone." if state == "ask"
                else "Access to music and audio isn’t allowed for LuvLyrics. You can allow it in Android settings.")
        primary = btn("Allow access", "p") if state == "ask" else btn("Open settings", "p", "open_in_new")
        body = (head + library_tabs() + '<div style="flex:1;display:flex;align-items:center;padding-bottom:110px">'
                + empty_state(None, "Add music from your phone", line, '<div class="acts">' + primary + btn("Not now", "t") + "</div>", illo=phone_illustration())
                + "</div>")
        return phone(body, shell("library", None), sheet_html, glow_cover=None, **(pk or {}))
    if state == "loading":
        body = head + library_tabs() + '<div style="padding:0 0 4px">' + sort_quiet("Recently added") + "</div>" + skeleton_rows(8)
        return phone(body, shell("library", mini), sheet_html, **(pk or {}))
    order = LIB_AZ if state == "az" else LIB
    if state in ("search", "results"):
        q = query or "mira"
        bar = (f'<div class="lsearch" role="search">{ib("arrow_back", "Close search")}<span class="v">{esc(q)}'
               + ('<span class="caret"></span>' if state == "search" else "") + f'</span>{ib("close", "Clear search", muted=True, size=20)}</div>')
        rows = [song_row("small"), song_row("lanterns", last=True)]
        body = (head + bar + '<p class="meta" style="padding:10px 16px 2px">2 of 248 songs · searching Songs only</p>' + C.ul(rows))
        if state == "search":
            return phone(body, "", keyboard(), **(pk or {}))
        return phone(body, shell("library", mini), sheet_html, **(pk or {}))
    rows = []
    for k in order:
        st = "playing" if k == "low" and mini in ("playing", "scrub") else "paused" if k == "low" and mini == "paused" else None
        rows.append(song_row(k, st, pressed=(k == pressed)))
    sort = "Title A–Z" if state == "az" else "Recently added"
    body = head + library_tabs() + '<div style="display:flex;align-items:center;padding:2px 0 0">' + sort_quiet(sort) + '<span class="meta" style="margin-left:auto;padding-right:16px">248 songs</span></div>' + C.ul(rows)
    overlay = ""
    if state == "az":
        overlay = ('<div aria-hidden="true" style="position:absolute;right:4px;top:280px;z-index:30;display:flex;align-items:center;gap:8px">'
                   '<span style="width:56px;height:56px;border-radius:28px 28px 4px 28px;background:var(--t1);color:var(--base);display:flex;align-items:center;justify-content:center;font:700 26px Inter">M</span>'
                   '<span style="width:6px;height:48px;border-radius:3px;background:var(--t2)"></span></div>')
    return phone(body, shell("library", mini), overlay + sheet_html, **(pk or {}))


C.library_tabs = library_tabs
R.library_tabs = library_tabs
C.library_songs = library_songs
R.C.library_songs = library_songs


def motion_strip():
    frames = "".join(f'<div style="display:flex;flex-direction:column;align-items:center;gap:6px">{deck_illustration(f)}<span class="cap12">{t}</span></div>'
                     for f, t in ((1, "0 ms"), (2, "220 ms"), (3, "520 ms, rest")))
    body = ('<div style="padding:24px 16px 0"><p class="lead">Entrance, frame by frame</p><p class="body" style="margin-top:6px">Cards fan out once, the note rises in last. '
            'Transform and opacity only, 520 ms decelerate, about 40 KB of drawn shapes (no image asset).</p></div>'
            f'<div style="display:flex;justify-content:space-between;padding:24px 0 0">{frames}</div>'
            '<div style="padding:24px 16px 0"><p class="lead">Afterwards</p><p class="body" style="margin-top:6px">After 8 s idle the front card tilts 2° and settles, at most twice, then the scene holds still.</p>'
            '<p class="lead" style="margin-top:20px">Reduce Motion</p><p class="body" style="margin-top:6px">The resting frame appears with a 160 ms fade. No tilt.</p></div>')
    return phone(body, "", "", glow_cover=None)


# ------------------------------------------------------------------ playlist
PL = ["low", "small", "baarish", "static", "fade", "golden", "drive", "lanterns"]


def playlist_detail(state="default", mini="playing", sheet_html="", toast_html="", pk=None, name="Night drive"):
    top = f'<div class="top">{ib("arrow_back", "Back")}<span class="tt"></span>{ib("search", f"Find in {name}")}{ib("more_vert", f"{name} options")}</div>'
    if state == "edit":
        return C._old_playlist_detail("edit", mini, sheet_html, toast_html, pk)
    if state == "long":
        name = "Late night drives through the old city (monsoon edit)"
    empty = state == "empty"
    if empty:
        name = "Road trip"
    cover = ('<div class="pstage">' + (f'<span class="tile" style="width:184px;height:184px;border-radius:12px;display:flex" aria-hidden="true">{ic("queue_music", size=56, color="var(--t2)")}</span>' if empty else
             f'<img class="amb" src="{cov("night-drive")}" alt="" aria-hidden="true"><img class="cv" src="{cov("night-drive")}" alt="Cover of {esc(name)}"><span class="rim" aria-hidden="true"></span>') + "</div>")
    title = f'<h1 class="ptitle" title="{esc(name)}">{esc(name)}</h1>'
    if empty:
        body = (top + cover + title + '<p class="meta" style="text-align:center;margin-top:4px">Playlist · No songs yet</p>'
                + '<div style="flex:1;display:flex;align-items:flex-start;justify-content:center;padding-top:28px">'
                + f'<div class="acts" style="margin:0">{btn("Add songs", "p", "add")}</div></div>')
        return phone(body, shell("library", mini), sheet_html, **(pk or {}))
    meta = "Playlist · 24 songs<br>1 h 32 min"
    act = (f'<div class="pact"><p class="m">{meta}</p>'
           f'<button class="gshuf" aria-label="Shuffle {esc(name)}"><span>{ic("shuffle")}</span></button>'
           f'<button class="pplay" aria-label="Play {esc(name)}">{ic("play_arrow", True)}</button></div>')
    util = f'<div class="putil">{sort_quiet("Custom order", "Order")}<button class="qbtn">{ic("add")}Add songs</button></div>'
    if state == "loading":
        rows = C.ul([song_row(k) for k in ["low", "small", "baarish"]]) + skeleton_rows(4)
        note = ""
    else:
        rows = C.ul([song_row(k, "playing" if (k == "low" and mini == "playing") else None) for k in PL])
        note = ""
        if state == "error":
            note = (f'<div class="note" role="status">{ic("cloud_off", size=18, color="var(--t2)")}<span class="x">18 of 24 songs shown. Songs saved on Allegra web didn’t load.</span>'
                    '<button class="btn t sm">Try again</button></div>')
    body = top + cover + title + act + util + note + rows
    return phone(body, shell("library", mini), sheet_html + toast_html, **(pk or {}))


C._old_playlist_detail = C.playlist_detail
C.playlist_detail = playlist_detail
R.C.playlist_detail = playlist_detail


def playlist_sort_sheet():
    inner = ('<div class="sh"><h2>Order songs by</h2>' + ib("close", "Close") + "</div>"
             + opt(None, "Custom order", "The order you set with Edit order", check=True) + opt(None, "Title", on=True, check=True)
             + opt(None, "Artist", check=True) + opt(None, "Recently added", check=True)
             + '<p class="lbl" style="padding-top:12px">Direction</p><div class="chips" role="radiogroup" aria-label="Direction">'
             + '<button class="chip on" role="radio" aria-checked="true"><span>' + ic("check") + 'A to Z</span></button>'
             + '<button class="chip" role="radio" aria-checked="false"><span>Z to A</span></button></div>'
             + '<p class="cap12" style="padding:8px 16px 0">Kept for this playlist next time.</p>')
    return '<div class="scrim"></div>' + sheet(inner, "Order songs by")


# ------------------------------------------------------------------ stream
def jtile(cover, title, meta, kind="sq", progress=None):
    a = f'<img class="c" src="{cov(cover)}" alt="">' if kind == "artist" else f'<img src="{cov(cover)}" alt="">'
    pr = f'<span class="pr" aria-hidden="true"><i style="width:{progress}%"></i></span>' if progress else ""
    lab = f"{title}, {meta}" + (f", {progress}% played" if progress else "")
    return f'<button class="jt" aria-label="{esc(lab)}">{a}{pr}<span><b>{esc(title)}</b><s>{esc(meta)}</s></span></button>'


def mcard(cover_html, title, meta):
    return f'<div class="mcard" role="button" aria-label="{esc(title)}, {esc(meta)}">{cover_html}<b>{esc(title)}</b><s>{esc(meta)}</s></div>'


def heading(title, action=None, chevron=False):
    a = ""
    if action:
        a = f'<button class="btn t sm">{esc(action)}</button>'
    if chevron:
        a += ib("chevron_right", f"See all {title}", muted=True)
    return f'<div class="sh2"><h2>{esc(title)}</h2>{a}</div>'


MOODS = ["Chill", "Energy", "Romance", "Focus", "Workout", "Sad"]


def chips(active=None):
    return ('<div class="chips" role="radiogroup" aria-label="Filter Stream by mood">' + "".join(
        f'<button class="chip{" on" if m == active else ""}" role="radio" aria-checked="{str(m == active).lower()}"><span>{ic("check") if m == active else ""}{m}</span></button>' for m in MOODS) + "</div>")


def stream_top(activity=False):
    act = ""
    if activity:
        act = ('<button style="display:flex;align-items:center;gap:10px;width:calc(100% - 32px);margin:0 16px 4px;height:44px;padding:0 12px;border:0;border-radius:10px;background:rgba(255,255,255,.06);color:var(--t1);font:400 13px Inter;text-align:left" aria-label="Saving 3 songs. Open downloads">'
               '<span class="ring" aria-hidden="true"></span><span style="flex:1">Saving 3 songs · importing from Spotify 58%</span>' + ic("chevron_right", size=20, color="var(--t3)") + "</button>")
    return f'<header class="page"><h1>Stream</h1>{ib("info", "About LuvLyrics, update available", badge="1")}</header>' + act


def jump_grid():
    return ('<div class="jgrid">' + jtile("night-drive", "Night drive", "Playlist") + jtile("mira-vale", "Mira Vale", "Artist", "artist")
            + jtile("small-hours", "Small Hours", "Album", progress=55) + jtile("low-tide", "Low Tide", "Song")
            + jtile("daily-mix", "Daily discover", "Mix") + jtile("baarish", "Baarish", "Song") + "</div>")


def made_for_you():
    return ('<div class="shelf">' + mcard(f'<img class="cv" src="{cov("daily-mix")}" alt="">', "Daily discover", "Mix · new for you today")
            + mcard(f'<span class="mos cv" style="width:148px">' + "".join(f'<img src="{cov(c)}" alt="">' for c in ["small-hours", "paper-lanterns", "golden-hour", "static-rain"]) + "</span>",
                    "More like Mira Vale", "Mix · Orla North, Neon Choir")
            + mcard(f'<img class="cv" src="{cov("fade")}" alt="">', "Forgotten favourites", "Mix · on this phone") + "</div>")


def your_artists():
    def a(name, cover=None, tones=None):
        img = f'<img src="{cov(cover)}" alt="">' if cover else f'<span class="gen" style="background:linear-gradient(135deg,{tones[0]},{tones[1]});font-size:36px;align-items:center;justify-content:center">{name[0]}</span>'
        return f'<div class="acard" role="button" aria-label="{esc(name)}, artist">{img}<b>{esc(name)}</b></div>'
    return '<div class="shelf">' + a("Mira Vale", "mira-vale") + a("Harbor Kids", tones=("#1d4e6e", "#4f8db8")) + a("Neon Choir", tones=("#4a1f5c", "#7a2f5c")) + a("Orla North", tones=("#2a3440", "#4a5664")) + "</div>"


def stream_home(state="default", pk=None):
    if state == "loading":
        sk = ('<div class="jgrid">' + "".join('<span class="sk" style="height:56px;border-radius:8px"></span>' for _ in range(6)) + "</div>")
        body = stream_top() + chips() + '<div class="sh2"><span class="sk" style="width:130px;height:16px"></span></div>' + sk + '<div class="sh2"><span class="sk" style="width:110px;height:16px"></span></div>' + skeleton_rows(3)
        return phone(body, shell("stream"), **(pk or {}))
    if state == "scrolled":
        body = (heading("Made for you", chevron=True) + made_for_you() + heading("Your artists", chevron=True) + your_artists()
                + heading("Albums for you", chevron=True) + '<div class="shelf">' + mcard(f'<img class="cv" src="{cov("small-hours")}" alt="">', "Small Hours", "Album · Mira Vale · 2024")
                + mcard(f'<img class="cv" src="{cov("static-rain")}" alt="">', "Static", "Album · Orla North") + mcard(f'<img class="cv" src="{cov("golden-hour")}" alt="">', "Arcade Summer", "Album · Sunny Arcade") + "</div>"
                + '<p class="cap12" style="padding:12px 16px 0">Albums for you comes from YouTube Music</p>')
        return phone('<div style="margin-top:-8px"></div>' + body, shell("stream"), **(pk or {}))
    if state == "mood":
        rows = C.ul([song_row("static", meta="Orla North"), song_row("lanterns", meta="Mira Vale"), song_row("fade", meta="Neon Choir"), song_row("glass", meta="Mira Vale", last=True)])
        body = (stream_top() + chips("Chill") + heading("Your chill mix", "Play all") + rows + heading("Chill playlists", chevron=True)
                + '<div class="shelf">' + mcard(f'<img class="cv" src="{cov("daily-mix")}" alt="">', "Rainy chill", "Playlist · YouTube Music") + mcard(f'<img class="cv" src="{cov("baarish")}" alt="">', "Monsoon calm", "Playlist · YouTube Music") + "</div>")
        return phone(body, shell("stream"), **(pk or {}))
    if state == "cold":
        rows = C.ul([song_row("glass", meta="Mira Vale"), song_row("under", meta="Mira Vale"), song_row("mix", meta="Kabir & The Monsoons", last=True)])
        body = (stream_top() + chips() + '<p class="body" style="padding:12px 16px 0">Pick a mood above, or start with these. Stream learns from what you play.</p>'
                + heading("Quick picks", "Play all") + rows + heading("Albums for you", chevron=True)
                + '<div class="shelf">' + mcard(f'<img class="cv" src="{cov("small-hours")}" alt="">', "Small Hours", "Album · Mira Vale") + mcard(f'<img class="cv" src="{cov("baarish")}" alt="">', "Monsoon Sessions", "Album · Kabir & The Monsoons") + "</div>")
        return phone(body, shell("stream", None), glow_cover=None, **(pk or {}))
    banner = ""
    if state == "error":
        banner = (f'<div class="note" role="status">{ic("cloud_off", size=18, color="var(--t2)")}<span class="x">Can’t reach the catalog. Showing your last page.</span><button class="btn t sm">Try again</button></div>')
    rows = C.ul([song_row("glass", meta="Mira Vale"), song_row("under", meta="Mira Vale"), song_row("mix", meta="Kabir & The Monsoons"), song_row("drive", meta="The Overpass", last=True)])
    body = stream_top(activity=(state == "activity")) + banner + chips() + heading("Jump back in") + jump_grid() + heading("Quick picks", "Play all") + rows
    return phone(body, shell("stream"), **(pk or {}))


R.stream_home = stream_home


def collection_sheet():
    inner = ('<div class="sh">' + mosaic(["small-hours", "paper-lanterns", "golden-hour", "static-rain"], 48, 8) + '<span class="id"><b>More like Mira Vale</b><span class="meta">Mix · 25 songs</span></span>' + ib("close", "Close") + "</div>"
             + '<div class="hr" style="margin:4px 0 4px"></div>' + opt("play_arrow", "Play") + opt("shuffle", "Shuffle") + opt("queue_play_next", "Play next")
             + opt("playlist_add", "Save as a playlist") + opt("person", "Go to Mira Vale"))
    return '<div class="scrim"></div>' + sheet(inner, "Mix actions").replace('class="sheet"', 'class="sheet deep"', 1)


# ------------------------------------------------------------------ boards
def boards():
    B = {}
    B["V5-Library.dc.html"] = ("1 · Library", board("Library", [
        cell("Songs", "Tabs, then songs. Search is an icon at the end of the tab row and searches only the current tab; the global Search tab stays separate. Sort is a quiet trigger; Shuffle left this row (it stays in playlists, albums and the player).", library_songs(),
             proposals=["Filter field and Shuffle row removed; count moves to the sort line"]),
        cell("Search open (typing)", "The tab row becomes a frosted field: back closes search and restores the tabs, × clears. Placeholder and count say it searches Songs.", library_songs("search")),
        cell("Search results", "Keyboard down: results and count stay; opening a song and coming back keeps the query and scroll.", library_songs("results")),
        cell("Sort sheet", "Only the three supported sorts.", library_songs(sheet_html=C.sort_sheet(["Recently added", "Title A–Z", "Artist"], "Recently added", note="Kept for next time."))),
        cell("Sorted A–Z, scrolling", "The letter thumb shows only while dragging.", library_songs("az")),
        cell("Mini player: scrubbing", "Drag or tap the top line of the mini player. A thumb and time preview appear; the row dims so taps there can’t open the player; release commits the seek.", library_songs(mini="scrub")),
        cell("Mini player: length unknown", "Until the player knows the length, the line is dashed and seeking is off (aria-disabled).", library_songs(mini="nodur")),
        cell("Loading", "Placeholders in row shape.", library_songs("loading")),
        cell("Empty library", "One primary (Stream is the start screen and the catalog), one quieter text action. Saving is explicit, and the copy says so.", library_songs("empty")),
        cell("Music access: can ask", "Shown after choosing Add songs from this phone. Allow access opens Android’s own prompt (Music and audio on Android 13+, Files and media before).", library_songs("ask")),
        cell("Music access: settings needed", "Only when Android won’t show its prompt again; neutral wording.", library_songs("settings")),
        cell("Empty library: motion", "Entrance and reduced-motion behaviour of the illustration.", motion_strip()),
    ]), None, None, "r5")
    B["V5-Playlist.dc.html"] = ("2 · Playlist", board("Playlist", [
        cell("Playlist", "Read in order: cover and name, then Play, then songs. Play is a 56 white disc beside a frosted Shuffle, not a slab. Order and Add songs are quiet text above the list. Four songs show above the player.", playlist_detail()),
        cell("Long name", "Two lines, then an ellipsis; the full name is in the top bar on scroll and read by TalkBack.", playlist_detail("long")),
        cell("Opening (loading)", "Name, cover and count come from the Playlists list instantly; downloaded rows render first; online rows fill in without moving anything.", playlist_detail("loading")),
        cell("Some songs didn’t load", "What loaded stays usable; one quiet line explains and retries only the missing part.", playlist_detail("error")),
        cell("Order sheet", "The four orders the app has, with direction (the app already supports and keeps it).", playlist_detail(sheet_html=playlist_sort_sheet())),
        cell("Options (⋮)", "Management lives here.", playlist_detail(sheet_html='<div class="scrim"></div>' + sheet(
            '<div class="sh"><span class="id"><b>Night drive</b><span class="meta">Playlist · 24 songs</span></span>' + ib("close", "Close") + "</div>"
            + opt("add", "Add songs") + opt("reorder", "Edit order") + opt("photo_library", "Cover from your photos") + opt("grid_view", "Use the songs’ covers")
            + '<div class="hr"></div>' + opt("edit", "Rename playlist") + opt("delete", "Delete playlist…", danger=True), "Playlist options"))),
        cell("Edit order", "Drag handles; Done saves.", playlist_detail("edit")),
        cell("Empty", "One clear next step.", playlist_detail("empty")),
        cell("Large text (200%)", "Title wraps to two lines, rows grow, Play and Shuffle keep their size.", playlist_detail(pk={"w": 360, "h": 780, "cls": "x2"}), w=360),
    ]), None, None, "r5")
    B["V5-NowPlaying.dc.html"] = ("4 · Now playing", board("Now playing", [
        cell("Playing", "No volume row; depth from the cover. One frosted play disc.", P.now_playing("playing")),
        cell("Loading", "Only the disc changes (spinner, aria-busy). Reduce Motion: a still ring.", P.now_playing("loading"),
             gaps=["show the buffering state the player already reports (playWhenReady vs isPlaying)"]),
        cell("Couldn’t play", "The disc becomes the one retry. An info control sits in the cover’s top-right corner only while there is an error.", P.now_playing("error"),
             gaps=["surface MainPlayer.onPlaybackError (exists, never shown)"]),
        cell("Couldn’t play: details", "Tap info: the cover softens in place and explains; the control becomes ×. Back closes it first. Nothing else moves; Try again here is a quiet text action, the disc stays the main retry.", P.now_playing("error_detail")),
        cell("Lyrics", "Lyrics take the screen; cover thumb and lit button return.", P.now_playing_lyrics()),
        cell("Up next (half)", "Cover deck on top, calm glass queue below.", P.now_playing_upnext()),
        cell("Up next (pulled up)", "The whole queue.", P.upnext_full()),
        cell("Player ⋮", "Song actions, then player tools.", P.now_playing(sheet_html=P.player_menu())),
    ]), None, None, "r5")
    B["V5-Stream.dc.html"] = ("Stream", board("Stream", [
        cell("Stream", "Three things above the fold: mood filters, Jump back in (six tiles, typed), Quick picks (four songs, the page’s one Play all). Rows are songs, squares are collections, circles are artists.", stream_home(),
             proposals=["Stream’s search field, Downloads and Import trays leave the top; Jump back in replaces the Library deck"]),
        cell("Further down", "One “Made for you” shelf replaces Daily discover, every “More like X” shelf and Forgotten favourites. Headings carry a chevron, not “See all”.", stream_home("scrolled")),
        cell("Mood chosen", "A chip filters the page: your mix for that mood first, then its playlists. Tap it again to clear.", stream_home("mood")),
        cell("Something running", "Downloads and imports collapse into one status line, only while they run.", stream_home("activity")),
        cell("Long press a mix", "Long press never acts silently: it opens the item’s actions.", _ov(stream_home("scrolled"), collection_sheet()), proposals=["Today a long press on a cover silently queues it next"]),
        cell("First run (no history)", "No Jump back in until there is history; moods and Quick picks from your languages.", stream_home("cold")),
        cell("First load", "Only when there is no cached page.", stream_home("loading")),
        cell("Catalog unreachable", "The cached page stays; one quiet line retries.", stream_home("error")),
        cell("Large text (200%)", "The Jump back in grid becomes one column; shelves keep their card size.", stream_home(pk={"w": 360, "h": 780, "cls": "x2"}), w=360),
    ]), None, None, "r5all")
    return B


def _ov(phone_html, overlay):
    i = phone_html.rfind('<div class="sb"')
    return phone_html[:i] + overlay + phone_html[i:]
