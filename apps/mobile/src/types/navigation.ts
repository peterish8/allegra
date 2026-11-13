/**
 * LyricFlow - Navigation Type Definitions
 */

import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PlayerMenuAction } from '../components/player/playerMenuAction';
import type { StatsRange } from '../services/stats/listeningStats';
import type { Song, UnifiedSong } from './song';
export type MixParams = { title: string } & ({ kind: 'stream'; songs: UnifiedSong[] } | { kind: 'local'; songs: Song[] });

// Root Stack Navigator
/** Sheets Now Playing can open straight away (deep links, invites). */
export type PlayerSheetName = 'menu' | 'together' | 'queue' | 'timer';

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined;
  /** `instant`: mounted already open, no rise (the app is opening out of the system island, which animates it). */
  NowPlaying: { songId: string; lyrics?: boolean; sheet?: PlayerSheetName; action?: PlayerMenuAction; instant?: boolean };
  /** Create or join a LuvLink room without needing a track in the player. */
  LuvLink: undefined;
  /** Lyrics editor for a song saved on the phone. */
  EditLyrics: { songId: string };
  LuvsVault: undefined; // Luvs liked songs vault
  CreatePlaylist: { playlistId?: string, initialName?: string } | undefined; // Create or Edit playlist modal
  AddToPlaylist: { songId?: string; playlistId?: string }; // NEW: Add song to playlist modal
  /** Scan a LuvLyrics code with the camera (Search → camera; 1.44.0). */
  ScanCode: undefined;
};

// Bottom Tab Navigator
export type TabParamList = {
  Stream: undefined; // catalog streaming + Echo-style home feed
  Luvs: undefined;
  Library: NavigatorScreenParams<LibraryStackParamList> | undefined; // Was Playlists
  Search: undefined; // replaced Settings in the tab bar
  You: undefined;
  // Pushed screens without a tab icon. They live in the tab navigator so the
  // bottom bar stays on screen, as in Spotify and Apple Music (see VISIBLE_TABS).
  Settings: { action?: 'import-phone' | 'hidden-songs' } | undefined;
  /** Listening stats (1.45.0), from the profile menu. */
  ListeningStats: undefined;
  /** Full Top artists / Top songs (1.48.0), from Listening stats; `weekStart` is the Monday of a finished week. */
  StatsTop: { kind: 'artists' | 'songs'; range: StatsRange; weekStart?: number };
  /** Swipeable insight cards (1.48.0), from Listening stats and Past weeks. */
  StatsInsights: { range: StatsRange; weekStart?: number };
  /** YouTube Music pages (artists, albums, playlists), stacked so back walks the trail. */
  Browse: NavigatorScreenParams<BrowseStackParamList> | undefined;
};

export type BrowseStackParamList = {
  QuickPicks: undefined;
  Mix: MixParams;
  /** By channel id, or by name (looked up on YouTube Music). */
  Artist: { browseId?: string; name?: string };
  CatalogAlbum: { id?: string; songRef?: string; album?: string; title?: string; artist?: string };
  ArtistReleases: { artistId: string; artistName: string; selected: number; categories: import('../services/ytmusic/browse').Shelf[] };
  Collection: { browseId: string; title?: string; thumbnail?: string };
};

/**
 * Stack nested inside the Library tab. PlaylistDetail lives here rather than on the
 * root stack so the tab bar and mini player stay on screen while you are inside a
 * playlist — a root-stack sibling covers the tab navigator entirely.
 */
export type LibraryStackParamList = {
  /** Your songs: the Downloads layout with the old Home's tools. */
  LibraryHome: undefined;
  Playlists: undefined;
  PlaylistDetail: { playlistId: string };
  Blends: undefined;
  Blend: { blendId: string };
  BlendJoin: { code: string };
  Import: undefined;
  /** Someone's public playlist, opened from a link or a scanned code (1.44.0). */
  SharedPlaylist: { code: string };
};

// Screen Props
export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;
