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
import { AppState, Platform } from 'react-native';
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
  islandSearchRows,
  islandSongRow,
  isDownloadedSong,
  matchDownloads,
} from '../services/dynamicIslandSetup';

/** Changes come in bursts (a sync, a download finishing): one snapshot after they settle. */
const SNAPSHOT_DELAY_MS = 400;
const SEARCH_LIMIT = 12;
/** An island search stops waiting on its slowest lookups after this long and keeps what it found. */
const SEARCH_BUDGET_MS = 12_000;

/**
 * Runs [run] after [ms], or at once while the app is in the background: Android holds JavaScript's timers there
 * (the island is used from other apps), so a debounced snapshot would wait for the app to be opened again.
 */
function later(run: () => void, ms: number): () => void {
  if (AppState.currentState === 'active') {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  }
  let live = true;
  Promise.resolve().then(() => { if (live) run(); }).catch(() => undefined);
  return () => { live = false; };
}
/** The queue id the downloads play under: the Library's, so the queue behaves as it does from the Library. */
const DOWNLOADS_QUEUE_ID = 'library';

/** Every download, newest first: what a downloaded pick plays through, as the Library does. */
export const allDownloadedSongs = (songs: readonly Song[]): Song[] =>
  songs.filter(isDownloadedSong).sort((a, b) => (b.dateCreated ?? '').localeCompare(a.dateCreated ?? ''));

/** The downloads as the island lists them: the newest, enough for a quick pick. */
export const downloadedSongs = (songs: readonly Song[]): Song[] => allDownloadedSongs(songs).slice(0, ISLAND_DOWNLOADS);

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

/** Plays the download [songId] offline with the downloads queued round it. False when it is not a download. */
const playDownload = (songId: string): boolean => {
  const list = allDownloadedSongs(useSongsStore.getState().songs);
  const index = list.findIndex(song => song.id === songId);
  if (index < 0) return false;
  playFrom(DOWNLOADS_QUEUE_ID, list, index, false);
  return true;
};

export function useIslandLibrary(): void {
  const playlists = usePlaylistStore(state => state.playlists);
  const onlineVersion = useOnlineLibraryStore(state => state.playlistVersion + state.likes.length);
  const songs = useSongsStore(state => state.songs);
  const searchAnswers = useRef(new Map<string, UnifiedSong>());
  /** Each playlist's songs as last listed, so a pick starts at once instead of reading the library again. */
  const listed = useRef(new Map<string, Song[]>());

  // Playlists, with their songs.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let alive = true;
    const cancel = later(async () => {
      const lists = new Map<string, Song[]>();
      const rows = await Promise.all(playlists.map(async playlist => {
        const list = await loadPlaylistSongs(playlist.id).catch(() => [] as Song[]);
        lists.set(playlist.id, list);
        return {
          id: playlist.id,
          name: playlist.isDefault ? 'Liked songs' : playlist.name,
          cover: islandCover(playlist.coverImageUri) || islandSongRow(list[0] ?? { id: '' }).cover,
          count: list.length,
          songs: list.slice(0, ISLAND_PLAYLIST_SONGS).map(islandSongRow),
        };
      }));
      if (!alive) return;
      listed.current = lists;
      setIslandPlaylists(JSON.stringify(rows));
    }, SNAPSHOT_DELAY_MS);
    return () => { alive = false; cancel(); };
  }, [playlists, onlineVersion]);

  // Downloads.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    return later(() => setIslandDownloads(JSON.stringify(downloadedSongs(songs).map(islandSongRow))), SNAPSHOT_DELAY_MS);
  }, [songs]);

  // Picks and searches from the island.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let searchRun = 0;
    let searchAbort: AbortController | null = null;
    const picks = onIslandPick(async ({ playlistId, songId }) => {
      if (playlistId === ISLAND_LISTS.search) {
        // A downloaded answer plays from the phone, offline; an online one as a pick in Stream's search.
        if (playDownload(songId)) return;
        const song = searchAnswers.current.get(songId);
        if (song) StreamService.playFromSearch(song);
        return;
      }
      if (playlistId === ISLAND_LISTS.downloads) {
        playDownload(songId);
        return;
      }
      const cached = listed.current.get(playlistId);
      const list = cached?.some(song => song.id === songId) ? cached : await loadPlaylistSongs(playlistId);
      const index = list.findIndex(song => song.id === songId);
      if (index >= 0) playFrom(playlistId, list, index, true);
    });
    const searches = onIslandSearch(async query => {
      const run = ++searchRun;
      // A newer query takes over: the older one's lookups stop instead of competing with it for the network.
      searchAbort?.abort();
      const abort = new AbortController();
      searchAbort = abort;
      const budget = setTimeout(() => abort.abort(), SEARCH_BUDGET_MS);
      // Search is universal: the downloads (all of them, not only the island's list) and the catalogue online. The
      // island has already shown the downloads it knows; these join them, each song once.
      const local = matchDownloads(allDownloadedSongs(useSongsStore.getState().songs), query);
      const answers = new Map<string, UnifiedSong>();
      // Each online answer shows as soon as it is matched; one slow lookup no longer holds back the whole list.
      const send = (found: readonly UnifiedSong[], done: boolean) => {
        if (run !== searchRun) return;
        for (const song of found) answers.set(song.id, song);
        searchAnswers.current = answers;
        setIslandSearchResults(query, JSON.stringify(islandSearchRows(local, found)), done);
      };
      try {
        const found = query.trim()
          ? await searchOfficial(query, SEARCH_LIMIT, undefined, abort.signal, partial => send(partial, false))
            .catch(() => [] as UnifiedSong[])
          : [];
        send(found, true);
      } finally {
        clearTimeout(budget);
      }
    });
    return () => { picks.remove(); searches.remove(); searchAbort?.abort(); };
  }, []);
}
