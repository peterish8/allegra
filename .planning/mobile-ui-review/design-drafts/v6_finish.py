"""V6 completion pass. Design mockups only; app implementation ships separately.

Loaded after round 6, before boards render. Keep the older rounds intact.
"""
import re
import v5_kit as K
import v5_core as C
import v5_rest as R
import v5_player as P
import v5_round6 as V
from v6_icons import ic as ionicon
for module in (K, C, R, P, V):
    module.ic = ionicon
from v5_kit import art, board, cell, cov, esc, ib, ic, opt, phone, shell, sheet, song_row


K.CSS += """
@font-face{font-family:Ionicons;src:url(assets/Ionicons.ttf) format('truetype');font-weight:400;font-display:block}
.ms{font-family:Ionicons;font-variation-settings:normal;font-feature-settings:normal}
/* V6: readable content scrolls above the anchored shell. */
.scr{overflow-y:auto;scrollbar-width:none;padding-bottom:160px}
.scr:has(+.shell):not(:has(+.shell .mini)){padding-bottom:80px}
.ph:has(.npbg)>.scr{padding-bottom:0}
.scr:has(+.kb){padding-bottom:310px}
.nav{height:80px;padding-bottom:16px}
.ph.compact .nav{height:72px;padding-bottom:8px}
.ph.compact .scr{padding-bottom:152px}
.tabs.ws{overflow:visible;flex-shrink:0}
.tabscroll{display:flex;gap:20px;min-width:0;overflow-x:auto;scrollbar-width:none;flex:1}
.tabs.ws>.ib{position:relative;flex-shrink:0}
.tabscroll .tab{flex-shrink:0}
.tab{min-width:48px}
.x2 .tabs.ws{height:72px;overflow:visible}
.x2 .tabscroll .tab{height:72px;font-size:26px}
.x2 .sortq{height:auto;min-height:48px;font-size:22px;line-height:28px;text-align:left}
.x2 .lsearch{min-height:64px;height:auto}
.x2 .lsearch .v{font-size:28px;line-height:36px}
.x2 .mini .tx{min-width:0}
.x2 .mini b{font-size:24px;line-height:28px}
.x2 .mini s{font-size:20px;line-height:24px}
.x2 .mini,.x2 .mini .id{height:72px}
.x2 .scr{padding-bottom:176px}
.seg button{min-height:48px}
.setting-note{padding:8px 16px;color:var(--t2);font:400 13px/19px Inter}
.queue-empty{display:flex;flex:1;align-items:center;justify-content:center;padding:24px 0 40px}
.queue-empty .empty{color:var(--t1)}
.pstage.artist,.pstage.artist img,.pstage.artist .rim{border-radius:50%}
.sband[aria-disabled=true]{opacity:.55}
.sheet.deep{background:#0D0F12;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.card .cv.tile{display:flex;align-items:center;justify-content:center}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition-property:opacity!important}}
"""

# Every library tab uses one scrollable tab group and a pinned search target.
def library_tabs(active="songs"):
    names = dict(songs="Songs", playlists="Playlists", artists="Artists", albums="Albums")
    tabs = ''.join(f'<button class="tab{" on" if k == active else ""}" role="tab" aria-selected="{str(k == active).lower()}">{v}</button>' for k, v in names.items())
    return '<div class="tabs ws"><div class="tabscroll" role="tablist" aria-label="Show in Library">' + tabs + '</div>' + ib('search', f'Search in {names[active]}') + '</div>'


for module in (C, R, V):
    module.library_tabs = library_tabs
C.sort_button = V.sort_quiet


def tab_search(tab, query, result, count):
    name = dict(playlists='Playlists', artists='Artists', albums='Albums')[tab]
    field = '<div class="lsearch">' + ib('arrow_back', f'Close search in {name}') + f'<span class="v">{esc(query)}</span>' + ib('close', 'Clear search') + '</div>'
    body = C.library_header() + field + f'<p class="meta" style="padding:12px 16px">{count} · searching {name} only</p>' + result
    return phone(body, shell('library'))


_settings = R.settings_top
def settings_top(scroll=0):
    html = _settings(scroll)
    # V6 removes the volume row, so its redundant visibility setting also leaves.
    html = html.replace(K.li(None, 'Hide volume slider', switch=False), '')
    return html


R.settings_top = settings_top


def upnext_empty():
    panel = ('<section class="qp" aria-label="Up next" style="top:176px">'
             '<div class="grab" aria-hidden="true" style="margin:0 auto"></div>'
             '<div class="qh"><div><h2>Up next</h2><p>No songs queued</p></div></div>'
             '<div class="queue-empty">' + V.empty_state('queue_music', 'You’re all caught up',
             'Choose another song to keep listening.', '<div class="acts">' + V.btn('Find music', 'p', 'search') + '</div>') + '</div></section>')
    # Preserve the exact current-song header and working pause control from the full queue.
    return re.sub(r'<section class="qp".*?</section>', lambda _: panel, P.upnext_full(), count=1)


