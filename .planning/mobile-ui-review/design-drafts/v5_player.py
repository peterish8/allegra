"""Round 5 player, second pass: depth from the cover itself, frosted controls, on-media text tones.

Depth comes from three real layers, not decoration: the cover blurred full-screen (the app's AppleBackdrop),
a scrim that darkens only where the controls sit, and the sharp cover lifted by its own coloured shadow.
"""
from v5_kit import SONGS, cov, esc, ic, phone, song_row, sheet as _sheet

PLAYER_CSS = """
.npbg{position:absolute;inset:0;overflow:hidden;background:#08090B}
.npbg img{position:absolute;left:-90px;top:-90px;width:calc(100% + 180px);height:calc(100% + 180px);object-fit:cover;filter:blur(72px) saturate(1.5) brightness(.82)}
.npbg i{position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,9,11,.28) 0%,rgba(8,9,11,.06) 30%,rgba(8,9,11,.42) 62%,rgba(8,9,11,.86) 100%)}
.npm1{color:#fff}.npm2{color:rgba(255,255,255,.72)}.npm3{color:rgba(255,255,255,.56)}
.grab{align-self:center;width:36px;height:5px;border-radius:3px;background:rgba(255,255,255,.38);margin:6px 0 0;flex-shrink:0}
.nphd{display:flex;align-items:center;height:52px;padding:0 4px;flex-shrink:0}
.nphd .src{flex:1;display:flex;flex-direction:column;align-items:center;border:0;background:none;color:#fff}
.nphd .src small{font:600 11px/14px Inter;color:rgba(255,255,255,.56)}
.nphd .src span{font:600 13px/18px Inter}
.nib{width:48px;height:48px;border:0;background:none;padding:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.86);flex-shrink:0}
.gl{width:36px;height:36px;border-radius:18px;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(255,255,255,.14);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 4px 12px rgba(0,0,0,.18);backdrop-filter:blur(14px)}
.gl .ms{font-size:20px}
.stage{position:relative;align-self:center;flex-shrink:0}
.stage .amb{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:14px;filter:blur(30px) saturate(1.7);opacity:.75;transform:translateY(24px) scale(.88)}
.stage .cv{position:relative;display:block;width:100%;height:100%;object-fit:cover;border-radius:14px;
    box-shadow:0 2px 6px rgba(0,0,0,.22),0 28px 56px -12px rgba(0,0,0,.6)}
.stage .rim{position:absolute;inset:0;border-radius:14px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);pointer-events:none}
.npt{display:flex;align-items:center;gap:8px;padding:0 16px 0 24px;flex-shrink:0}
.npt h1{font:700 24px/30px Inter;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.npt .ar{border:0;background:none;padding:0;font:400 17px/22px Inter;color:rgba(255,255,255,.72);text-align:left}
.seek{padding:0 24px;flex-shrink:0}
.seek .hit{position:relative;height:48px;margin:-12px 0 -10px;display:flex;align-items:center}
.seek .tr{position:absolute;left:0;right:0;height:5px;border-radius:3px;background:rgba(255,255,255,.22);overflow:hidden}
.seek .tr i{display:block;height:5px;background:rgba(255,255,255,.92)}
.seek .tm{display:flex;justify-content:space-between;font:600 12px Inter;color:rgba(255,255,255,.56);font-variant-numeric:tabular-nums}
.trn{display:flex;align-items:center;justify-content:space-between;padding:0 20px;flex-shrink:0}
.trn .sk{width:64px;height:64px;border:0;background:none;padding:0;display:flex;align-items:center;justify-content:center;color:#fff}
.trn .sk .ms{font-size:46px}
.trn .md{position:relative;width:48px;height:48px;border:0;background:none;padding:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.56)}
.trn .md.on{color:#fff}
.trn .md.on::after{content:'';position:absolute;bottom:6px;width:4px;height:4px;border-radius:2px;background:#fff}
.disc{width:84px;height:84px;border-radius:42px;border:0;padding:0;display:flex;align-items:center;justify-content:center;color:#fff;
    background:rgba(255,255,255,.16);backdrop-filter:blur(20px) saturate(1.4);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.32),inset 0 -1px 0 rgba(0,0,0,.12),0 14px 34px rgba(0,0,0,.32)}
.disc .ms{font-size:46px}
.disc.sm{width:64px;height:64px;border-radius:32px}
.disc.sm .ms{font-size:36px}
.vol{display:flex;align-items:center;gap:10px;height:48px;padding:0 24px;color:rgba(255,255,255,.56);flex-shrink:0}
.vol .ms{font-size:18px}
.vol .tr{position:relative;flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.22)}
.vol .tr i{position:absolute;left:0;top:0;height:4px;border-radius:2px;background:rgba(255,255,255,.72)}
.npb{display:flex;align-items:center;justify-content:space-between;padding:0 32px;margin-top:auto;margin-bottom:26px;flex-shrink:0}
.npb .nib{color:rgba(255,255,255,.78)}
.npb .nib.on .lit{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.22)}
.npnote{display:flex;align-items:center;gap:8px;margin:10px 24px 0;padding:8px 12px;border-radius:10px;background:rgba(0,0,0,.28);font:400 13px/18px Inter;color:#fff;backdrop-filter:blur(12px)}
.npnote .ms{font-size:16px}
.lyr p{font:700 30px/38px Inter;color:#fff;margin-bottom:18px}
.sheet.glass{background:rgba(20,22,27,.82);backdrop-filter:blur(40px) saturate(1.4);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.sheet.glass .gr{background:rgba(255,255,255,.3)}
.sheet.glass .hr{background:rgba(255,255,255,.08)}
.deck{position:relative;height:176px;margin:4px 0 0;flex-shrink:0}
.deck img{position:absolute;object-fit:cover;border-radius:12px}
.qp{position:absolute;left:0;right:0;bottom:0;z-index:10;border-radius:22px 22px 0 0;background:rgba(14,15,19,.74);backdrop-filter:blur(36px) saturate(1.4);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 -18px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;padding-top:6px}
.qh{display:flex;align-items:center;gap:8px;padding:8px 12px 4px 20px}
.qh h2{font:700 18px/24px Inter;color:#fff}
.qh p{font:400 12px/16px Inter;color:rgba(255,255,255,.56)}
.seg{display:flex;margin:8px 20px 4px;padding:3px;border-radius:11px;background:rgba(255,255,255,.07)}
.seg button{flex:1;height:34px;border:0;border-radius:8px;background:none;font:400 13px Inter;color:rgba(255,255,255,.72)}
.seg button.on{background:rgba(255,255,255,.16);color:#fff;font-weight:600;box-shadow:inset 0 1px 0 rgba(255,255,255,.12)}
.ql{font:600 12px/16px Inter;color:rgba(255,255,255,.56);padding:12px 20px 4px}
.qr{display:flex;align-items:center;gap:12px;height:56px;padding:0 4px 0 20px}
.qr img{width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0}
.qr .t{flex:1;min-width:0;display:flex;flex-direction:column;border:0;background:none;padding:0;text-align:left}
.qr .t b{font:400 15px/20px Inter;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qr .t s{text-decoration:none;font:400 13px/18px Inter;color:rgba(255,255,255,.56);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qr .d{font:400 12px Inter;color:rgba(255,255,255,.5);font-variant-numeric:tabular-nums}
.qr .h{color:rgba(255,255,255,.42)}
"""


