/**
 * "Saved in" (Spotify's add-to-playlist sheet): which of the listener's playlists hold a song, and applying the
 * listener's edits to that set in one go when they press Done.
 *
 * A song on the phone is saved through its library row (playlist_songs; Liked songs goes through
 * `songsStore.toggleLike` so every heart and `isLiked` copy stays in step). A streamed song is saved without a
 * download, as online rows synced to the account (`onlineLike`, `onlinePlaylist`) — unless the library already
 * holds a copy, which then stands for it, as the heart does (`useSongLikeState`).
 */
import { toMobileId, type SongSnapshot } from '@shared/songRef';

import { getPlaylistIdsForSong } from '../database/playlistQueries';
import { getOnlinePlaylistIdsForRef } from '../database/syncQueries';
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

/** Whether the song is in Liked songs right now (the stores, which every like writes through). */
function likedNow(target: Target): boolean {
  return target.kind === 'library'
    ? usePlaylistStore.getState().likedSongIds.has(target.songId)
    : useOnlineLibraryStore.getState().likedRefs.has(target.snapshot.ref);
}

/** The playlists other than Liked songs that hold it: one read, whatever the number of playlists. */
async function playlistIdsFor(target: Target): Promise<string[]> {
  const ids = target.kind === 'library'
    ? await getPlaylistIdsForSong(target.songId)
    : await getOnlinePlaylistIdsForRef(target.snapshot.ref);
  const liked = usePlaylistStore.getState().defaultPlaylistId;
  return ids.filter(id => id !== liked);
}

/** The ids of the playlists (Liked songs included, by its id) that hold the song now. */
export async function loadSavedIn(song: Song): Promise<Set<string>> {
  const store = usePlaylistStore.getState();
  if (store.playlists.length === 0 || !store.defaultPlaylistId) await store.fetchPlaylists();
  const target = targetOf(song);
  if (!target) return new Set();
  const held = new Set(await playlistIdsFor(target));
  const liked = usePlaylistStore.getState().defaultPlaylistId;
  if (liked && likedNow(target)) held.add(liked);
  return held;
}

/**
 * Whether the song is in any playlist other than Liked songs (the mini player's tick; Liked comes from the heart's
 * own state). One indexed read per song change — never loads the playlists itself.
 */
export async function isInAnyPlaylist(song: Song): Promise<boolean> {
  const target = targetOf(song);
  return target ? (await playlistIdsFor(target)).length > 0 : false;
}

/**
 * Saves the edits. Returns false when any change failed (the ones that worked stay; the caller re-reads `before`
 * so a retry only redoes what didn't land). The Liked songs change goes first: it is the one the mini player's tick
 * reads, so it settles before the slower playlist writes.
 *
 * Liked is set to the state the listener chose, never toggled: the likes API is a toggle, so it is only called when
 * the song's live state differs. A retry or a second Done can therefore never un-like a song the first one liked.
 */
export async function applySavedIn(song: Song, before: ReadonlySet<string>, after: ReadonlySet<string>): Promise<boolean> {
  const target = targetOf(song);
  if (!target) return false;
  const { add, remove } = membershipChanges(before, after);
  const liked = usePlaylistStore.getState().defaultPlaylistId;
  let ok = true;

  if (liked !== null && likedNow(target) !== after.has(liked)) {
    const result = target.kind === 'library'
      ? await useSongsStore.getState().toggleLike(target.songId)
      : await toggleOnlineLike(target.snapshot);
    ok = result !== 'error';
  }

  const store = usePlaylistStore.getState();
  const results = await Promise.all([
    ...add.filter(id => id !== liked).map(async id => {
      if (target.kind === 'library') return store.addSongToPlaylist(id, target.songId).then(() => true, () => false);
      return (await addOnlineSongToPlaylist(id, target.snapshot)) !== 'error';
    }),
    ...remove.filter(id => id !== liked).map(async id => {
      if (target.kind === 'library') return store.removeSongFromPlaylist(id, target.songId).then(() => true, () => false);
      // The same ref the add and the membership read use (an `originId` can differ from the id's own).
      return removeOnlineFromPlaylist(id, toMobileId(target.snapshot.ref)).then(() => true, () => false);
    }),
  ]);
  if (target.kind === 'online' && remove.some(id => id !== liked)) await usePlaylistStore.getState().fetchPlaylists().catch(() => undefined);
  return ok && results.every(Boolean);
}
