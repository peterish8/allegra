"""Round 7: the owner's consolidated design-revision brief (2026-11-06). Design preview only: nothing here is app code,
and none of it is implemented until the owner approves the preview.

    python v7_revision.py            # writes project/V7-*.dc.html and prints their canvas sizes

Built on the shipped V6 kit (round 6 + V6 finish), then R7_CSS on top, so the new boards look like the rest of the
canvas and differ only where the brief asks:

  1  mood chips: full capsules, subtle frost          6  voice search: listening lives with the search field
  2  contextual menus: one identity-first sheet        7  consistency and accessibility
  3  navigation: foreground-only active tab            8  one frosted mini player + navigation surface
  4  Play / Shuffle: capsules with unequal weight      9  compact Stream rows, whole-row taps
  5  Library: one background across all four tabs
"""
import os
import re

import v5_kit as K
import v5_core as C
import v5_rest as R
import v5_round6 as V  # patches the kit (seek band, hierarchy)
import v6_finish as F  # noqa: F401  (Ionicons, V6 layout)
import v6_icons
from v5_kit import SONGS, TONES, art, cell, cov, esc, mosaic, phone

# Glyphs this round needs that the shared map lacks (all present in the shipped Ionicons font).
v6_icons.NAMES.update(album="disc", mic_off="mic-off", stop="stop", save="arrow-down-circle", saved="checkmark-circle",
                      add_circle="add-circle", play_next="play-skip-forward")


def ic(name, fill=False, size=None, color=None, cls=""):
    return v6_icons.ic(name, fill, size, color, cls)


def ib(icon, label, fill=False, muted=False, badge=None, size=None, pressed=None):
    return K.ib(icon, label, fill, muted, badge, size, pressed)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "project")
# The app's Ionicons font, uploaded to the design canvas's asset store (assets/Ionicons.ttf in this folder).
IONICONS_URL = "/_blob/a251de911c30c28097a2303b876fbe7a"