def backdrop(cover="low-tide"):
    return f'<div class="npbg" aria-hidden="true"><img src="{cov(cover)}" alt=""><i></i></div>'


def nib(icon, label, fill=False, pressed=None, cls="", lit=False):
    p = f' aria-pressed="{str(pressed).lower()}"' if pressed is not None else ""
    inner = f'<span class="lit">{ic(icon, fill)}</span>' if lit else ic(icon, fill)
    return f'<button class="nib{(" " + cls) if cls else ""}{" on" if lit else ""}" aria-label="{esc(label)}"{p}>{inner}</button>'


def glass_btn(icon, label, fill=False, pressed=None):
    p = f' aria-pressed="{str(pressed).lower()}"' if pressed is not None else ""
    return f'<button class="nib" aria-label="{esc(label)}"{p}><span class="gl">{ic(icon, fill)}</span></button>'


def header(source="Night drive", remote=False):
    return ('<div class="grab" aria-hidden="true"></div>'
            f'<div class="nphd">{nib("keyboard_arrow_down", "Close player")}'
            f'<button class="src" aria-label="Playing from {esc(source)}. Open"><small>Playing from</small><span>{esc(source)}</span></button>'
            + nib("devices", "Playing on Living room PC. Choose where it plays" if remote else "Playing on this phone. Choose where it plays", fill=remote) + "</div>")


