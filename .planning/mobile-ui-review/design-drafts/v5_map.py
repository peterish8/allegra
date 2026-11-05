"""Verified inventory (single source for the coverage board and the spec), the navigation map board and the coverage board."""
from v5_kit import board, esc, ic

# id, item, type, code, entry, boards, design, note
# type: screen | sheet | dialog | overlay | state-set | proposal | out
INVENTORY = [
    # ---- verified routes (18 screen files + 2 root modals)
    ("S1", "Stream (home)", "screen", "StreamScreen", "Tab", "V5-Stream (4 states)", "drawn", "Jump back in moves here (proposal); own search field removed (proposal)"),
    ("S2", "Luvs", "screen", "LuvsScreen", "Tab", "V5-Luvs", "drawn", "Mini player hidden here, as today"),
    ("S3", "Library · Songs", "screen", "LibraryScreen", "Tab", "V5-Library (6 states)", "drawn", "List first; deck and artist orbit leave (proposal)"),
    ("S4", "Playlists", "screen", "PlaylistsScreen", "Library header, ••• menu", "V5-LibraryMore, V5-PlaylistFlows", "drawn", "Becomes a Library tab (proposal)"),
    ("S5", "Playlist", "screen", "PlaylistDetailScreen", "Playlists, search, widget", "V5-Playlist (6 states)", "drawn", ""),
    ("S6", "Search", "screen", "SearchScreen", "Current: ••• menu, Stream double tap", "V5-Search (5 states)", "drawn", "Owner-approved planned app change: Search tab"),
    ("S7", "Now playing", "screen", "NowPlayingScreen", "Mini player", "V5-NowPlaying (6)", "drawn", "Buffering and error UI need code"),
    ("S8", "Your DJ", "screen", "DjScreen", "••• menu", "V5-Tools", "drawn", "Owner-approved planned app change: moves to You"),
    ("S9", "Settings", "screen", "SettingsScreen", "••• menu", "V5-You (3)", "drawn", "Owner-approved plan: retire three shell look settings; keep Player background"),
    ("S10", "Artist", "screen", "ArtistScreen", "Now playing artist, search, Stream", "V5-Browse (3)", "drawn", ""),
    ("S11", "Album / playlist from YouTube Music", "screen", "CollectionScreen", "Artist, Stream shelves", "V5-Browse", "drawn", "Track numbers instead of covers"),
    ("S12", "Blends", "screen", "BlendsScreen", "Library header", "V5-Social (2)", "drawn", "Owner-approved planned app change: moves to You"),
    ("S13", "A Blend", "screen", "BlendScreen", "Blends", "V5-Social", "drawn", ""),
    ("S14", "Join a Blend", "screen", "BlendJoinScreen", "Invite link", "V5-Social (2)", "drawn", ""),
    ("S15", "Import from Spotify", "screen", "ImportScreen", "Library header", "V5-Tools (3)", "drawn", "Owner-approved planned app change: moves to Library ⋮ and You"),
    ("S16", "LuvLink", "screen", "LuvLinkScreen", "Player ⋮, invite link", "V5-Social (2)", "drawn", "In-player panel uses the same parts"),
    ("S17", "Edit lyrics", "screen", "LyricsEditorScreen", "Player ⋮ › Details", "V5-Tools", "drawn", ""),
    ("S18", "Change cover (search)", "screen", "CoverArtSearchScreen", "Song sheet, Details", "V5-Tools", "drawn", "Loading and empty described in caption only"),
    ("S19", "New playlist", "screen (modal)", "CreatePlaylistModal", "Playlists", "V5-PlaylistFlows (4)", "drawn", "Drawn as a sheet on the keyboard"),
    ("S20", "Add songs / Add to playlist", "screen (modal)", "AddToPlaylistModal", "Playlist, player", "V5-AddToPlaylist", "drawn", ""),
    # ---- verified sheets, dialogs and overlays
    ("O1", "Song actions: library and playlist", "sheet", "LibraryBottomSheet, useSongActions", "Row ⋮, long press", "V5-SongActions", "drawn", "⋮ on Library rows is new (proposal)"),
    ("O2", "Song actions: streamed song", "sheet", "useStreamSongActions", "Stream, Search", "V5-SongActions", "drawn", ""),
    ("O3", "Change cover options", "sheet", "LibraryBottomSheet (Cover)", "Song sheet", "V5-SongActions", "drawn", "Second-level sheet (proposal)"),
    ("O4", "Delete song", "dialog", "ConfirmSheet", "Song sheet", "V5-SongActions", "drawn", ""),
    ("O5", "Edit title and artist", "sheet", "useSongActions", "Song sheet", "V5-Tools", "drawn", ""),
    ("O6", "Another language or version", "sheet", "SongVersionSearchModal", "Song sheet", "V5-Tools", "drawn", ""),
    ("O7", "Player ⋮ menu", "sheet", "PlayerMenu", "Now playing ⋮", "V5-NowPlaying", "drawn", "Regrouped into one action model (proposal)"),
    ("O8", "Up next", "sheet", "UpNextPanel", "Now playing", "V5-NowPlaying", "drawn", "Empty queue state not drawn"),
    ("O9", "Lyrics view", "state", "NowPlaying lyrics mode", "Lyrics button", "V5-NowPlaying", "drawn", ""),
    ("O10", "Sleep timer", "sheet", "PlayerSheet + sleepTimerStore", "Now playing", "V5-PlayerTools (2)", "drawn", ""),
    ("O11", "Connect devices", "sheet", "ConnectDeviceSheet", "Now playing, You", "V5-PlayerTools (2)", "drawn", ""),
    ("O12", "Lyrics sources", "sheet", "LyricsPicker", "Lyrics long press, ⋮", "V5-PlayerTools", "drawn", ""),
    ("O13", "Details", "sheet", "PlayerExtras", "Player ⋮", "V5-PlayerTools", "drawn", ""),
    ("O14", "Tempo and pitch", "sheet", "PlayerExtras", "Player ⋮", "V5-PlayerTools", "drawn", "Android only"),
    ("O15", "Ambient mode", "screen state", "AmbientMode", "Player ⋮", "V5-PlayerTools", "drawn", ""),
    ("O16", "Playing on another device", "state", "ConnectRemotePlayer", "Connect", "V5-PlayerTools, Components", "drawn", "Remote mini player in Components"),
    ("O17", "Library sort", "sheet", "LibraryScreen sort", "Sort button", "V5-Library", "drawn", "Owner-approved planned app change: remember sort on Albums and Artists"),
    ("O18", "Playlist order", "sheet", "PlaylistDetailScreen sort", "Order button", "V5-Playlist", "drawn", ""),
    ("O19", "Playlist options", "sheet", "PlaylistDetailScreen actions", "Playlist ⋮", "V5-Playlist", "drawn", "Rename and Delete added (proposal)"),
    ("O20", "Playlist long press", "sheet", "PlaylistsScreen", "Long press a playlist", "V5-PlaylistFlows", "drawn", ""),
    ("O21", "Rename playlist", "sheet", "PlaylistsScreen", "Playlist sheets", "V5-PlaylistFlows", "drawn", ""),
    ("O22", "Delete playlist", "dialog", "ConfirmSheet", "Playlist sheets", "V5-PlaylistFlows", "drawn", ""),
    ("O23", "Remove from playlist", "dialog → toast", "ConfirmSheet", "Song sheet", "V5-Playlist", "drawn", "Owner-approved planned app change: remove immediately with Undo"),
    ("O24", "Add to playlist picker", "sheet", "PlaylistSelectionModal", "Song sheets, player", "V5-AddToPlaylist (2)", "drawn", "Owner-approved planned app change: show playlist membership ticks"),
    ("O25", "Downloads", "sheet", "DownloadQueueModal", "Library header", "V5-LibraryMore", "drawn", "Stream’s DownloadsTray folds into the badge (proposal)"),
    ("O26", "Languages for Luvs", "sheet", "LanguagePickerModal", "Luvs", "V5-Luvs", "drawn", ""),
    ("O27", "Saved from Luvs", "sheet", "LuvsVaultModal", "Luvs", "V5-Luvs", "drawn", "Title is a copy proposal"),
    ("O28", "Add a list", "sheet", "AddListSheet", "Stream", "V5-Stream", "drawn", ""),
    ("O29", "Voice search card", "overlay", "VoiceSearchCard", "Mic", "V5-Overlays (2)", "drawn", "Mic in the search field (proposal)"),
    ("O30", "About and updates", "sheet", "AboutSheet, UpdatePanel", "Stream ✦, You", "V5-Overlays", "drawn", "Emoji in today’s copy"),
    ("O31", "Play on this phone?", "dialog", "ConnectNoticeHost", "Pick while remote", "V5-Overlays", "drawn", ""),
    ("O32", "LuvLink join request", "overlay", "ListenTogetherHost", "Anywhere", "V5-Stream", "drawn", ""),
    ("O33", "Settings choice", "sheet", "SettingsKit Choice", "Settings", "V5-You", "drawn", ""),
    ("O34", "First sync choice", "sheet", "AllegraAccountSettings", "Sign in", "V5-You", "drawn", ""),
    ("O35", "Hidden songs", "section", "SettingsScreen", "Settings, Library ⋮", "V5-You (2)", "drawn", ""),
    ("O36", "DJ settings", "sheet", "DjScreen provider", "Your DJ", "V5-Tools", "drawn", ""),
    ("O37", "Toasts", "overlay", "Toast", "Results", "Components, several", "drawn", ""),
    ("O38", "Screen crashed", "state", "ErrorBoundary", "Render error", "V5-Overlays", "drawn", "Copy proposal"),
    ("O39", "••• More menu", "sheet", "MoreMenu", "Tab bar", "V5-You (reference)", "replaced", "Owner-approved planned app change: replaced by the You tab"),
    # ---- owner-approved planned additions (not in the app yet)
    ("P1", "You tab", "proposal", "—", "Tab", "V5-You", "drawn", "Owner-approved planned app change: replaces •••"),
    ("P2", "Library · Artists tab", "proposal", "(ArtistOrbit filter today)", "Library tab", "V5-LibraryMore", "drawn", "Owner-approved planned app change"),
    ("P3", "Library · Albums tab", "proposal", "— (song.album exists)", "Library tab", "V5-LibraryMore", "drawn", "Owner-approved planned app change"),
    ("P4", "Library ⋮ menu", "proposal", "—", "Library header", "V5-LibraryMore", "drawn", ""),
    # ---- shared states
    ("T1", "Loading", "state-set", "RowPlaceholder", "", "Library, Stream, Search", "drawn", ""),
    ("T2", "Empty", "state-set", "EmptyState", "", "Library, Playlists, Playlist, Hidden songs, Blends", "drawn", ""),
    ("T3", "Errors", "state-set", "", "", "Search, Stream, Artist, Now playing, Create, Blend join, Downloads", "drawn", ""),
    ("T4", "Keyboard up", "state-set", "", "", "Search, New playlist, Rename, Edit song", "drawn", ""),
    ("T5", "Small, short and large phones; 200% text", "state-set", "", "", "V5-Responsive", "drawn", "Shell cost on 640-tall phones flagged"),
    # ---- not drawn, with reason
    ("X1", "Android share sheet, photo picker, Cast, Equalizer, ringtone permission", "out", "System UI", "", "—", "not drawn", "Android’s own screens"),
    ("X2", "Home-screen widgets (Now playing, Playlist)", "out", "src/widget", "", "—", "not drawn", "RemoteViews surface; separate round"),
    ("X3", "Notification and lock-screen controls", "out", "Media3 session", "", "—", "not drawn", "System media controls"),
    ("X4", "System island", "out", "android/.../island", "", "—", "not drawn", "Native overlay; separate round"),
    ("X5", "Rescue screen, crash notice at next start", "out", "RescueActivity, services/uiCrash", "", "—", "not drawn", "Native / rare; follows the error-state pattern"),
    ("X6", "Frame-rate readout", "out", "PerformanceHUD", "", "—", "not drawn", "Debug tool"),
    ("X7", "Up next: empty queue", "state", "UpNextPanel", "", "V5-NowPlaying", "drawn", "V6: current song remains; one Find music action opens Search"),
]


