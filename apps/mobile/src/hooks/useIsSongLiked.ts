import { usePlaylistStore } from '../store/playlistStore';
import { useSongsStore } from '../store/songsStore';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { libraryLookup, matchKey } from '../utils/downloadState';
import { canonicalSongRef } from '../utils/songIdentity';

export interface LikeState {
  /** Show the heart filled. */
  liked: boolean;
  /** Kept for callers; liking no longer downloads, so this is always false. */
  saving: boolean;
}

/**
 * The heart's state. For a song in the library the single source of truth is
 * playlistStore.likedSongIds (so it can't drift from the toggle path). A
 * streamed song has no row of its own: it counts as liked when its copy in the
 * library is, or when the stream identity (including a downloaded song's originId)
 * is liked online (onlineLibraryStore, synced with the account).
 */
export function useSongLikeState(song: { id: string; title: string; artist?: string; originId?: string } | null | undefined): LikeState {
  const id = song?.id;
  const stream = !!id && id.startsWith('stream:');
  const key = stream && song ? matchKey(song.title, song.artist) : null;

  const rowLiked = usePlaylistStore(state => (id ? state.likedSongIds.has(id) : false));
  const libraryId = useSongsStore(state => (key ? libraryLookup(state.songs).get(key)?.id : undefined));
  const libraryLiked = usePlaylistStore(state => (libraryId ? state.likedSongIds.has(libraryId) : false));
  // A downloaded stream keeps its catalog identity in originId. Use the same canonical
  // identity as Saved in so the heart reflects an online like for either representation.
  const ref = song ? canonicalSongRef(song.id, song) : null;
  const onlineLiked = useOnlineLibraryStore(state => (ref ? state.likedRefs.has(ref) : false));

  return { liked: rowLiked || libraryLiked || onlineLiked, saving: false };
}

/**
 * The heart's state read once, outside React: the same rules as `useSongLikeState`, for code that must not
 * toggle a like that is already there.
 */
export function isSongLikedNow(song: { id: string; title: string; artist?: string; originId?: string }): boolean {
  const liked = usePlaylistStore.getState().likedSongIds;
  if (liked.has(song.id)) {
    return true;
  }
  const stream = song.id.startsWith('stream:');
  const ref = canonicalSongRef(song.id, song);
  const libraryId = stream ? libraryLookup(useSongsStore.getState().songs).get(matchKey(song.title, song.artist))?.id : undefined;
  if (libraryId !== undefined && liked.has(libraryId)) {
    return true;
  }
  return ref !== null && useOnlineLibraryStore.getState().likedRefs.has(ref);
}

/** Whether a song is liked. Pass the song, not just its id, to get streamed songs right. */
export function useIsSongLiked(songId: string | undefined, song?: { title: string; artist?: string; originId?: string } | null): boolean {
  return useSongLikeState(songId && song ? { id: songId, title: song.title, artist: song.artist, originId: song.originId } : songId ? { id: songId, title: '' } : null).liked;
}