def browse_detail(album=False):
    title, cover = ('Small Hours', 'small-hours') if album else ('Mira Vale', 'mira-vale')
    meta = 'Album · Mira Vale · 2024<br>8 songs · 31 min' if album else 'Artist · 1.2M subscribers<br>12 songs on this phone'
    hero = (f'<div class="pstage{" artist" if not album else ""}"><img class="amb" src="{cov(cover)}" alt="">'
            f'<img class="cv" src="{cov(cover)}" alt="{esc(title)}"><span class="rim" aria-hidden="true"></span></div>')
    controls = (f'<div class="pact"><p class="m">{meta}</p><button class="gshuf" aria-label="Shuffle {esc(title)}"><span>{ic("shuffle")}</span></button>'
                f'<button class="pplay" aria-label="Play {esc(title)}">{ic("play_arrow", True)}</button></div>')
    utility = (V.btn('Save album', 't', 'add') if album else V.btn('Follow', 't', 'person_add') + V.btn('Radio', 't', 'radio'))
    rows = C.ul([song_row(k, num=i+1 if album else None) for i, k in enumerate(['small', 'lanterns', 'glass', 'under', 'static'])])
    return phone(R.top('', actions=ib('more_vert', f'{title} options')) + hero + f'<h1 class="ptitle">{title}</h1>' + controls
                 + '<div style="display:flex;padding:4px">' + utility + '</div>' + rows, shell('library'))


_artist = R.artist_page
R.artist_page = lambda scrolled=False, error=False: _artist(scrolled, error) if scrolled or error else browse_detail()
R.collection_page = lambda: browse_detail(True)


def responsive():
    return [
        cell('360 × 640 · compact', '24 seek + 56 mini + 72 navigation including inset. Content scrolls clear of the shell.', C.library_songs(pk=dict(w=360, h=640, cls='compact')), w=360),
        cell('393 × 852 · standard', 'The same components and 16 gutter at the common phone width.', C.library_songs(pk=dict(w=393, h=852)), w=393),
        cell('430 × 932 · large', 'Controls keep their sizes; the list receives the extra width.', C.playlist_detail(pk=dict(w=430, h=932)), w=430),
        cell('360 × 780 · 200% text', 'Tab labels scroll while Search stays pinned. Rows grow; the mini player grows to 72 for legible metadata.', C.library_songs(pk=dict(w=360, h=780, cls='x2')), w=360),
        cell('360 × 640 · player', 'Smaller artwork preserves the transport controls. Content can scroll on short phones.', C.now_playing(art_size=176, pk=dict(w=360, h=640, cls='compact')), w=360),
        cell('360 × 740 · keyboard', 'Search results scroll above the keyboard; shell is hidden.', C.search_screen('typing', pk=dict(w=360, h=740)), w=360),
    ]


R.responsive = responsive


def finish(boards):
    """Complete the remaining boards while keeping existing states and annotations."""
    extras = {
        'V5-LibraryMore.dc.html': [
            cell('Search Playlists', 'Search is scoped to this tab; Back restores the tabs.', tab_search('playlists', 'Night', R.pl_row(art('night-drive'), 'Night drive', 'Playlist · 24 songs'), '1 of 6 playlists')),
            cell('Search Artists', 'Circles identify people. The same search and sort model as Songs.', tab_search('artists', 'Mira', C.ul([C.artist_row()]), '1 of 7 artists')),
            cell('Search Albums', 'Album and artist stay together in the result; collection covers remain square.', tab_search('albums', 'Small', C.ul([R.nm_row(art('small-hours'), 'Small Hours', 'Album · Mira Vale')]), '1 of 6 albums')),
        ],
        'V5-Search.dc.html': [cell('360 · 200% text', 'Field and results grow; scrolling keeps everything reachable.', C.search_screen('typing', pk=dict(w=360, h=780, cls='x2')), w=360)],
        'V5-NowPlaying.dc.html': [cell('Up next · empty', 'No fake cover deck, filters or shuffle when nothing follows. Find music opens Search; current playback continues.', upnext_empty())],
        'V5-Responsive.dc.html': [],
    }
    for key, cells in extras.items():
        if not cells:
            continue
        title, html, w, h, page = boards[key]
        # Existing boards have exactly one outer .board followed by </x-dc>.
        at = html.rfind('</div>\n</x-dc>')
        if at < 0:
            raise ValueError(f'No board insertion point in {key}')
        html = html[:at] + ''.join(cells) + html[at:]
        boards[key] = title, html, w, h, page
    # Clear stale undecided copy now that the owner has accepted the defaults.
    for key, (title, html, w, h, page) in list(boards.items()):
        html = html.replace('Proposal:', 'Planned app change:')
        html = html.replace(' (open question)', '').replace('; open question', '')
        html = html.replace('Round 5', 'V6').replace('round 5', 'V6')
        html = html.replace('Material Symbols Rounded', 'Ionicons')
        html = html.replace('class="sheet"', 'class="sheet deep"')
        # All fixed overlays clear the new 24+56+80 shell.
        html = html.replace('bottom:146px', 'bottom:160px').replace('bottom:154px', 'bottom:168px')
        boards[key] = title, html, w, h, page
    return boards
