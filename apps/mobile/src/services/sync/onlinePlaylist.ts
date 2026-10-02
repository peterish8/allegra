/**
 * Add a song the phone knows only by its ref (a streamed song, from Luvs or Stream) to a playlist.
 *
 * It is an online playlist item, kept in `playlist_online_songs` and synced to the account, like an online
 * like: adding a song to a playlist is not a download. The playlist then lists it beside any songs saved to
 * the phone (PlaylistDetailScreen merges both). The Liked songs playlist is the likes: adding there likes it.
 */
import type { SongSnapshot } from '@shared/songRef';

import { getOnlinePlaylistSongs, upsertOnlinePlaylistSong } from '../../database/syncQueries';
import { useOnlineLibraryStore } from '../../store/onlineLibraryStore';
import { usePlaylistStore } from '../../store/playlistStore';
import { record } from './LibrarySync';
import { toggleOnlineLike } from './onlineLike';
import { playlistItemOp } from './plan';

export type AddResult = 'added' | 'exists' | 'error';

export async function addOnlineSongToPlaylist(playlistId: string, song: SongSnapshot): Promise<AddResult> {
  try {
    const playlists = usePlaylistStore.getState();
    // The Liked songs playlist is the likes. Never un-like from here: adding is not toggling.
    if (playlistId === playlists.defaultPlaylistId) {
      if (useOnlineLibraryStore.getState().likedRefs.has(song.ref)) return 'exists';
      const result = await toggleOnlineLike(song);
      return result === 'liked' ? 'added' : 'error';
    }

    const already = await getOnlinePlaylistSongs(playlistId);
    if (already.some(row => row.ref === song.ref)) return 'exists';

    const at = Date.now();
    await upsertOnlinePlaylistSong(playlistId, { ...song, at });
    record(playlistItemOp(playlistId, song.ref, true, at, song));
    useOnlineLibraryStore.getState().bumpPlaylists();
    // The playlist's count (and cover) include its online songs.
    await playlists.fetchPlaylists();
    return 'added';
  } catch {
    return 'error';
  }
}
