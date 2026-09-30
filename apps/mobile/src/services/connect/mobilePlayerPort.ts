import { fromMobileId, parseSongRef, type SongRef, type SongSnapshot } from '@shared/songRef';
import type { PlayerPort, PlayerSnapshot, RepeatMode } from '../../../../../packages/connect/src/index';

import { playerControls, prepareNextInQueue, usePlayerStore } from '../../store/playerStore';
import { usePlaybackModesStore } from '../../store/playbackModesStore';
import { usePositionStore } from '../../store/positionStore';
import { useSongsStore } from '../../store/songsStore';
import { positionSV } from '../../playback/positionBus';
import type { Song } from '../../types/song';
import { getAllegraSongById, matchConnectSong, matchQueue, toMobileSong, type SongMatcherDeps } from './songMatcher';
import { shuffleUpcoming } from '../player/playerMenuActions';

const clampPosition = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;

export function snapshotOfSong(song: Song | null | undefined): SongSnapshot | undefined {
  if (!song) return undefined;
  const ref = song.originId && parseSongRef(song.originId) ? song.originId as SongRef : fromMobileId(song.id);
  if (!ref) return undefined;
  return {
    ref,
    title: song.title || 'Unknown title',
    artist: song.artist || 'Unknown artist',
    ...(song.album ? { album: song.album } : {}),
    artwork: song.coverImageUri && /^https:\/\//i.test(song.coverImageUri) ? song.coverImageUri : '',
    duration: clampPosition(song.duration),
  };
}

function waitForLoadedSong(songId: string, timeoutMs: number): Promise<boolean> {
  const state = usePlayerStore.getState();
  if (state.currentSongId !== songId) return Promise.resolve(false);
  if (state.loadedAudioId === songId) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = (loaded: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(loaded);
    };
    const unsubscribe = usePlayerStore.subscribe(next => {
      if (next.currentSongId !== songId) finish(false);
      else if (next.loadedAudioId === songId) finish(true);
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
    const latest = usePlayerStore.getState();
    if (latest.currentSongId !== songId) finish(false);
    else if (latest.loadedAudioId === songId) finish(true);
  });
}

export function createMobilePlayerPort(getToken: () => string | null): PlayerPort {
  let volume = clampPosition(playerControls.getVolume());
  let originalOrder: Song[] | null = null;
  const matcher: SongMatcherDeps = {
    localSongs: () => useSongsStore.getState().songs,
    getCatalogSong: getAllegraSongById,
    searchCatalog: async query => {
      const { searchOfficial } = await import('../stream/officialSearch');
      return searchOfficial(query, 12);
    },
    token: getToken,
  };

  const getSnapshot = (): PlayerSnapshot => {
    const player = usePlayerStore.getState();
    const stateQueue = player.playlistQueue ?? [];
    const currentIndex = stateQueue.findIndex(song => song.id === player.currentSongId);
    const upcoming = currentIndex >= 0 ? stateQueue.slice(currentIndex + 1) : stateQueue.filter(song => song.id !== player.currentSongId);
    const currentSong = snapshotOfSong(player.currentSong);
    const livePosition = positionSV.value;
    return {
      ...(currentSong ? { song: currentSong } : {}),
      queue: upcoming.flatMap(song => {
        const snapshot = snapshotOfSong(song);
        return snapshot ? [snapshot] : [];
      }).slice(0, 50),
      isPlaying: player.isPlaying,
      positionSec: clampPosition(Number.isFinite(livePosition) ? livePosition : usePositionStore.getState().position),
      volume: clampPosition(Number.isFinite(playerControls.getVolume()) ? playerControls.getVolume() : volume),
      shuffle: usePlaybackModesStore.getState().shuffle,
      repeat: usePlaybackModesStore.getState().repeatMode,
    };
  };

  const waitForAudio = async (songId: string): Promise<boolean> => waitForLoadedSong(songId, 15_000);

  return {
    getSnapshot,
    onChange(listener) {
      const emit = (): void => listener(getSnapshot());
      const stopPlayer = usePlayerStore.subscribe(emit);
      const stopPosition = usePositionStore.subscribe(emit);
      const stopModes = usePlaybackModesStore.subscribe(emit);
      return () => { stopPlayer(); stopPosition(); stopModes(); };
    },
    async play() {
      usePlayerStore.getState().requestPlayback(true);
      return 'ok';
    },
    async pause() {
      usePlayerStore.getState().requestPlayback(false);
    },
    async seek(sec) {
      const wasPlaying = usePlayerStore.getState().isPlaying;
      await playerControls.seekTo(clampPosition(sec));
      if (wasPlaying) usePlayerStore.getState().requestPlayback(true);
    },
    async setVolume(next) {
      volume = Math.min(1, clampPosition(next));
      playerControls.setVolume(volume);
    },
    async load(snapshot, queue, options) {
      const matched = await matchConnectSong(snapshot, matcher);
      if (!matched) return 'not_found';
      const current = matched.kind === 'local' ? matched.song : toMobileSong(matched.song);
      if (!current.audioUri) return 'not_found';
      const rest = await matchQueue(queue, matcher);
      const store = usePlayerStore.getState();
      const alreadyLoaded = store.currentSongId === current.id && store.loadedAudioId === current.id;
      store.setPlaylistQueue('connect', [current, ...rest], 0, options.play);
      prepareNextInQueue();
      if (!alreadyLoaded && !(await waitForAudio(current.id))) return 'not_found';
      await this.seek(options.positionSec);
      usePlayerStore.getState().requestPlayback(options.play);
      return 'ok';
    },
    async next() {
      await usePlayerStore.getState().nextInPlaylist();
    },
    async previous() {
      usePlayerStore.getState().previousInPlaylist();
    },
    async setShuffle(on) {
      const modes = usePlaybackModesStore.getState();
      if (modes.shuffle === on) return;
      const store = usePlayerStore.getState();
      const queue = store.playlistQueue ?? [];
      const current = queue.findIndex(song => song.id === store.currentSongId);
      if (on) {
        originalOrder = queue.slice(current + 1);
        shuffleUpcoming();
      } else if (originalOrder) {
        const latest = usePlayerStore.getState();
        const currentQueue = latest.playlistQueue ?? [];
        const index = currentQueue.findIndex(song => song.id === latest.currentSongId);
        const prefix = currentQueue.slice(0, index + 1);
        const alreadyPlayed = new Set(prefix.map(song => song.id));
        const originalIds = new Set(originalOrder.map(song => song.id));
        const restored = originalOrder.filter(song => !alreadyPlayed.has(song.id));
        const additions = currentQueue.slice(index + 1).filter(song => !originalIds.has(song.id));
        latest.updateQueue([...prefix, ...restored, ...additions]);
        originalOrder = null;
      }
      usePlaybackModesStore.getState().setShuffle(on);
      prepareNextInQueue();
    },
    async setRepeat(mode: RepeatMode) {
      usePlaybackModesStore.getState().setRepeatMode(mode);
      prepareNextInQueue();
    },
    async addToQueue(snapshot) {
      const matched = await matchConnectSong(snapshot, matcher);
      if (!matched) return;
      const song = matched.kind === 'local' ? matched.song : toMobileSong(matched.song);
      const latest = usePlayerStore.getState();
      if (!latest.currentSong) return;
      const queue = latest.playlistQueue ?? [latest.currentSong];
      const index = Math.max(0, queue.findIndex(item => item.id === latest.currentSongId));
      latest.updateQueue([...queue.slice(0, index + 1), ...queue.slice(index + 1), song]);
      prepareNextInQueue();
    },
  };
}
