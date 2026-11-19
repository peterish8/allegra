/**
 * What the Playlists page shows, as plain rules (so they are tested without a screen).
 *
 * The two actions people reach for here, a new playlist and bringing one in from Spotify, sit in a row above the
 * list and are drawn in every state: with no playlists, a few, or hundreds, they are where the page starts, never
 * under the last card. The row is not the list's header component (a list header that changes size shifts the
 * recycled cells under it), it is a fixed row beside the list.
 */
import { PlaylistsStrings } from '../constants/uiStrings';

export type PlaylistsBody = 'placeholder' | 'empty' | 'grid';

/** Loading shows placeholders only until the first playlists arrive; then the grid or, with none, the empty state. */
export const playlistsBody = (isLoading: boolean, count: number): PlaylistsBody =>
  count > 0 ? 'grid' : isLoading ? 'placeholder' : 'empty';

/** What the ••• menu offers for playlists (Library's menu, and the Playlists page's own when it stands alone). */
export const PLAYLIST_MENU_ACTIONS = [
  { id: 'create', label: PlaylistsStrings.newPlaylist, icon: 'add' },
  { id: 'import', label: PlaylistsStrings.importFromSpotify, icon: 'cloud-download-outline' },
] as const;

export type PlaylistMenuActionId = (typeof PLAYLIST_MENU_ACTIONS)[number]['id'];

/** The playlists a search keeps (case-insensitive, by name); the quick row stays whatever was typed. */
export const filterPlaylists = <T extends { readonly name: string }>(playlists: readonly T[], query: string): T[] => {
  const needle = query.trim().toLowerCase();
  return needle ? playlists.filter(playlist => playlist.name.toLowerCase().includes(needle)) : [...playlists];
};