R7_CSS = """
/* ---- R7: capsules. Radius = half the height; shape is shared, weight is not. ---- */
.btn{border-radius:999px}
.btn.p{background:var(--t1);color:var(--base)}
.btn.s{background:rgba(255,255,255,.10);color:var(--t1);backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.hit{display:flex;align-items:center;justify-content:center;min-height:48px;flex-shrink:0;border:0;background:none;padding:0}
.btn.cmp{height:40px;padding:0 16px;font-size:14px;gap:6px}
.btn.cmp .ms{font-size:18px}
.acts7{display:flex;align-items:center;gap:8px;padding:12px 16px 0}
.acts7 .btn.p{min-width:140px}
.acts7 .sp{flex:1}

/* ---- 1 · mood chips ---- */
.chip>span{height:34px;padding:0 14px;border-radius:17px;background:rgba(255,255,255,.09);color:var(--t1);font:500 13px Inter;
    backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.chip.on>span{background:var(--t1);color:var(--base);font-weight:600;padding-left:10px;box-shadow:none}
.chip.pr>span{background:rgba(255,255,255,.16);transform:scale(.97)}
.chip.fx>span{outline:2px solid rgba(255,255,255,.9);outline-offset:3px}

/* ---- 3 · navigation: the active tab is its foreground only ---- */
.nv .ind{background:none!important;width:48px;height:28px}
.nv{color:rgba(244,244,245,.56);font-weight:500}
.nv.on{color:var(--t1);font-weight:600}
.nv.fx{outline:2px solid rgba(255,255,255,.9);outline-offset:-4px;border-radius:14px}

/* ---- 8 · one frosted bottom surface: real content shows through a soft blur, a hint of the cover tints it ---- */
.shell{box-shadow:none;backdrop-filter:blur(24px) saturate(1.25);-webkit-backdrop-filter:blur(24px) saturate(1.25)}
.shell .frost{background:transparent}
.shell .frost img{opacity:.16;filter:blur(40px) saturate(1.1)}
.shell .frost i{background:rgba(13,15,19,.74)}
.shell .frost.solid{background:#16181D}
.shell .nav{border-top:0}
.sband{height:16px}
.mini,.mini .id{height:48px}
.mini .art{width:40px;height:40px}
.nav{height:72px;padding-bottom:16px}
.scr{padding-bottom:150px}

/* ---- 9 · compact Stream rows, the whole main area is one target ---- */
.row7{display:flex;align-items:center;height:56px;padding:0 4px 0 8px;flex-shrink:0}
.rmain{flex:1;min-width:0;height:56px;display:flex;align-items:center;gap:12px;padding:0 8px;border:0;background:none;color:inherit;text-align:left;border-radius:12px}
.rmain img{width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0}
.rmain .tx{flex:1;min-width:0;display:flex;flex-direction:column}
.rmain b{font:400 15px/20px Inter;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rmain s{text-decoration:none;font:400 13px/18px Inter;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row7 .ib{width:48px;height:56px}
.row7.pm .rmain{background:rgba(255,255,255,.07)}
.row7 .ib.pr::before{content:'';position:absolute;inset:6px 4px;border-radius:22px;background:rgba(255,255,255,.1)}
.row7.on b{font-weight:600}
/* every song list, one row: 56 tall, 44 cover, title and artist one line each with an ellipsis */
.row{height:56px;gap:12px}
.row .art,.row .aw,.row .gen{width:44px;height:44px}
/* every list cover has the same small rounded corners (artists stay round) */
.art,.row .art,.mini .art,.rmain img{border-radius:6px}
.row .art.c,.art.c{border-radius:50%}
.jt img{width:48px;height:48px;margin-left:4px;border-radius:6px}
.jt img.c{width:40px;height:40px;border-radius:20px}
.rt{height:56px}
.rt b,.rt s,.rt s em{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt s{display:block}
.hitmap .rmain{outline:1.5px dashed #6FD0FF;outline-offset:-2px}
.hitmap .row7 .ib{outline:1.5px dashed #F2C14E;outline-offset:-3px}
.x2 .row7{height:auto;min-height:72px;padding-top:6px;padding-bottom:6px}
.x2 .rmain{height:auto;min-height:72px}
.x2 .rmain b{font-size:28px;line-height:34px}
.x2 .rmain s{font-size:24px;line-height:30px}
.x2 .row7 .ib{height:72px}

/* ---- 2 · contextual menus: one identity-first sheet ---- */
.m7{position:absolute;left:0;right:0;bottom:0;z-index:60;border-radius:24px 24px 0 0;padding:8px 0 28px;overflow:hidden;
    background:rgba(16,18,22,.94);backdrop-filter:blur(30px) saturate(1.3);-webkit-backdrop-filter:blur(30px) saturate(1.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.m7 .tint{position:absolute;left:0;right:0;top:0;height:140px;opacity:.35;pointer-events:none}
.m7>*{position:relative}
.m7 .gr{display:block;margin:0 auto 6px}
.m7 .mh{display:flex;align-items:center;gap:14px;padding:6px 4px 4px 20px}
.m7 .mh .id{flex:1;min-width:0;display:flex;flex-direction:column}
.m7 .mh b{font:600 17px/22px Inter;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m7 .mh .meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m7 .opt{min-height:52px;padding:0 20px;gap:18px}
.m7 .opt .chev{margin-left:auto;color:var(--t3)}
.m7 .hr{margin:6px 20px}
.m7 .acts7{padding:10px 20px 6px}

/* ---- 6 · voice search lives with the field ---- */
.vfield{margin:4px 16px 0;border-radius:24px;background:rgba(255,255,255,.08);backdrop-filter:blur(24px) saturate(1.3);-webkit-backdrop-filter:blur(24px) saturate(1.3);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.06);overflow:hidden;flex-shrink:0}
.vfield .fr{display:flex;align-items:center;gap:8px;height:48px;padding:0 4px 0 14px;color:var(--t2)}
.vfield .fr .v{flex:1;min-width:0;font:400 15px Inter;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vfield .fr .v.ph-t{color:var(--t3)}
.vfield .live{padding:4px 16px 14px}
.vfield .st{display:flex;align-items:center;gap:10px;font:600 14px/20px Inter}
.vfield .st small{display:block;font:400 13px/18px Inter;color:var(--t2)}
.vfield .tr{font:400 20px/27px Inter;margin-top:8px;color:var(--t1)}
.vfield .tr i{font-style:normal;color:var(--t3)}
.vfield .row2{display:flex;align-items:center;gap:8px;margin-top:12px}
.wave{display:flex;align-items:center;gap:3px;height:28px;flex-shrink:0}
.wave span{width:3px;border-radius:2px;background:var(--t1)}
.wave.still span{height:4px!important;opacity:.6}
.micon{width:40px;height:40px;border-radius:20px;display:flex;align-items:center;justify-content:center;background:var(--t1);color:var(--base);flex-shrink:0}
.vnote{display:flex;gap:12px;align-items:flex-start;padding:4px 16px 14px}
.vnote p{font:400 14px/20px Inter;color:var(--t2)}
.vnote b{display:block;font:600 15px/20px Inter;color:var(--t1);margin-bottom:2px}
.dim{opacity:.32}
.topmatch{display:flex;align-items:center;gap:14px;margin:12px 16px 0;padding:12px;border-radius:16px;background:rgba(255,255,255,.06)}
.topmatch b{display:block;font:600 16px/21px Inter}

/* ---- 4 / 7 helpers ---- */
.spec{padding:20px 24px;display:flex;flex-direction:column;gap:18px;width:390px;border-radius:24px;background:#121418;box-shadow:0 0 0 1px rgba(255,255,255,.08)}
.spec h3{font:600 15px/20px Inter}
.spec p{font:400 13px/19px Inter;color:var(--t2)}
.spec .r{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.lightbg{position:relative;border-radius:20px;overflow:hidden;padding:18px 0}
.lightbg img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.lightbg .chips{position:relative}
"""
K.CSS += R7_CSS