def stage(size, cover="low-tide", paused=False, mt=12, error=None):
    """error: None | "error" (info control on the cover) | "detail" (details inside the cover rectangle)."""
    sc = ";transform:scale(.86)" if paused else ""
    soft = ";filter:blur(14px) brightness(.55) saturate(1.2)" if error == "detail" else ""
    extra = ""
    if error:
        expanded = error == "detail"
        extra = (f'<button class="nib" aria-label="{"Hide playback problem details" if expanded else "Playback problem. Show details"}" aria-expanded="{str(expanded).lower()}" '
                 f'style="position:absolute;top:4px;right:4px;z-index:2"><span style="width:36px;height:36px;border-radius:18px;display:flex;align-items:center;justify-content:center;'
                 f'background:rgba(8,9,11,.55);color:#fff;backdrop-filter:blur(10px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)">{ic("close" if expanded else "info", size=20)}</span></button>')
        if expanded:
            extra += ('<div role="alert" style="position:absolute;inset:0;z-index:1;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;padding:24px 22px 18px;'
                      'background:rgba(8,9,11,.35)">'
                      f'{ic("error", size=28, color="#fff")}<p style="font:700 20px/26px Inter;color:#fff;margin-top:10px">Couldn’t play this song</p>'
                      '<p style="font:400 14px/20px Inter;color:rgba(255,255,255,.82);margin-top:6px">The song stopped loading before it could start. Try again, or skip to the next song.</p>'
                      f'<div style="margin:12px 0 0 -12px"><button class="btn t sm" style="color:#fff">{ic("refresh")}Try again</button></div></div>')
    return (f'<div class="stage" style="width:{size}px;height:{size}px;margin-top:{mt}px{sc}">'
            f'<img class="amb" src="{cov(cover)}" alt="" aria-hidden="true"><img class="cv" src="{cov(cover)}" alt="Cover of Low Tide" style="transition:filter .24s{soft}"><span class="rim" aria-hidden="true"></span>{extra}</div>')


def title_row(liked=True, size=24, key="low"):
    t, a, *_ = SONGS[key]
    return (f'<div class="npt"><div style="flex:1;min-width:0"><h1 style="font-size:{size}px">{esc(t)}</h1>'
            f'<button class="ar" aria-label="{esc(a)}. Go to artist">{esc(a)}</button></div>'
            + glass_btn("favorite", "Liked" if liked else "Like", liked, liked) + glass_btn("more_horiz", "More actions for Low Tide") + "</div>")


def seek(pct=38, a="1:24", b="-2:17"):
    return (f'<div class="seek"><div class="hit" role="slider" aria-label="Song position" aria-valuetext="{a} of 3:41">'
            f'<span class="tr"><i style="width:{pct}%"></i></span></div><div class="tm"><span>{a}</span><span>{b}</span></div></div>')


