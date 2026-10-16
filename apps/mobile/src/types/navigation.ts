/**
 * LyricFlow - Navigation Type Definitions
 */

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';

// Root Stack Navigator
/** Sheets Now Playing can open straight away (deep links, invites). */
export type PlayerSheetName = 'menu' | 'together' | 'queue' | 'timer';

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined;
  NowPlaying: { songId: string; lyrics?: boolean; sheet?: PlayerSheetName };
  /** Create or join a LuvLink room without needing a track in the player. */
  LuvLink: undefined;
  /** Lyrics editor for a song saved on the phone. */
  EditLyrics: { songId: string };
  LuvsVault: undefined; // Luvs liked songs vault
  CreatePlaylist: { playlistId?: string, initialName?: string } | undefined; // Create or Edit playlist modal
  AddToPlaylist: { songId?: string; playlistId?: string }; // NEW: Add song to playlist modal
};

// Bottom Tab Navigator
export type TabParamList = {
  Stream: undefined; // catalog streaming + Echo-style home feed
  Luvs: undefined;
  Library: NavigatorScreenParams<LibraryStackParamList> | undefined; // Was Playlists
  Search: undefined; // replaced Settings in the tab bar
  Dj: undefined;
  // Pushed screens without a tab icon. They live in the tab navigator so the
  // bottom bar stays on screen, as in Spotify and Apple Music (see VISIBLE_TABS).
  Settings: undefined;
  /** YouTube Music pages (artists, albums, playlists), stacked so back walks the trail. */
  Browse: NavigatorScreenParams<BrowseStackParamList> | undefined;
};

export type BrowseStackParamList = {
  /** By channel id, or by name (looked up on YouTube Music). */
  Artist: { browseId?: string; name?: string };
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
};

// Screen Props
export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;