def ov(phone_html, overlay):
    i = phone_html.rfind('<div class="sb"')
    return phone_html[:i] + overlay + phone_html[i:]


# ------------------------------------------------------------------ shared pieces
MOODS = ["Chill", "Energy", "Romance", "Focus", "Workout"]


def chips7(active=None, pressed=None, focus=None):
    out = []
    for m in MOODS:
        on = m == active
        cls = "chip" + (" on" if on else "") + (" pr" if m == pressed else "") + (" fx" if m == focus else "")
        out.append(f'<button class="{cls}" role="radio" aria-checked="{str(on).lower()}"><span>{ic("check") if on else ""}{m}</span></button>')
    return '<div class="chips" role="radiogroup" aria-label="Filter Stream by mood">' + "".join(out) + "</div>"


def shell7(active="stream", mini="playing", song="low", solid=False, focus=None):
    html = K.shell(active, mini, song, solid=solid)
    if focus:
        labels = {"stream": "Stream", "luvs": "Luvs", "library": "Library", "search": "Search", "you": "You"}
        html = re.sub(rf'<button class="nv"><span class="ind">(.*?)</span>{labels[focus]}</button>',
                      lambda m: f'<button class="nv fx"><span class="ind">{m.group(1)}</span>{labels[focus]}</button>', html, count=1)
    return html


def srow(key, dl="save", pressed=None, playing=False, title=None, artist=None):
    """Item 9: a Stream song row. One main target (cover, title, artist, blank space), then Download, then ⋮."""
    t, a, _, c, saved = SONGS[key]
    t, a = title or t, artist or a
    d_icon, d_label = ("save", f"Save {t}") if dl == "save" else ("saved", f"{t} is saved")
    cls = "row7" + (" pm" if pressed == "main" else "") + (" on" if playing else "")
    dl_btn = (f'<button class="ib m{" pr" if pressed == "dl" else ""}" aria-label="{esc(d_label)}">{ic(d_icon, dl != "save", size=22)}</button>')
    more = f'<button class="ib m{" pr" if pressed == "more" else ""}" aria-label="More actions for {esc(t)}">{ic("more_vert", size=20)}</button>'
    return (f'<li class="{cls}"><button class="rmain" aria-label="{esc(t)}, {esc(a)}{", now playing" if playing else ""}">'
            f'<img src="{cov(c)}" alt=""><span class="tx"><b>{esc(t)}</b><s>{esc(a)}</s></span></button>{dl_btn}{more}</li>')


def quick_picks(pressed=None, long=False):
    if long:
        rows = [srow("baarish", "saved"), srow("glass" if "glass" in SONGS else "golden", pressed=pressed,
                                                 title="Every Living Breathing Moment (From the Original Motion Picture)", artist="Grant Steller, The Hollow Choir, Rue Paterlini"),
                srow("static"), srow("drive", playing=True)]
    else:
        rows = [srow("low", playing=True), srow("small", "saved", pressed=pressed), srow("static"), srow("drive")]
    return V.heading("Quick picks", "Play all") + "<ul>" + "".join(rows) + "</ul>"


def stream_page(pressed=None, long=False, active=None, chip_pressed=None, chip_focus=None, solid=False, song="low", pk=None):
    body = (V.stream_top() + chips7(active, chip_pressed, chip_focus) + V.heading("Jump back in") + V.jump_grid()
            + quick_picks(pressed, long) + V.heading("Made for you", chevron=True) + V.made_for_you())
    return phone(body, shell7("stream", song=song, solid=solid), glow_cover=SONGS[song][3], **(pk or {}))