def transport(state="playing", small=False, minimal=False):
    disc_cls = "disc sm" if small else "disc"
    if state == "playing":
        mid = f'<button class="{disc_cls}" aria-label="Pause">{ic("pause", True)}</button>'
    elif state == "loading":
        mid = (f'<button class="{disc_cls}" aria-label="Loading. Pause" aria-busy="true"><span class="ring lg" aria-hidden="true" '
               'style="width:30px;height:30px;border-width:3px;border-color:rgba(255,255,255,.25);border-top-color:#fff;border-right-color:#fff"></span></button>')
    elif state == "error":
        mid = f'<button class="{disc_cls}" aria-label="Couldn’t play. Try again">{ic("refresh")}</button>'
    else:
        mid = f'<button class="{disc_cls}" aria-label="Play">{ic("play_arrow", True)}</button>'
    core =(f'<button class="sk" aria-label="Previous song">{ic("fast_rewind", True)}</button>{mid}'
            f'<button class="sk" aria-label="Next song">{ic("fast_forward", True)}</button>')
    if minimal:
        return f'<div class="trn" style="justify-content:center;gap:28px">{core}</div>'
    return (f'<div class="trn">'
            f'<button class="md" aria-label="Shuffle what plays next">{ic("shuffle")}</button>{core}'
            f'<button class="md" aria-label="Repeat this song" aria-pressed="false">{ic("repeat_one")}</button></div>')


def bottom(lyrics_on=False, queue_on=False):
    return ('<div class="npb">' + nib("lyrics", "Lyrics", pressed=lyrics_on, lit=lyrics_on)
            + nib("bedtime", "Sleep timer") + nib("queue_music", "Up next", pressed=queue_on, lit=queue_on) + "</div>")


def player_sheet(inner, label, top=None):
    s = _sheet(inner, label, top=top)
    return s.replace('<section class="sheet"', '<section class="sheet glass"', 1)


def _wrap(body, overlay="", pk=None, cover="low-tide"):
    return phone(f"<style>{PLAYER_CSS}</style>" + body, "", overlay, bg=backdrop(cover), **(pk or {}))


def now_playing(state="playing", art_size=342, sheet_html="", volume=False, pk=None, remote=False):
    """No volume row (device keys do that). Loading and errors live inside existing controls, so nothing shifts."""
    chip = ""
    if remote:
        chip = (f'<p style="align-self:center;display:flex;align-items:center;gap:6px;margin-top:2px;padding:6px 12px;border-radius:10px;'
                f'background:rgba(255,255,255,.14);font:600 13px Inter;color:#fff">{ic("computer", size=16)}Playing on Living room PC</p>')
    gap = 32 if art_size >= 300 else 20
    err = {"error": "error", "error_detail": "detail"}.get(state)
    body = (header(remote=remote) + chip + stage(art_size, mt=16 if not remote else 10, error=err)
            + f'<div style="height:{gap}px"></div>' + title_row() + '<div style="height:22px"></div>' + seek()
            + '<div style="height:18px"></div>' + transport({"error_detail": "error"}.get(state, state)) + bottom())
    return _wrap(body, sheet_html, pk)


LINES = ["the tide pulls back the evening", "and the harbour lights go out", "one by one, like the years we lost",
         "I count them on the water", "every light a name I used to know", "and the tide comes in", "slow enough to miss it",
         "you said the sea forgets", "but it keeps everything we drop", "low tide, low tide"]


