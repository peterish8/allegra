| ID | Item | Type | Code | Entry | Boards | Design | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| S1 | Stream (home) | screen | `StreamScreen` | Tab | V5-Stream (4 states) | drawn | visually reviewed | Jump back in moves here (proposal); own search field removed (proposal) |
| S2 | Luvs | screen | `LuvsScreen` | Tab | V5-Luvs | drawn | visually reviewed | Mini player hidden here, as today |
| S3 | Library · Songs | screen | `LibraryScreen` | Tab | V5-Library (6 states) | drawn | visually reviewed | List first; deck and artist orbit leave (proposal) |
| S4 | Playlists | screen | `PlaylistsScreen` | Library header, ••• menu | V5-LibraryMore, V5-PlaylistFlows | drawn | visually reviewed | Becomes a Library tab (proposal) |
| S5 | Playlist | screen | `PlaylistDetailScreen` | Playlists, search, widget | V5-Playlist (6 states) | drawn | visually reviewed |  |
| S6 | Search | screen | `SearchScreen` | Current: ••• menu, Stream double tap | V5-Search (5 states) | drawn | visually reviewed | Owner-approved planned app change: Search tab |
| S7 | Now playing | screen | `NowPlayingScreen` | Mini player | V5-NowPlaying (6) | drawn | visually reviewed | Buffering and error UI need code |
| S8 | Your DJ | screen | `DjScreen` | ••• menu | V5-Tools | drawn | visually reviewed | Owner-approved planned app change: moves to You |
| S9 | Settings | screen | `SettingsScreen` | ••• menu | V5-You (3) | drawn | visually reviewed | Owner-approved plan: retire three shell look settings; keep Player background |
| S10 | Artist | screen | `ArtistScreen` | Now playing artist, search, Stream | V5-Browse (3) | drawn | visually reviewed |  |
| S11 | Album / playlist from YouTube Music | screen | `CollectionScreen` | Artist, Stream shelves | V5-Browse | drawn | visually reviewed | Track numbers instead of covers |
| S12 | Blends | screen | `BlendsScreen` | Library header | V5-Social (2) | drawn | visually reviewed | Owner-approved planned app change: moves to You |
| S13 | A Blend | screen | `BlendScreen` | Blends | V5-Social | drawn | visually reviewed |  |
| S14 | Join a Blend | screen | `BlendJoinScreen` | Invite link | V5-Social (2) | drawn | visually reviewed |  |
| S15 | Import from Spotify | screen | `ImportScreen` | Library header | V5-Tools (3) | drawn | visually reviewed | Owner-approved planned app change: moves to Library ⋮ and You |
| S16 | LuvLink | screen | `LuvLinkScreen` | Player ⋮, invite link | V5-Social (2) | drawn | visually reviewed | In-player panel uses the same parts |
| S17 | Edit lyrics | screen | `LyricsEditorScreen` | Player ⋮ › Details | V5-Tools | drawn | visually reviewed |  |
| S18 | Change cover (search) | screen | `CoverArtSearchScreen` | Song sheet, Details | V5-Tools | drawn | visually reviewed | Loading and empty described in caption only |
| S19 | New playlist | screen (modal) | `CreatePlaylistModal` | Playlists | V5-PlaylistFlows (4) | drawn | visually reviewed | Drawn as a sheet on the keyboard |
| S20 | Add songs / Add to playlist | screen (modal) | `AddToPlaylistModal` | Playlist, player | V5-AddToPlaylist | drawn | visually reviewed |  |
| O1 | Song actions: library and playlist | sheet | `LibraryBottomSheet, useSongActions` | Row ⋮, long press | V5-SongActions | drawn | visually reviewed | ⋮ on Library rows is new (proposal) |
| O2 | Song actions: streamed song | sheet | `useStreamSongActions` | Stream, Search | V5-SongActions | drawn | visually reviewed |  |
| O3 | Change cover options | sheet | `LibraryBottomSheet (Cover)` | Song sheet | V5-SongActions | drawn | visually reviewed | Second-level sheet (proposal) |
| O4 | Delete song | dialog | `ConfirmSheet` | Song sheet | V5-SongActions | drawn | visually reviewed |  |
| O5 | Edit title and artist | sheet | `useSongActions` | Song sheet | V5-Tools | drawn | visually reviewed |  |
| O6 | Another language or version | sheet | `SongVersionSearchModal` | Song sheet | V5-Tools | drawn | visually reviewed |  |
| O7 | Player ⋮ menu | sheet | `PlayerMenu` | Now playing ⋮ | V5-NowPlaying | drawn | visually reviewed | Regrouped into one action model (proposal) |
| O8 | Up next | sheet | `UpNextPanel` | Now playing | V5-NowPlaying | drawn | visually reviewed | Empty queue state not drawn |
| O9 | Lyrics view | state | `NowPlaying lyrics mode` | Lyrics button | V5-NowPlaying | drawn | visually reviewed |  |
| O10 | Sleep timer | sheet | `PlayerSheet + sleepTimerStore` | Now playing | V5-PlayerTools (2) | drawn | visually reviewed |  |
| O11 | Connect devices | sheet | `ConnectDeviceSheet` | Now playing, You | V5-PlayerTools (2) | drawn | visually reviewed |  |
| O12 | Lyrics sources | sheet | `LyricsPicker` | Lyrics long press, ⋮ | V5-PlayerTools | drawn | visually reviewed |  |
| O13 | Details | sheet | `PlayerExtras` | Player ⋮ | V5-PlayerTools | drawn | visually reviewed |  |
| O14 | Tempo and pitch | sheet | `PlayerExtras` | Player ⋮ | V5-PlayerTools | drawn | visually reviewed | Android only |
| O15 | Ambient mode | screen state | `AmbientMode` | Player ⋮ | V5-PlayerTools | drawn | visually reviewed |  |
| O16 | Playing on another device | state | `ConnectRemotePlayer` | Connect | V5-PlayerTools, Components | drawn | visually reviewed | Remote mini player in Components |
| O17 | Library sort | sheet | `LibraryScreen sort` | Sort button | V5-Library | drawn | visually reviewed | Owner-approved planned app change: remember sort on Albums and Artists |
| O18 | Playlist order | sheet | `PlaylistDetailScreen sort` | Order button | V5-Playlist | drawn | visually reviewed |  |
| O19 | Playlist options | sheet | `PlaylistDetailScreen actions` | Playlist ⋮ | V5-Playlist | drawn | visually reviewed | Rename and Delete added (proposal) |
| O20 | Playlist long press | sheet | `PlaylistsScreen` | Long press a playlist | V5-PlaylistFlows | drawn | visually reviewed |  |
| O21 | Rename playlist | sheet | `PlaylistsScreen` | Playlist sheets | V5-PlaylistFlows | drawn | visually reviewed |  |
| O22 | Delete playlist | dialog | `ConfirmSheet` | Playlist sheets | V5-PlaylistFlows | drawn | visually reviewed |  |
| O23 | Remove from playlist | dialog → toast | `ConfirmSheet` | Song sheet | V5-Playlist | drawn | visually reviewed | Owner-approved planned app change: remove immediately with Undo |
| O24 | Add to playlist picker | sheet | `PlaylistSelectionModal` | Song sheets, player | V5-AddToPlaylist (2) | drawn | visually reviewed | Owner-approved planned app change: show playlist membership ticks |
| O25 | Downloads | sheet | `DownloadQueueModal` | Library header | V5-LibraryMore | drawn | visually reviewed | Stream’s DownloadsTray folds into the badge (proposal) |
| O26 | Languages for Luvs | sheet | `LanguagePickerModal` | Luvs | V5-Luvs | drawn | visually reviewed |  |
| O27 | Saved from Luvs | sheet | `LuvsVaultModal` | Luvs | V5-Luvs | drawn | visually reviewed | Title is a copy proposal |
| O28 | Add a list | sheet | `AddListSheet` | Stream | V5-Stream | drawn | visually reviewed |  |
| O29 | Voice search card | overlay | `VoiceSearchCard` | Mic | V5-Overlays (2) | drawn | visually reviewed | Mic in the search field (proposal) |
| O30 | About and updates | sheet | `AboutSheet, UpdatePanel` | Stream ✦, You | V5-Overlays | drawn | visually reviewed | Emoji in today’s copy |
| O31 | Play on this phone? | dialog | `ConnectNoticeHost` | Pick while remote | V5-Overlays | drawn | visually reviewed |  |
| O32 | LuvLink join request | overlay | `ListenTogetherHost` | Anywhere | V5-Stream | drawn | visually reviewed |  |
| O33 | Settings choice | sheet | `SettingsKit Choice` | Settings | V5-You | drawn | visually reviewed |  |
| O34 | First sync choice | sheet | `AllegraAccountSettings` | Sign in | V5-You | drawn | visually reviewed |  |
| O35 | Hidden songs | section | `SettingsScreen` | Settings, Library ⋮ | V5-You (2) | drawn | visually reviewed |  |
| O36 | DJ settings | sheet | `DjScreen provider` | Your DJ | V5-Tools | drawn | visually reviewed |  |
| O37 | Toasts | overlay | `Toast` | Results | Components, several | drawn | visually reviewed |  |
| O38 | Screen crashed | state | `ErrorBoundary` | Render error | V5-Overlays | drawn | visually reviewed | Copy proposal |
| O39 | ••• More menu | sheet | `MoreMenu` | Tab bar | V5-You (reference) | replaced | — | Owner-approved planned app change: replaced by the You tab |
| P1 | You tab | proposal | — | Tab | V5-You | drawn | visually reviewed | Owner-approved planned app change: replaces ••• |
| P2 | Library · Artists tab | proposal | `(ArtistOrbit filter today)` | Library tab | V5-LibraryMore | drawn | visually reviewed | Owner-approved planned app change |
| P3 | Library · Albums tab | proposal | `— (song.album exists)` | Library tab | V5-LibraryMore | drawn | visually reviewed | Owner-approved planned app change |
| P4 | Library ⋮ menu | proposal | — | Library header | V5-LibraryMore | drawn | visually reviewed |  |
| T1 | Loading | state-set | `RowPlaceholder` |  | Library, Stream, Search | drawn | visually reviewed |  |
| T2 | Empty | state-set | `EmptyState` |  | Library, Playlists, Playlist, Hidden songs, Blends | drawn | visually reviewed |  |
| T3 | Errors | state-set |  |  | Search, Stream, Artist, Now playing, Create, Blend join, Downloads | drawn | visually reviewed |  |
| T4 | Keyboard up | state-set |  |  | Search, New playlist, Rename, Edit song | drawn | visually reviewed |  |
| T5 | Small, short and large phones; 200% text | state-set |  |  | V5-Responsive | drawn | visually reviewed | Shell cost on 640-tall phones flagged |
| X1 | Android share sheet, photo picker, Cast, Equalizer, ringtone permission | out | `System UI` |  | — | not drawn | — | Android’s own screens |
| X2 | Home-screen widgets (Now playing, Playlist) | out | `src/widget` |  | — | not drawn | — | RemoteViews surface; separate round |
| X3 | Notification and lock-screen controls | out | `Media3 session` |  | — | not drawn | — | System media controls |
| X4 | System island | out | `android/.../island` |  | — | not drawn | — | Native overlay; separate round |
| X5 | Rescue screen, crash notice at next start | out | `RescueActivity, services/uiCrash` |  | — | not drawn | — | Native / rare; follows the error-state pattern |
| X6 | Frame-rate readout | out | `PerformanceHUD` |  | — | not drawn | — | Debug tool |
| X7 | Up next: empty queue | state | `UpNextPanel` |  | V5-NowPlaying | drawn | visually reviewed | V6: current song remains; one Find music action opens Search |
