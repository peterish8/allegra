/**
 * The mini player's ⊕ / ✓ (Spotify's saved mark): ticked once the song is in Liked songs or in any playlist.
 * Liked reads the heart's own state, so it flips the instant a like lands; playlists are read from the database
 * and again whenever a playlist changes (here or by sync).
 */
import { useEffect, useState } from 'react';

import { isInAnyPlaylist } from '../services/savedIn';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { usePlaylistStore } from '../store/playlistStore';
import { useSongsStore } from '../store/songsStore';
import { openSavedIn } from '../store/savedInStore';
import type { Song } from '../types/song';
import { isSongLikedNow, useSongLikeState } from './useIsSongLiked';

export function useSongSaved(song: Song | null | undefined): boolean {
  const { liked } = useSongLikeState(song);
  const playlistsChanged = usePlaylistStore(state => state.lastUpdate);
  const onlineChanged = useOnlineLibraryStore(state => state.playlistVersion);
  const [inPlaylist, setInPlaylist] = useState<{ id: string; held: boolean } | null>(null);

  useEffect(() => {
    if (!song) return;
    let current = true;
    isInAnyPlaylist(song).then(held => { if (current) setInPlaylist({ id: song.id, held }); }, () => undefined);
    return () => { current = false; };
    // The song's identity is its id; a refreshed copy of the same song must not re-query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id, playlistsChanged, onlineChanged]);

  return liked || (!!song && inPlaylist?.id === song.id && inPlaylist.held);
}

/**
 * The ⊕ / ✓ tap. Spotify's flow: ⊕ saves the song to Liked songs at once (the mark turns into a tick) and opens
 * "Saved in" so it can go into other playlists too; ✓ opens "Saved in" to change where it is saved.
 */
export function tapSaved(song: Song, saved: boolean): void {
  if (!saved && !isSongLikedNow(song)) {
    const like = useSongsStore.getState().toggleLike(song.id);
    openSavedIn(song, like);
    return;
  }
  openSavedIn(song);
}