def now_playing_lyrics():
    """Lyrics take the screen: a small cover to go back, the lines, the seek line and three transport buttons. Nothing else."""
    top = ('<div class="grab" aria-hidden="true"></div>'
           f'<div style="display:flex;align-items:center;gap:12px;padding:10px 12px 0 20px;flex-shrink:0">'
           f'<button aria-label="Show the cover (leave lyrics)" style="border:0;padding:0;background:none;display:flex;align-items:center;gap:12px;flex:1;min-width:0;text-align:left;color:#fff">'
           f'<img src="{cov("low-tide")}" alt="" style="width:44px;height:44px;border-radius:8px;object-fit:cover;box-shadow:0 8px 20px rgba(0,0,0,.4)">'
           f'<span style="display:flex;flex-direction:column;min-width:0"><b style="font:600 15px/20px Inter">Low Tide</b><span class="npm3" style="font:400 13px/18px Inter">Harbor Kids</span></span></button>'
           + nib("lyrics", "Hide lyrics", pressed=True, lit=True) + "</div>")
    style = ["opacity:.28;filter:blur(1.4px)", "opacity:.36;filter:blur(.8px)", "opacity:.44", "opacity:1", "opacity:.5", "opacity:.44",
             "opacity:.38;filter:blur(.6px)", "opacity:.32;filter:blur(1px)", "opacity:.26;filter:blur(1.6px)", "opacity:.2;filter:blur(2px)"]
    lines = "".join(f'<p style="{st}"' + (' aria-current="true"' if i == 3 else "") + f">{esc(t)}</p>" for i, (t, st) in enumerate(zip(LINES, style)))
    body = (top + f'<div class="lyr" role="list" aria-label="Lyrics" style="flex:1;padding:22px 28px 0;overflow:hidden">{lines}</div>'
            + seek() + transport("playing", small=True, minimal=True) + '<div style="height:30px"></div>')
    return _wrap(body)


def queue_row(key, meta=None, dur=None):
    t, a, d, c, _ = SONGS[key]
    return (f'<li class="qr"><img src="{cov(c)}" alt=""><button class="t" aria-label="{esc(t)}, {esc(a)}. Play now"><b>{esc(t)}</b><s>{esc(meta or a)}</s></button>'
            f'<span class="d">{dur or d}</span><button class="nib h" aria-label="Move {esc(t)}">{ic("drag_indicator")}</button></li>')


def now_playing_upnext():
    # Top half: the playing cover with the next songs fanned behind it, so "what's next" is visible as artwork.
    fan = (f'<img src="{cov("fade")}" alt="" aria-hidden="true" style="left:276px;top:44px;width:96px;height:96px;opacity:.32">'
           f'<img src="{cov("static-rain")}" alt="" aria-hidden="true" style="left:212px;top:30px;width:124px;height:124px;opacity:.55">'
           f'<img src="{cov("small-hours")}" alt="" aria-hidden="true" style="left:140px;top:14px;width:152px;height:152px;opacity:.82;box-shadow:0 16px 32px rgba(0,0,0,.4)">')
    cur = (f'<div class="stage" style="position:absolute;left:24px;top:0;width:176px;height:176px">'
           f'<img class="amb" src="{cov("low-tide")}" alt="" aria-hidden="true"><img class="cv" src="{cov("low-tide")}" alt="Cover of Low Tide"><span class="rim" aria-hidden="true"></span></div>')
    nexttag = (f'<p style="position:absolute;left:216px;top:176px;font:600 11px/14px Inter;color:rgba(255,255,255,.56)">Next</p>'
               f'<p style="position:absolute;left:216px;top:190px;font:600 13px/18px Inter;color:#fff;white-space:nowrap">Small Hours</p>')
    deck = f'<div class="deck" style="height:212px">{fan}{cur}{nexttag}</div>'
    top = header() + deck + '<div style="height:10px"></div>' + title_row(size=22) + '<div style="height:10px"></div>' + seek() + transport("playing", small=True)
    panel = ('<section class="qp" aria-label="Up next" style="top:500px"><div class="grab" aria-hidden="true" style="margin:0 auto"></div>'
             '<div class="qh"><div style="flex:1;min-width:0"><h2>Up next</h2><p>From Night drive · 21 songs · 1 h 18 min</p></div>'
             + glass_btn("shuffle", "Shuffle what plays next") + glass_btn("repeat_one", "Repeat this song", pressed=False) + "</div>"
             + '<div class="seg" role="radiogroup" aria-label="Show">'
             + "".join(f'<button role="radio" aria-checked="{str(c == "All").lower()}" class="{"on" if c == "All" else ""}">{c}</button>' for c in ("All", "Familiar", "Discover"))
             + '</div><ul>' + queue_row("small") + queue_row("static") + queue_row("fade") + "</ul>"
             + '<p class="ql">Then similar songs, added automatically</p></section>')
    return _wrap(top, panel)


