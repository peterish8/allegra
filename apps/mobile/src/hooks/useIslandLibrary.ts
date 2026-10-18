/**
 * Hands the system island (Android) what it lists, and answers what is picked or searched in it. The island is
 * native and draws its own lists; JavaScript only sends snapshots when something changes and plays what the
 * listener taps, the way the app's own screens do:
 * - a playlist song plays as the playlist page plays it (online songs resolved, Connect routing kept),
 * - a download plays from the downloads, offline, with the lyrics saved with it,
 * - a search answer plays like a pick in Stream's search: similar songs queue up after it.
 * Mounted once in RootNavigator.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { Song, UnifiedSong } from '../types/song';
import { usePlaylistStore } from '../store/playlistStore';
import { useSongsStore } from '../store/songsStore';
import { usePlayerStore } from '../store/playerStore';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { routeSongPick } from '../services/connect/playbackIntents';
import { loadPlaylistSongs } from '../services/playlistSongs';
import { playList } from '../services/sync/onlineSongs';
import { searchOfficial } from '../services/stream/officialSearch';
import { StreamService } from '../services/stream/StreamService';
import {
  ISLAND_LISTS,
  onIslandPick,
  onIslandSearch,
  setIslandDownloads,
  setIslandPlaylists,
  setIslandSearchResults,
} from '../services/NativeDynamicIsland';
import {
  ISLAND_DOWNLOADS,
  ISLAND_PLAYLIST_SONGS,
  islandCover,
  islandSongRow,
  isDownloadedSong,
} from '../services/dynamicIslandSetup';

/** Changes come in bursts (a sync, a download finishing): one snapshot after they settle. */
const SNAPSHOT_DELAY_MS = 400;
const SEARCH_LIMIT = 12;
/** The queue id the downloads play under: the Library's, so the queue behaves as it does from the Library. */
const DOWNLOADS_QUEUE_ID = 'library';

/** The downloads, newest first, as the island lists them (and as a pick indexes them). */
export const downloadedSongs = (songs: readonly Song[]): Song[] =>
  songs
    .filter(isDownloadedSong)
    .sort((a, b) => (b.dateCreated ?? '').localeCompare(a.dateCreated ?? ''))
    .slice(0, ISLAND_DOWNLOADS);

/** Plays [songs] from [index], or resumes it when it is the phone's own paused song (or sends it where music plays). */
const playFrom = (playlistId: string, songs: Song[], index: number, online: boolean) => {
  const player = usePlayerStore.getState();
  if (player.currentSongId === songs[index].id) {
    if (!routeSongPick({ playlistId, songs, startIndex: index })) player.requestPlayback(true);
    return;
  }
  if (online) playList(playlistId, songs, index).catch(() => undefined);
  else player.setPlaylistQueue(playlistId, songs, index);
};

export function useIslandLibrary(): void {
  const playlists = usePlaylistStore(state => state.playlists);
  const onlineVersion = useOnlineLibraryStore(state => state.playlistVersion + state.likes.length);
  const songs = useSongsStore(state => state.songs);
  const searchAnswers = useRef(new Map<string, UnifiedSong>());

  // Playlists, with their songs.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let alive = true;
    const timer = setTimeout(async () => {
      const rows = await Promise.all(playlists.map(async playlist => {
        const list = await loadPlaylistSongs(playlist.id).catch(() => [] as Song[]);
        return {
          id: playlist.id,
          name: playlist.isDefault ? 'Liked songs' : playlist.name,
          cover: islandCover(playlist.coverImageUri) || islandSongRow(list[0] ?? { id: '' }).cover,
          count: list.length,
          songs: list.slice(0, ISLAND_PLAYLIST_SONGS).map(islandSongRow),
        };
      }));
      if (alive) setIslandPlaylists(JSON.stringify(rows));
    }, SNAPSHOT_DELAY_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [playlists, onlineVersion]);

  // Downloads.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const timer = setTimeout(() => setIslandDownloads(JSON.stringify(downloadedSongs(songs).map(islandSongRow))), SNAPSHOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [songs]);

  // Picks and searches from the island.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let searchRun = 0;
    const picks = onIslandPick(async ({ playlistId, songId }) => {
      if (playlistId === ISLAND_LISTS.search) {
        const song = searchAnswers.current.get(songId);
        if (song) StreamService.playFromSearch(song);
        return;
      }
      if (playlistId === ISLAND_LISTS.downloads) {
        const list = downloadedSongs(useSongsStore.getState().songs);
        const index = list.findIndex(song => song.id === songId);
        if (index >= 0) playFrom(DOWNLOADS_QUEUE_ID, list, index, false);
        return;
      }
      const list = await loadPlaylistSongs(playlistId);
      const index = list.findIndex(song => song.id === songId);
      if (index >= 0) playFrom(playlistId, list, index, true);
    });
    const searches = onIslandSearch(async query => {
      const run = ++searchRun;
      const found = query.trim() ? await searchOfficial(query, SEARCH_LIMIT).catch(() => [] as UnifiedSong[]) : [];
      if (run !== searchRun) return;
      searchAnswers.current = new Map(found.map(song => [song.id, song]));
      const rows = found.map(song => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        cover: islandCover(song.highResArt) || islandCover(song.thumbnail),
      }));
      setIslandSearchResults(query, JSON.stringify(rows));
    });
    return () => { picks.remove(); searches.remove(); };
  }, []);
}