def btn(label, kind="p", icon=None, extra=""):
    return K.btn(label, kind, icon, kind == "p", extra)


def cbtn(label, kind="p", icon=None):
    """A compact capsule (40 visible) inside a 48dp target."""
    return f'<button class="hit" aria-label="{esc(label)}"><span class="btn {kind} cmp">{ic(icon, kind == "p") if icon else ""}{esc(label)}</span></button>'


def play_shuffle(primary="Play", compact_label="Shuffle"):
    """Item 4: Play is the one filled capsule; Shuffle is a smaller frosted capsule inside a 48dp target."""
    return (f'<div class="acts7">{btn(primary, "p", "play_arrow")}'
            f'<button class="hit" aria-label="{esc(compact_label)}"><span class="btn s cmp">{ic("shuffle")}{esc(compact_label)}</span></button>'
            f'<span class="sp"></span></div>')


# ------------------------------------------------------------------ 2 · menus
def menu_sheet(kind="mix"):
    if kind == "mix":
        a, b = TONES["small-hours"]
        head = (f'<div class="mh">{mosaic(["small-hours", "paper-lanterns", "golden-hour", "static-rain"], 56, 10)}'
                f'<div class="id"><b>More like Mira Vale</b><span class="meta">Mix · 25 songs · Orla North, Neon Choir</span></div>{ib("close", "Close")}</div>')
        acts = play_shuffle().replace('class="acts7"', 'class="acts7" style="padding:12px 20px 6px"')
        rows = (K.opt("queue_play_next", "Play next") + K.opt("playlist_add", "Save as a playlist")
                + '<div class="hr"></div>'
                + K.opt("person", "Go to Mira Vale", trailing=ic("chevron_right", cls="chev")))
        label = "More like Mira Vale, mix actions"
    else:
        a, b = TONES["paper-lanterns"]
        head = (f'<div class="mh">{art("paper-lanterns", 56, 8)}<div class="id"><b>Paper Lanterns</b><span class="meta">Song · Mira Vale · 3:33</span></div>{ib("close", "Close")}</div>')
        acts = ""
        rows = (K.opt("queue_play_next", "Play next") + K.opt("queue_music", "Add to queue") + K.opt("playlist_add", "Add to a playlist…")
                + K.opt("download", "Save to library")
                + '<div class="hr"></div>'
                + K.opt("radio", "Start radio") + K.opt("share", "Share")
                + '<div class="hr"></div>'
                + K.opt("person", "Go to Mira Vale", trailing=ic("chevron_right", cls="chev"))
                + K.opt("album", "Go to the album", trailing=ic("chevron_right", cls="chev")))
        label = "Paper Lanterns, song actions"
    tint = f'<div class="tint" aria-hidden="true" style="background:radial-gradient(120% 100% at 20% 0%,{a},transparent 70%),radial-gradient(90% 90% at 90% 0%,{b},transparent 70%)"></div>'
    return ('<div class="scrim"></div>'
            + f'<section class="m7" role="dialog" aria-modal="true" aria-label="{esc(label)}">{tint}<div class="gr" aria-hidden="true"></div>{head}{acts}{rows}</section>')


def stream_scrolled(pressed_card=False):
    body = ('<div style="margin-top:-8px"></div>' + V.heading("Made for you", chevron=True) + V.made_for_you()
            + V.heading("Your artists", chevron=True) + V.your_artists() + quick_picks())
    return phone(body, shell7("stream"))


# ------------------------------------------------------------------ 4 · artist and equivalents
def artist7(x2=False):
    html = R.artist_page()
    html = re.sub(r'<div class="btns" style="margin-top:12px">.*?</div><div style="display:flex;padding:4px 4px 0 4px">.*?</div>',
                  lambda _m: (play_shuffle() + '<div style="display:flex;padding:2px 4px 0 4px">' + K.btn("Radio", "t", "radio")
                              + K.btn("Follow", "t", "person_add") + "</div>"), html, count=1, flags=re.S)
    if x2:
        html = html.replace('class="ph"', 'class="ph x2" style="width:360px;height:780px"', 1)
    return html


def playlist7():
    html = V.playlist_detail()
    html = re.sub(r'<button class="gshuf".*?</button>', "", html, count=1, flags=re.S)
    html = re.sub(r'<button class="pplay".*?</button>',
                  lambda _m: btn("Play", "p", "play_arrow") + f'<button class="hit" aria-label="Shuffle"><span class="btn s cmp">{ic("shuffle")}Shuffle</span></button>',
                  html, count=1, flags=re.S)
    return html.replace('class="pact"', 'class="pact" style="gap:8px"', 1)


