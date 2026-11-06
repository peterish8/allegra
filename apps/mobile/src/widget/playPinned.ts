/**
 * A pinned playlist tapped on the home-screen widget plays at once, without opening the app (1.41.0).
 *
 * The widget's click runs in the app's headless JS task: with the app closed there is no screen, so the Kotlin queue
 * engine is handed the playlist directly (it starts the playback service, which posts the media notification). With
 * the app alive the player store takes it, as a tap in the app would. Only songs with an address on this phone play,
 * so a downloaded playlist works with no connection.
 */
import type { Song } from '../types/song';

/** Songs this phone can play with no network: a file or content address. Streams need the app to resolve them. */
export const isPlayableOffline = (song: Pick<Song, 'audioUri'>): boolean =>
  typeof song.audioUri === 'string' && /^(file|content):/i.test(song.audioUri);

export interface PinnedPlayResult {
  ok: boolean;
  /** The song that starts, for the widget's next frame. */
  first?: Song;
  /** Why nothing played, as widget copy. */
  notice?: string;
}

/** What to play for a pinned playlist: its songs on this phone, in the playlist's order. */
export const pinnedQueue = (songs: readonly Song[]): Song[] => songs.filter(s => !s.isHidden && isPlayableOffline(s));

export const playPinnedPlaylist = async (playlistId: string, name: string): Promise<PinnedPlayResult> => {
  const { getPlaylistSongs } = await import('../database/playlistQueries');
  const songs = pinnedQueue(await getPlaylistSongs(playlistId).catch(() => [] as Song[]));
  if (songs.length === 0) return { ok: false, notice: `Download “${name}” to play it from here` };
  const { usePlayerStore, usesNativeQueue } = await import('../store/playerStore');
  if (usesNativeQueue()) {
    // The app is running: the store routes it (Connect included) and its screens follow.
    usePlayerStore.getState().setPlaylistQueue(playlistId, songs, 0);
    return { ok: true, first: songs[0] };
  }
  // Cold start in the headless task: the engine holds the queue; the app reads it back when it next opens.
  const { nativeQueue } = await import('../playback/nativeQueue');
  if (!nativeQueue.available()) return { ok: false, notice: 'Open LuvLyrics once, then try again' };
  const ok = await nativeQueue.setQueue(songs, 0, playlistId, true).catch(() => false);
  return ok ? { ok: true, first: songs[0] } : { ok: false, notice: 'Couldn’t start that playlist' };
};
