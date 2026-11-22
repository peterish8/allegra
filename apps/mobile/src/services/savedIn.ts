/**
 * "Saved in" (Spotify's add-to-playlist sheet): which of the listener's playlists hold a song, and applying the
 * listener's edits to that set in one go when they press Done.
 *
 * A song on the phone is saved through its library row (playlist_songs; Liked songs goes through
 * `songsStore.toggleLike` so every heart and `isLiked` copy stays in step). A streamed song is saved without a
 * download, as online rows synced to the account (`onlineLike`, `onlinePlaylist`) — unless the library already
 * holds a copy, which then stands for it, as the heart does (`useSongLikeState`).
 */
import type { SongSnapshot } from '@shared/songRef';

import * as playlistQueries from '../database/playlistQueries';
import { getOnlinePlaylistSongs } from '../database/syncQueries';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { usePlaylistStore } from '../store/playlistStore';
import { useSongsStore } from '../store/songsStore';
import type { Song } from '../types/song';
import { libraryLookup, matchKey } from '../utils/downloadState';
import { snapshotOfSong } from './connect/mobilePlayerPort';
import { membershipChanges } from './savedInChanges';
import { addOnlineSongToPlaylist } from './sync/onlinePlaylist';
import { toggleOnlineLike } from './sync/onlineLike';
import { removeOnlineFromPlaylist } from './sync/onlineSongs';

/** What a song is saved as: its library row, or (a stream with no copy here) its catalog ref. */
type Target =
  | { kind: 'library'; songId: string }
  | { kind: 'online'; songId: string; snapshot: SongSnapshot };

function targetOf(song: Song): Target | null {
  if (!song.id.startsWith('stream:')) return { kind: 'library', songId: song.id };
  const copy = libraryLookup(useSongsStore.getState().songs).get(matchKey(song.title, song.artist));
  if (copy) return { kind: 'library', songId: copy.id };
  const snapshot = snapshotOfSong(song);
  return snapshot ? { kind: 'online', songId: song.id, snapshot } : null;
}

/** Whether "Saved in" can save this song at all (a stream needs a catalog ref). */
export const canSaveIn = (song: Song): boolean => targetOf(song) !== null;

/** The ids of the playlists (Liked songs included, by its id) that hold the song now. */
export async function loadSavedIn(song: Song): Promise<Set<string>> {
  const store = usePlaylistStore.getState();
  if (store.playlists.length === 0 || !store.defaultPlaylistId) await store.fetchPlaylists();
  const { playlists, defaultPlaylistId, likedSongIds } = usePlaylistStore.getState();
  const target = targetOf(song);
  if (!target) return new Set();
  const held = await Promise.all(playlists.map(async playlist => {
    if (target.kind === 'library') {
      if (playlist.id === defaultPlaylistId) return likedSongIds.has(target.songId) ? playlist.id : null;
      return (await playlistQueries.isSongInPlaylist(playlist.id, target.songId)) ? playlist.id : null;
    }
    if (playlist.id === defaultPlaylistId) return useOnlineLibraryStore.getState().likedRefs.has(target.snapshot.ref) ? playlist.id : null;
    const rows = await getOnlinePlaylistSongs(playlist.id);
    return rows.some(row => row.ref === target.snapshot.ref) ? playlist.id : null;
  }));
  return new Set(held.filter((id): id is string => id !== null));
}

/** Whether the song is in any playlist other than Liked songs (the mini player's tick counts those too). */
export async function isInAnyPlaylist(song: Song): Promise<boolean> {
  const held = await loadSavedIn(song);
  const liked = usePlaylistStore.getState().defaultPlaylistId;
  return [...held].some(id => id !== liked);
}

/**
 * Saves the edits. Returns false when any change failed (the ones that worked stay). The Liked songs change goes
 * first: it is the one the mini player's tick reads, so it settles before the slower playlist writes.
 */
export async function applySavedIn(song: Song, before: ReadonlySet<string>, after: ReadonlySet<string>): Promise<boolean> {
  const target = targetOf(song);
  if (!target) return false;
  const { add, remove } = membershipChanges(before, after);
  const liked = usePlaylistStore.getState().defaultPlaylistId;
  const likeChange = liked !== null && (add.includes(liked) || remove.includes(liked));
  let ok = true;

  if (likeChange) {
    if (target.kind === 'library') ok = (await useSongsStore.getState().toggleLike(target.songId)) !== 'error' && ok;
    else ok = (await toggleOnlineLike(target.snapshot)) !== 'error' && ok;
  }

  const store = usePlaylistStore.getState();
  const results = await Promise.all([
    ...add.filter(id => id !== liked).map(async id => {
      if (target.kind === 'library') return store.addSongToPlaylist(id, target.songId).then(() => true, () => false);
      return (await addOnlineSongToPlaylist(id, target.snapshot)) !== 'error';
    }),
    ...remove.filter(id => id !== liked).map(async id => {
      if (target.kind === 'library') return store.removeSongFromPlaylist(id, target.songId).then(() => true, () => false);
      return removeOnlineFromPlaylist(id, target.songId).then(() => true, () => false);
    }),
  ]);
  if (target.kind === 'online' && remove.some(id => id !== liked)) await usePlaylistStore.getState().fetchPlaylists().catch(() => undefined);
  return ok && results.every(Boolean);
}