# ------------------------------------------------------------------ 5 · library
def lib(tab):
    if tab == "songs":
        return V.library_songs()
    if tab == "playlists":
        return R.lib_playlists()
    if tab == "artists":
        return R.lib_artists()
    if tab == "albums":
        return R.lib_albums()
    if tab == "playlists-empty":
        return R.lib_playlists(empty=True)
    raise ValueError(tab)


# ------------------------------------------------------------------ 6 · voice search
def _wave(still=False, heights=(8, 16, 26, 14, 22, 10, 18, 12, 6)):
    return f'<span class="wave{" still" if still else ""}" aria-hidden="true">' + "".join(f'<span style="height:{h}px"></span>' for h in heights) + "</span>"


def voice_screen(state):
    head = '<header class="page"><h1>Search</h1></header>'
    recent = ('<div class="sec"><h2>Recent searches</h2><button class="btn t sm">Clear</button></div><ul>'
              + C.recent_row("song", "Paper Lanterns", "Song · Mira Vale", "paper-lanterns")
              + C.recent_row("artist", "Mira Vale", "Artist", "mira-vale")
              + C.recent_row("query", "rainy morning hindi", "Search", last=True) + "</ul>")
    mic = ib("mic", "Search by voice. Tap to start, or hold and speak", muted=True)
    stop = f'<button class="hit" aria-label="Stop listening and search"><span class="micon">{ic("stop", True, size=18)}</span></button>'
    cancel = K.btn("Cancel", "t", extra="sm")

    def field(value, ph=False, live="", trailing=None):
        v = f'<span class="v{" ph-t" if ph else ""}">{esc(value)}</span>'
        return (f'<div class="vfield" role="search"><div class="fr">{ic("search", size=20)}{v}{trailing if trailing is not None else mic}</div>{live}</div>')

    if state == "idle":
        body = head + field("Songs, artists, playlists", ph=True) + recent
    elif state in ("hold", "tap", "still"):
        tap = state == "tap"
        sub = "Tap stop when you’re done" if tap else "Release to search"
        live = (f'<div class="live" role="status" aria-live="polite"><div class="st">{_wave(still=state == "still")}<span>Listening<small>{sub}</small></span></div>'
                f'<p class="tr">mira vale small <i>hours…</i></p><div class="row2">{cancel}<span style="flex:1"></span>{stop if tap else ""}</div></div>')
        body = head + field("Listening…", ph=True, live=live, trailing=ib("close", "Cancel voice search", muted=True)) + f'<div class="dim">{recent}</div>'
    elif state == "processing":
        live = (f'<div class="live" role="status" aria-live="polite"><div class="st"><span class="ring lg" aria-hidden="true"></span><span>Searching<small>for what you said</small></span></div>'
                f'<p class="tr">mira vale small hours</p><div class="row2">{cancel}</div></div>')
        body = head + field("mira vale small hours", live=live, trailing="") + f'<div class="dim">{recent}</div>'
    elif state == "results":
        top = (f'<div class="topmatch" role="group" aria-label="Top match">{art("small-hours", 56, 8)}<div style="flex:1;min-width:0"><b>Small Hours</b>'
               f'<span class="meta">Song · Mira Vale · top match</span></div>{cbtn("Play", "p", "play_arrow")}</div>')
        body = (head + field("mira vale small hours", trailing=ib("close", "Clear search", muted=True, size=20))
                + C.scopes("All") + top + '<p class="lbl" style="margin-top:12px">Songs</p><ul>' + srow("lanterns") + srow("golden") + srow("static") + "</ul>")
    elif state == "nomatch":
        live = (f'<div class="vnote" role="status">{ic("search", color="var(--t2)")}<p><b>No match for “mira vail smol ours”</b>'
                f'Try saying the artist and song name again.</p></div><div class="row2" style="padding:0 16px 14px;display:flex;gap:8px">'
                f'{cbtn("Try again", "p", "mic")}{K.btn("Type instead", "t", extra="sm")}</div>')
        body = head + field("mira vail smol ours", live=live, trailing=ib("close", "Clear search", muted=True, size=20)) + recent
    elif state == "unheard":
        live = (f'<div class="vnote" role="alert">{ic("mic_off", color="var(--t2)")}<p><b>Didn’t catch that</b>'
                f'It was too quiet or the connection dropped. Nothing was searched.</p></div><div class="row2" style="padding:0 16px 14px;display:flex;gap:8px">'
                f'{cbtn("Try again", "p", "mic")}{K.btn("Cancel", "t", extra="sm")}</div>')
        body = head + field("Songs, artists, playlists", ph=True, live=live) + recent
    elif state == "permission":
        live = (f'<div class="vnote" role="alert">{ic("mic", color="var(--t2)")}<p><b>Allow the microphone to search by voice</b>'
                f'LuvLyrics only listens while this field says Listening. Typing always works.</p></div><div class="row2" style="padding:0 16px 14px;display:flex;gap:8px">'
                f'{cbtn("Allow microphone", "p")}{K.btn("Not now", "t", extra="sm")}</div>')
        body = head + field("Songs, artists, playlists", ph=True, live=live) + recent
    elif state == "settings":
        live = (f'<div class="vnote" role="alert">{ic("mic_off", color="var(--t2)")}<p><b>The microphone is off for LuvLyrics</b>'
                f'Turn it on in Android settings, then come back. Typing always works.</p></div><div class="row2" style="padding:0 16px 14px;display:flex;gap:8px">'
                f'{cbtn("Open settings", "s")}{K.btn("Not now", "t", extra="sm")}</div>')
        body = head + field("Songs, artists, playlists", ph=True, live=live) + recent
    else:
        raise ValueError(state)
    return phone(body, shell7("search"))