def upnext_full():
    """Up next pulled all the way up: the list takes the screen, the playing song stays as a compact header."""
    head = (f'<div style="display:flex;align-items:center;gap:12px;padding:4px 16px 8px 20px">'
            f'<img src="{cov("low-tide")}" alt="" style="width:56px;height:56px;border-radius:8px;object-fit:cover;box-shadow:0 8px 20px rgba(0,0,0,.4)">'
            f'<div style="flex:1;min-width:0"><p style="font:700 17px/22px Inter;color:#fff">Low Tide</p><p class="npm2" style="font:400 14px/19px Inter">Harbor Kids · 1:24 of 3:41</p></div>'
            f'<button class="disc sm" style="width:48px;height:48px" aria-label="Pause">{ic("pause", True, 28)}</button></div>')
    panel = ('<section class="qp" aria-label="Up next" style="top:176px"><div class="grab" aria-hidden="true" style="margin:0 auto"></div>'
             '<div class="qh"><div style="flex:1;min-width:0"><h2>Up next</h2><p>From Night drive · 21 songs · 1 h 18 min</p></div>'
             + glass_btn("shuffle", "Shuffle what plays next") + glass_btn("repeat_one", "Repeat this song", pressed=False) + "</div>"
             + '<div class="seg" role="radiogroup" aria-label="Show">'
             + "".join(f'<button role="radio" aria-checked="{str(c == "All").lower()}" class="{"on" if c == "All" else ""}">{c}</button>' for c in ("All", "Familiar", "Discover"))
             + '</div><p class="ql">Next from Night drive</p><ul>' + queue_row("small") + queue_row("static") + queue_row("fade") + queue_row("baarish") + queue_row("golden") + "</ul>"
             + '<p class="ql">Then similar songs, added automatically</p><ul>' + queue_row("glass", "Mira Vale · similar") + queue_row("under", "Mira Vale · similar") + "</ul></section>")
    return _wrap(header() + head, panel)


def player_menu(key="low"):
    from v5_kit import opt
    title, artist, _, cover, _ = SONGS[key]
    h = (f'<div class="sh"><img class="art" src="{cov(cover)}" alt=""><span class="id"><b>{esc(title)}</b><span class="meta">{esc(artist)} · Night drive</span></span>'
         f'<button class="ib" aria-label="Close">{ic("close")}</button></div><div class="hr" style="margin:4px 0 4px"></div>')
    groups = [
        opt("queue_play_next", "Play next") + opt("playlist_add", "Add to playlist") + opt("radio", "Start radio") + opt("share", "Share"),
        opt("person", "View artist", artist) + opt("lyrics", "Lyrics sources…") + opt("download", "Download"),
        opt("cast", "Cast to…") + opt("devices", "Connect devices", "Move playback to your other devices") + opt("group", "LuvLink", "Listen with friends in sync"),
        opt("fullscreen", "Ambient mode") + opt("info", "Details", "Song information, edit lyrics, cover") + opt("equalizer", "Equalizer")
        + opt("tune", "Tempo and pitch") + opt("refresh", "Reload the song") + opt("notifications", "Set as ringtone"),
    ]
    inner = h + '<div class="hr"></div>'.join(groups)
    return '<div class="scrim"></div>' + player_sheet(inner, "Player actions", top=40)
