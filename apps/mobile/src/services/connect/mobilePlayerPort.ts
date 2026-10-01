import { fromMobileId, parseSongRef, type SongRef, type SongSnapshot } from '@shared/songRef';
import {
  createQueueStager, QUEUE_LIMIT, reportable, traceCatalogLookup, upcomingOf, withUpcoming,
  type DevelopmentTraceBuffer, type PlayerPort, type PlayerSnapshot, type RepeatMode,
} from '../../../../../packages/connect/src/index';

import { playerControls, prepareNextInQueue, usePlayerStore } from '../../store/playerStore';
import { usePlaybackModesStore } from '../../store/playbackModesStore';
import { usePositionStore } from '../../store/positionStore';
import { useSongsStore } from '../../store/songsStore';
import { positionSV } from '../../playback/positionBus';
import type { Song } from '../../types/song';
import { getAllegraSongById, matchConnectSong, matchEach, toMobileSong, type MatchedSong, type SongMatcherDeps } from './songMatcher';
import { shuffleUpcoming } from '../player/playerMenuActions';

const clampPosition = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;
const notFound = (): Error => Object.assign(new Error('That song could not be loaded.'), { data: { code: 'not_found' } });

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

export function createMobilePlayerPort(getToken: () => string | null, trace?: DevelopmentTraceBuffer): PlayerPort {
  let volume = clampPosition(playerControls.getVolume());
  let originalOrder: Song[] | null = null;
  let loadGeneration = 0;
  const listeners = new Set<(snapshot: PlayerSnapshot) => void>();
  /**
   * A song matched for another device keeps the ref it was asked for. A download made before
   * origins were recorded has no ref of its own, and would otherwise drop out of the shared state.
   */
  const aliases = new Map<string, SongSnapshot>();
  const shared = (song: Song | null | undefined): SongSnapshot | undefined =>
    song ? aliases.get(song.id) ?? snapshotOfSong(song) : undefined;
  const adopt = (snapshot: SongSnapshot, matched: MatchedSong): Song => {
    const song = matched.kind === 'local' ? matched.song : toMobileSong(matched.song);
    if (snapshotOfSong(song)?.ref !== snapshot.ref) {
      if (aliases.size >= 400) {
        const queued = new Set((usePlayerStore.getState().playlistQueue ?? []).map(item => item.id));
        for (const id of aliases.keys()) if (!queued.has(id)) aliases.delete(id);
      }
      aliases.set(song.id, snapshot);
    }
    return song;
  };
  const matcher: SongMatcherDeps = {
    localSongs: () => useSongsStore.getState().songs,
    getCatalogSong: (ref, token) => traceCatalogLookup(trace, () => getAllegraSongById(ref, token)),
    searchCatalog: async query => {
      const { searchOfficial } = await import('../stream/officialSearch');
      return traceCatalogLookup(trace, () => searchOfficial(query, 12));
    },
    token: getToken,
  };

  /** The player's queue as the stager reads it: the store, which is written and read at once. */
  const queuePlayer = () => {
    const store = usePlayerStore.getState();
    const queue = store.playlistQueue ?? (store.currentSong ? [store.currentSong] : []);
    return {
      currentSong: queue.find(song => song.id === store.currentSongId) ?? store.currentSong,
      queue,
      replaceUpcoming(songs: readonly Song[]): void {
        const latest = usePlayerStore.getState();
        if (!latest.currentSong) return;
        const list = latest.playlistQueue ?? [latest.currentSong];
        const current = list.find(song => song.id === latest.currentSongId) ?? latest.currentSong;
        latest.updateQueue(withUpcoming(list, current, songs));
        // Media3 may already have staged the old "next" for gapless advance.
        prepareNextInQueue();
      },
    };
  };

  const getSnapshot = (): PlayerSnapshot => {
    const player = usePlayerStore.getState();
    const currentSong = shared(player.currentSong);
    const livePosition = positionSV.value;
    const upcoming = reportable(upcomingOf(queuePlayer()), song => shared(song) ?? null);
    return {
      ...(currentSong ? { song: currentSong } : {}),
      queue: stager.report(currentSong, upcoming),
      isPlaying: player.isPlaying,
      positionSec: clampPosition(Number.isFinite(livePosition) ? livePosition : usePositionStore.getState().position),
      volume: clampPosition(Number.isFinite(playerControls.getVolume()) ? playerControls.getVolume() : volume),
      shuffle: usePlaybackModesStore.getState().shuffle,
      repeat: usePlaybackModesStore.getState().repeatMode,
    };
  };

  const waitForAudio = async (songId: string): Promise<boolean> => waitForLoadedSong(songId, 15_000);

  // Queue edits, transfers and play-next all hand the player its queue through this: songs it
  // holds move at once, a new one joins when its lookup lands (packages/connect queueStager).
  const stager = createQueueStager<Song>({
    player: queuePlayer,
    snapshotOf: song => shared(song) ?? null,
    lookup: async (missing, isCurrent) => {
      const matches = await matchEach(missing, matcher, 2, isCurrent);
      return matches.flatMap((matched, index) => matched ? [adopt(missing[index], matched)] : []);
    },
    onChange: () => {
      const snapshot = getSnapshot();
      for (const listener of [...listeners]) listener(snapshot);
    },
  });

  return {
    getSnapshot,
    onChange(listener) {
      const emit = (): void => listener(getSnapshot());
      listeners.add(listener);
      const stopPlayer = usePlayerStore.subscribe(emit);
      const stopPosition = usePositionStore.subscribe(emit);
      const stopModes = usePlaybackModesStore.subscribe(emit);
      return () => { listeners.delete(listener); stopPlayer(); stopPosition(); stopModes(); };
    },
    async play() {
      usePlayerStore.getState().requestPlayback(true);
      return 'ok';
    },
    async pause() {
      usePlayerStore.getState().requestPlayback(false);
      const paused = (): boolean => !usePlayerStore.getState().isPlaying;
      if (paused()) return;
      await new Promise<void>(resolve => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout>;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubscribe();
          resolve();
        };
        const unsubscribe = usePlayerStore.subscribe(() => { if (paused()) finish(); });
        timer = setTimeout(finish, 1500);
        if (paused()) finish();
      });
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
      const generation = ++loadGeneration;
      const queueSnapshots = queue.slice(0, QUEUE_LIMIT);
      stager.expect(snapshot.ref, queueSnapshots);
      const matched = await matchConnectSong(snapshot, matcher);
      if (generation !== loadGeneration) return 'not_found';
      const current = matched ? adopt(snapshot, matched) : null;
      if (!current?.audioUri) {
        // The song that was playing stays: the queue asked for with the new one does not apply to it.
        stager.reset();
        return 'not_found';
      }
      const store = usePlayerStore.getState();
      const alreadyLoaded = store.currentSongId === current.id && store.loadedAudioId === current.id;
      store.setPlaylistQueue('connect', [current], 0, false);
      prepareNextInQueue();
      if (!alreadyLoaded && !(await waitForAudio(current.id))) return 'not_found';
      if (generation !== loadGeneration) return 'not_found';
      await this.seek(options.positionSec);
      usePlayerStore.getState().requestPlayback(options.play);
      stager.stage(queueSnapshots).catch(() => undefined);
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
      const before = getSnapshot();
      if (!before.song) throw notFound();
      const lost = await stager.stage([...before.queue, snapshot]);
      if (lost.includes(snapshot.ref)) throw notFound();
    },
    async setQueue(queue) {
      stager.stage(queue).catch(() => undefined);
    },
    dispose() {
      loadGeneration += 1;
      stager.reset();
      listeners.clear();
      originalOrder = null;
      aliases.clear();
    },
  };
}