def counts():
    c = {}
    for row in INVENTORY:
        t = row[2]
        k = ("screen" if t.startswith("screen") and row[0].startswith("S") else
             "overlay" if row[0].startswith("O") else "proposal" if t == "proposal" else "state" if row[0].startswith("T") else "out")
        c[k] = c.get(k, 0) + 1
    return c


# ---------------------------------------------------------------- navigation map board
def box(title, items=(), w=210, accent=False, prop=False, dim=False):
    border = "1.5px dashed #F2C14E" if prop else ("1.5px solid #F4F4F5" if accent else "1px solid rgba(255,255,255,.14)")
    op = ";opacity:.55" if dim else ""
    li = "".join(f'<li style="font:400 12px/17px Inter;color:#A3A5AE">{esc(i)}</li>' for i in items)
    return (f'<div style="width:{w}px;border:{border};border-radius:12px;padding:12px 14px;background:#17191E{op}">'
            f'<p style="font:600 14px/19px Inter;margin-bottom:6px">{esc(title)}</p><ul>{li}</ul></div>')


def ia_board():
    tabs = [
        ("Stream", ["Moods → mood shelves", "Jump back in (proposal)", "Quick picks, Daily discover", "Artist · Album pages", "Add a list (sheet)", "About (sheet)"]),
        ("Luvs", ["Lanes × clip stacks", "Languages (sheet)", "Saved from Luvs (sheet)", "No mini player here"]),
        ("Library", ["Songs · Playlists · Artists · Albums tabs", "→ Playlist → Add songs", "→ Artist page", "Sort (sheet) · Downloads (sheet)", "⋮ → Import, Blends, Add from phone, Hidden songs"]),
        ("Search", ["Recent searches", "Results: artists, on this phone, online, playlists", "→ Artist, Album, Playlist", "Mic → voice card"]),
        ("You", ["Your DJ", "Blends → Blend", "LuvLink", "Downloads · Import · Connect devices", "Settings → choice sheets", "About and updates"]),
    ]
    row = '<div style="display:flex;gap:16px">' + "".join(box(t, i, 236, accent=True, prop=(t in ("Search", "You"))) for t, i in tabs) + "</div>"
    shell = ('<div style="margin-top:26px;display:flex;gap:16px;align-items:stretch">'
             + box("Mini player (every tab except Luvs)", ["Tap or swipe up → Now playing", "Play/pause, next", "Shows the player’s real state"], 300)
             + '<div style="display:flex;align-items:center;font:600 22px Inter;color:#A3A5AE">→</div>'
             + box("Now playing (full screen, over the bar)", ["Lyrics · Up next (in place)", "⋮ song + player actions", "Sleep timer · Connect · Lyrics sources", "Details · Tempo · Ambient · LuvLink"], 330)
             + '<div style="display:flex;align-items:center;font:600 22px Inter;color:#A3A5AE">↔</div>'
             + box("Root modals and overlays", ["Add songs, New playlist", "Voice card, LuvLink request", "Play on this phone?", "Toasts with Undo"], 300) + "</div>")
    back = ('<div style="margin-top:26px;display:grid;grid-template-columns:1fr 1fr;gap:16px">'
            + box("Android Back, in order", ["1. Close the keyboard", "2. Close the top sheet (focus returns to its opener)", "3. Collapse the player to the mini player",
                                             "4. Pop the page inside the tab", "5. On a tab root other than Stream: go to Stream", "6. On Stream: leave the app (predictive back shows home)"], 640)
            + box("State kept per tab", ["Each tab keeps its stack and scroll (freezeOnBlur, as today)", "Tapping the active tab: pop to root, then scroll to top",
                                         "Search keeps query, scope and results until cleared", "Library keeps tab, filter and sort; owner-approved plan remembers sort on Albums and Artists"], 640) + "</div>")
    today = ('<div style="margin-top:26px">' + box("Today (for comparison)", ["Bar: Stream · Luvs · (mic) · Library · •••",
                                                                                  "••• opens Your DJ, Search, Playlists, Settings",
                                                                                  "Library header: Blends, Import, Downloads, Playlists",
                                                                                  "Search and Playlists each reachable two ways; Search hidden behind •••"], 1296, dim=True) + "</div>")
    legend = ('<p style="font:400 12px/17px Inter;color:#A3A5AE;margin-top:14px">White border: tab. <span style="color:#F2C14E">Dashed amber: owner-approved planned change, not shipped.</span> '
              'Android guidance: a navigation bar for 3–5 top destinations; tabs inside a destination for its sections.</p>')
    inner = (f'<div style="width:1360px;padding:32px;background:#0B0D10;color:#F4F4F5;font-family:Inter">'
             f'<h1 style="font:700 28px/34px Inter;margin-bottom:6px">Navigation</h1><p style="font:400 13px/19px Inter;color:#A3A5AE;margin-bottom:22px">Five destinations, one global player, sheets for everything contextual.</p>'
             f'{row}{shell}{back}{today}{legend}</div>')
    return board("Navigation map", inner, 1360, 980, raw=True)


