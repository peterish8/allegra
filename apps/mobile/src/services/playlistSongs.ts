/**
 * Every song of a playlist as its page lists them: the songs on the phone, then the account's online-only songs
 * that no downloaded copy already stands for (Liked songs reads the online likes). Shared by places that play a
 * playlist outside its page (the system island).
 */
import type { Song } from '../types/song';
import { getPlaylistSongs } from '../database/playlistQueries';
import { getOnlinePlaylistSongs } from '../database/syncQueries';
import { LIKED_PLAYLIST_ID } from './sync/plan';
import { onlineRowToSong } from './sync/onlineSongs';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';

export async function loadPlaylistSongs(playlistId: string): Promise<Song[]> {
  const local = await getPlaylistSongs(playlistId).catch(() => [] as Song[]);
  const onlineRows = playlistId === LIKED_PLAYLIST_ID
    ? useOnlineLibraryStore.getState().likes
    : await getOnlinePlaylistSongs(playlistId).catch(() => []);
  const localIds = new Set(local.map(song => song.id));
  return [...local, ...onlineRows.map(onlineRowToSong).filter(song => !localIds.has(song.id))];
}