# ------------------------------------------------------------------ 7 · component specification
def spec_card():
    return (f'<div class="spec"><h3>Action language</h3>'
            f'<div class="r">{btn("Play", "p", "play_arrow")}{cbtn("Shuffle", "s", "shuffle")}{K.btn("Follow", "t", "person_add")}</div>'
            f'<p>One filled white capsule per screen (primary). Secondary is a smaller frosted capsule (40 visible, 48 touch). Tertiary is text. '
            f'Shape is shared, weight is not. Destructive keeps its own red treatment and is never the default.</p>'
            f'<h3>Mood and filter chips</h3>{chips7("Chill", pressed="Romance").replace(chr(34) + "chips" + chr(34), chr(34) + "chips" + chr(34) + " style=" + chr(34) + "padding:0" + chr(34), 1)}'
            f'<p>34 visible, radius 17, frosted 9% white with a 6% top light; selected is solid white with a check (shape and text, not colour alone). '
            f'Pressed lightens and sinks 3%. Keyboard focus is a separate 2px ring offset 3px.</p>'
            f'<h3>Navigation</h3><p>Active = filled icon + white 600 label. Inactive = outline icon + 56% white. No pill, tile, outline or background. '
            f'Keyboard focus draws its own ring and never looks like selection.</p>'
            f'<h3>Surfaces</h3><p>Page #0B0D10 with the cover glow. Frost = backdrop blur 20–30 + dark tint 74–94% + ≤16% cover hint. '
            f'Opaque fallback (Reduce Transparency, Battery Saver, low-end): #16181D for the shell, #121418 for sheets. No rims; a 5–6% top light at most.</p>'
            f'<h3>Rows (every song list)</h3><p>One row everywhere: Stream, Search, Library, playlists, artist and album pages. 56 tall, 44 cover, '
            f'exactly two lines: the title on one line and the artist on one line, each ending in “…” when long. Never wraps. Every list cover has the same '
            f'small 6dp rounded corners (rows, Jump back in tiles, the mini player, Up next); artists stay round. Main area = one target to the '
            f'trailing controls; Download and ⋮ are their own 48×56 targets. Large text: rows grow to fit the two lines, controls keep their targets.</p>'
            f'<h3>Motion</h3><p>Sheets rise on the open spring; chips and capsules sink 3% on press. Reduce Motion: fades only, still waveform, no scale.</p></div>')


# ------------------------------------------------------------------ boards
def w_for(n, last_w=390):
    return 64 + (n - 1) * 430 + last_w