def coverage_board():
    c = counts()
    head = ("ID", "Item", "Type", "Code", "Entry", "Boards", "Design", "Notes")
    th = "".join(f'<th style="text-align:left;font:600 12px Inter;color:#A3A5AE;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.12)">{h}</th>' for h in head)
    trs = []
    for r in INVENTORY:
        color = {"drawn": "#F4F4F5", "replaced": "#A3A5AE", "not drawn": "#FF8A80"}[r[6]]
        bg = "background:rgba(242,193,78,.06);" if r[2] == "proposal" else ""
        tds = "".join(f'<td style="{bg}padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.06);font:400 12px/16px Inter;vertical-align:top;color:{color if i == 6 else "#E4E5E8" if i < 2 else "#A3A5AE"}">{esc(v)}</td>'
                      for i, v in enumerate(r))
        trs.append(f"<tr>{tds}</tr>")
    summary = (f'Verified routes: {c.get("screen", 0)} · verified sheets, dialogs, overlays: {c.get("overlay", 0)} · proposals: {c.get("proposal", 0)} · '
               f'shared state sets: {c.get("state", 0)} · not drawn with a reason: {c.get("out", 0)}. Validation for every item: visually reviewed at phone scale only. '
               'Nothing is interactive-tested or device-tested; nothing is implemented.')
    inner = (f'<div style="width:1360px;padding:32px;background:#0B0D10;color:#F4F4F5;font-family:Inter">'
             f'<h1 style="font:700 28px/34px Inter;margin-bottom:6px">Coverage</h1><p style="font:400 13px/19px Inter;color:#A3A5AE;margin-bottom:16px">{esc(summary)}</p>'
             f'<table style="border-collapse:collapse;width:100%"><thead><tr>{th}</tr></thead><tbody>{"".join(trs)}</tbody></table></div>')
    return board("Coverage", inner, 1360, 2700, raw=True)


def markdown_matrix():
    lines = ["| ID | Item | Type | Code | Entry | Boards | Design | Validation | Notes |", "|---|---|---|---|---|---|---|---|---|"]
    for r in INVENTORY:
        val = "visually reviewed" if r[6] == "drawn" else "—"
        lines.append("| " + " | ".join([r[0], r[1], r[2], f"`{r[3]}`" if r[3] not in ("—", "") else r[3], r[4], r[5], r[6], val, r[7]]) + " |")
    return "\n".join(lines)