def build():
    B = {}
    light = (f'<div class="lightbg"><img src="{cov("golden-hour")}" alt="">{chips7("Energy")}</div>'
             f'<div class="lightbg" style="margin-top:12px"><img src="{cov("low-tide")}" alt="">{chips7(None, pressed="Focus")}</div>')
    B["V7-1-Chips.dc.html"] = ("R7 · 1 Mood chips", [
        cell("1 · Stream, nothing chosen", "Full capsules (radius = half height), subtle frost over the cover glow, white labels.", stream_page()),
        cell("1 · Chill chosen", "Selected is solid white with a check: obvious by shape and text, not by a bright border.", stream_page(active="Chill")),
        cell("1 · Pressed and keyboard focus", "Pressed (Romance) lightens and sinks 3%. Keyboard focus (Focus) is a separate ring; it never looks like selection.", stream_page(chip_pressed="Romance", chip_focus="Focus")),
        cell("1 · Over light and dark artwork", "The same chips over a bright and a dark cover: labels stay readable because the frost carries a dark tint.",
             f'<div style="width:390px;padding:24px 0;border-radius:24px;background:#0B0D10">{light}</div>'),
    ])
    B["V7-2-Menus.dc.html"] = ("R7 · 2 Action menus", [
        cell("2 · Mix actions (long press or ⋮)", "Bottom sheet: identity first (mosaic, name, what it is), then the mix’s one primary pair (Play, smaller Shuffle), then grouped "
             "secondary actions, then navigation with a chevron. Dismiss: drag down, tap the dimmed page, Back, or ×.", ov(stream_scrolled(), menu_sheet("mix"))),
        cell("2 · Song actions (same pattern)", "Same surface, header and grouping. A song has no Play pair here: tapping the row already plays it.", ov(stream_page(), menu_sheet("song"))),
        cell("2 · Why a sheet, not an anchored menu", "Five to nine actions with an identity header: an anchored popover would cover the card it came from, clip near "
             "the screen edges and sit out of thumb reach at the top. The sheet rises from the thumb, keeps the page visible above it, and matches Android’s "
             "modal bottom sheet. Rows 52 tall, icons in one 24dp column at x=20; 94% dark frost with a faint cover tint; no rim.",
             f'<div class="spec"><h3>Preserved actions</h3><p>Mix: Play · Shuffle · Play next · Save as a playlist · Go to the artist (only when the mix has one).</p>'
             f'<p>Song: Play next · Add to queue · Add to a playlist · Save to library · Start radio · Share · Go to artist · Go to album (rows a song can’t use are left out, as today).</p>'
             f'<h3>Dismissal</h3><p>Drag down from anywhere on the sheet (a scrolled list scrolls first), tap the dimmed page, Back, or ×. Focus returns to the control that opened it.</p></div>'),
    ])
    nav_cells = [cell(f"3 · {name} selected", "Brighter filled icon and label; the rest muted. No pill, tile, outline or background.",
                      phone(V.heading(name) + '<p class="body" style="padding:0 16px">Page content</p>', shell7(key)))
                 for key, name in (("stream", "Stream"), ("luvs", "Luvs"), ("library", "Library"), ("search", "Search"), ("you", "You"))]
    nav_cells.append(cell("3 · Keyboard focus on Library while Stream is selected", "Focus and selection are separate: a focus ring appears only for keyboard navigation.",
                          phone(V.heading("Stream") + '<p class="body" style="padding:0 16px">Page content</p>', shell7("stream", focus="library"))))
    B["V7-3-Navigation.dc.html"] = ("R7 · 3 Navigation", nav_cells)
    B["V7-4-Actions.dc.html"] = ("R7 · 4 Play and Shuffle", [
        cell("4 · Artist", "Play is the one filled white capsule and the first thing the eye lands on. Shuffle is a smaller frosted capsule (40 visible, 48 touch). Radio and Follow stay text.", artist7()),
        cell("4 · Playlist (same language)", "The playlist’s Play disc and round Shuffle become the same pair, so equivalent screens behave alike.", playlist7()),
        cell("4 · 360 · 200% text", "Labels grow; Play keeps the lead, Shuffle stays compact and reachable.", artist7(x2=True), w=360),
    ])
    B["V7-5-Library.dc.html"] = ("R7 · 5 Library background", [
        cell("5 · Songs", "The cover glow and page colour run behind the tabs and the list.", lib("songs")),
        cell("5 · Playlists", "Same background as the other tabs. Cause found in the app: the embedded Playlists view wraps itself in its own screen with an opaque "
             "darker background (PlaylistsScreen.tsx:132, :221) and draws a second glow. Planned fix: when embedded, render a transparent container.", lib("playlists")),
        cell("5 · Artists", "Unchanged background.", lib("artists")),
        cell("5 · Albums", "Unchanged background.", lib("albums")),
        cell("5 · Playlists, empty", "Empty and loading states keep the same background too.", lib("playlists-empty")),
    ])
    B["V7-6-Voice.dc.html"] = ("R7 · 6 Voice search", [
        cell("6 · Ready", "The mic sits in the search field. Tap starts listening; holding listens until release.", voice_screen("idle")),
        cell("6 · Listening (held)", "Listening opens inside the field: status, live waveform and transcript together, under the thumb’s target. Copy matches the gesture: “Release to search”. Cancel is always there. The shell and player stay put.", voice_screen("hold")),
        cell("6 · Listening (tap mode)", "A tap started it, so it says “Tap stop when you’re done” and shows a Stop button (searches what was heard).", voice_screen("tap")),
        cell("6 · Reduce Motion", "The waveform holds still; status text carries the state. TalkBack hears “Listening” once, then the transcript politely.", voice_screen("still")),
        cell("6 · Processing", "The transcript is final; a ring shows the search is running. Cancel still works.", voice_screen("processing")),
        cell("6 · Results", "The field keeps what was said, so it can be edited. The top match leads with its own Play; the rest are normal results.", voice_screen("results")),
        cell("6 · No match", "Says what it heard. Try again listens again; Type instead focuses the field with the text.", voice_screen("nomatch")),
        cell("6 · Didn’t catch that", "Recognition failed; nothing was searched.", voice_screen("unheard")),
        cell("6 · Microphone permission", "Asked in context the first time. Allow opens Android’s own prompt.", voice_screen("permission")),
        cell("6 · Microphone blocked", "When Android won’t ask again: one way to settings; typing still works.", voice_screen("settings")),
    ])
    B["V7-8-Shell.dc.html"] = ("R7 · 8 Bottom surface", [
        cell("8 · Over scrolling content", "Mini player and nav are one frosted surface: rows scrolling underneath show faintly through a soft blur; a 16% hint of the cover tints it. No divider between them, no rim. The thin top line still drags to seek.", stream_scrolled()),
        cell("8 · Warm cover", "The tint follows the cover, kept faint and desaturated.", stream_page(song="golden")),
        cell("8 · Cool cover", "Same material with a blue cover.", stream_page(song="static")),
        cell("8 · Reduce Transparency / Battery Saver", "Opaque fallback #16181D, same layout and contrast.", stream_page(solid=True)),
        cell("8 · Paused and loading", "Playback states keep the same surface; only the transport glyph changes.",
             phone(V.heading("Library") + "<ul>" + srow("small") + srow("static") + srow("drive") + "</ul>", K.shell("library", "buffering"))),
    ])
    B["V7-9-Rows.dc.html"] = ("R7 · 9 Stream rows", [
        cell("9 · Quick picks, compact", "56 rows (was 64+), 44 cover, one-line title and one-line artist with an ellipsis. Download and ⋮ are their own 48×56 targets, flush, no dead gaps. The same row size is used in every song list (see 5 and 6).", stream_page()),
        cell("9 · Same row in Library", "Library songs use the identical row: same height, cover and two single lines.", lib("songs")),
        cell("9 · Long title and artists", "Neither line wraps; trailing controls keep their place.", stream_page(long=True)),
        cell("9 · Pressed main area", "The whole main area lights to its edge (cover, text and blank space), so its extent is clear.", stream_page(pressed="main")),
        cell("9 · Pressed Download", "Only the control lights; the row does not.", stream_page(pressed="dl")),
        cell("9 · Hit areas (spec)", "Blue: the main target (plays the song once). Yellow: Download and ⋮ (their own actions only).",
             stream_page().replace('<div class="scr">', '<div class="scr hitmap">', 1)),
        cell("9 · 360 · 200% text", "Rows grow to fit; text still one line each with ellipsis; controls keep 48 wide.", stream_page(pk={"w": 360, "h": 780, "cls": "x2"}), w=360),
    ])
    B["V7-7-Consistency.dc.html"] = ("R7 · 7 Consistency", [
        cell("7 · The rules in one place", "Shared by every board on this page.", spec_card()),
        cell("7 · Small screen (360 × 640)", "Chips scroll sideways; rows, shell and actions keep their targets.", stream_page(pk={"w": 360, "h": 640, "cls": "compact"}), w=360),
        cell("7 · Overlay near the shell", "Toasts and sheets clear the shell; nothing hides under it.",
             ov(stream_page(), K.toast("Saving “Small Hours” to your library", "Undo", bottom=150))),
    ])
    out = {}
    for name, (title, cells) in B.items():
        html = K.board(title, cells)
        html = html.replace("Material Symbols Rounded", "Ionicons").replace("url(assets/Ionicons.ttf)", f"url({IONICONS_URL})")
        n = len(cells)
        last_w = 360 if 'style="width:360px"' in cells[-1] else 390
        out[name] = (title, html, w_for(n, last_w), 1050)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    built = build()
    for name, (title, html, w, h) in built.items():
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
            f.write(html)
        print(f"{name}\t{w}x{h}\t{title}")


if __name__ == "__main__":
    main()
