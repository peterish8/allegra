import { useCallback, useEffect, useRef, useState } from 'react';

import type { UnifiedSong } from '@shared/types';

import { resolveApiUrl } from '../lib/api';
import { PlayheadStore, type Playhead } from '../lib/playhead';
import { nextInOrder, orderWithAppended, shuffledOrder, withUpcoming } from '../../../../packages/connect/src/index';
import { songIdentity, uniqueByIdentity } from '../lib/songIdentity';
import { clamp } from '../lib/utils';
import { activeWebSearchAttempt, hasSelectedPlaybackProgress, matchesSelectedPlaybackSource, webPerformanceTrace } from '../lib/performanceTrace';
import { isCurrentMediaGeneration, playbackRejectionMessage, shownAsPlaying, SOURCE_SWAP_TIMEOUT_MS, takeNextUnvisited, type RecoveryCursor } from '../lib/audioPlayerRules';
import { decidePrevious, manualNext, nextDistinct, reshuffleOrder, shufflePlayOrder } from '../lib/skipRules';

export type RepeatMode = 'off' | 'all' | 'one';

export interface AudioPlayerState {
  readonly currentSong: UnifiedSong | null;
  readonly queue: UnifiedSong[];
  readonly isPlaying: boolean;
  /** True only while the element is genuinely waiting on data it needs to keep playing. */
  readonly isBuffering: boolean;
  /** Seconds into the song. A store, not state: subscribe with `usePlayhead` where the time is drawn. */
  readonly playhead: Playhead;
  readonly duration: number;
  readonly isMuted: boolean;
  /** 0-1. Persisted per browser. */
  readonly volume: number;
  readonly shuffle: boolean;
  readonly shuffleOrder: readonly string[];
  readonly repeat: RepeatMode;
  readonly error: string | null;
  readonly selectSong: (song: UnifiedSong, queue?: UnifiedSong[]) => void;
  /** Connect transfer loader. Uses the same audio funnel but preserves paused restores. */
  readonly loadForConnect: (song: UnifiedSong, queue: UnifiedSong[], play: boolean) => void;
  /** Append similar/radio tracks without interrupting the current song. */
  readonly appendQueue: (songs: readonly UnifiedSong[]) => number;
  /** Replace what plays after the current song (remove, reorder, play next). The song playing is untouched. */
  readonly replaceUpcoming: (songs: readonly UnifiedSong[]) => void;
  readonly togglePlayback: () => void;
  readonly requestPlayback: (playing: boolean) => Promise<void>;
  readonly stop: () => void;
  readonly seek: (seconds: number) => Promise<void>;
  /** The song now playing, or null when nowhere distinct to go. */
  readonly skipNext: () => UnifiedSong | null;
  readonly skipPrevious: () => UnifiedSong | null;
  readonly toggleMute: () => void;
  readonly setVolume: (value: number) => void;
  readonly toggleShuffle: () => void;
  readonly cycleRepeat: () => void;
  /**
   * Swap the element source (e.g. original ↔ karaoke instrumental) while keeping
   * the same song identity, timestamp, and play/pause intent.
   */
  readonly swapAudioSource: (streamUrl: string) => Promise<boolean>;
  readonly audioRef: React.RefObject<HTMLAudioElement | null>;
}

export function useAudioPlayer(): AudioPlayerState {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentSongRef = useRef<UnifiedSong | null>(null);
  const queueRef = useRef<UnifiedSong[]>([]);
  const isPlayingRef = useRef(false);
  const pendingPlaybackRef = useRef(false);
  const playbackIntentRef = useRef(false);
  const playbackGenerationRef = useRef(0);
  const loadedGenerationRef = useRef(0);
  const loadedSongIdRef = useRef<string | null>(null);
  const expectedSourceRef = useRef<string | null>(null);
  const pendingCanPlayRef = useRef<(() => void) | null>(null);
  const autoAdvancedRef = useRef(false);
  const automaticRecoveryRef = useRef<RecoveryCursor | null>(null);
  const shuffleRef = useRef(false);
  const shuffleOrderRef = useRef<string[]>([]);
  const repeatRef = useRef<RepeatMode>('off');
  /** When set, the element plays this URL instead of currentSong.streamUrl. */
  const sourceOverrideRef = useRef<string | null>(null);
  const [currentSong, setCurrentSong] = useState<UnifiedSong | null>(null);
  const [queue, setQueue] = useState<UnifiedSong[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const playheadRef = useRef<PlayheadStore | null>(null);
  playheadRef.current ??= new PlayheadStore();
  const playhead = playheadRef.current;
  const setCurrentTime = playhead.set;
  const [duration, setDuration] = useState(0);
  const durationRef = useRef(0);
  durationRef.current = duration;
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolumeState] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem('allegra-volume'));
      return window.localStorage.getItem('allegra-volume') !== null && Number.isFinite(stored) ? clamp(stored, 0, 1) : 1;
    } catch {
      return 1;
    }
  });
  const [shuffle, setShuffle] = useState(false);
  const [shuffleOrder, setShuffleOrder] = useState<string[]>([]);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [error, setError] = useState<string | null>(null);

  const requestPlayback = useCallback(async (playing: boolean): Promise<void> => {
    playbackIntentRef.current = playing;
    const audio = audioRef.current;
    if (!audio || !currentSongRef.current) return;
    if (!playing) {
      audio.pause();
      // A pause asked for here is final. Its `pause` event may never come (nothing was playing yet)
      // or may be ignored as belonging to a source that has not loaded, so the state follows the
      // request instead of waiting for it.
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
      return;
    }
    const generation = playbackGenerationRef.current;
    try {
      await audio.play();
      if (generation !== playbackGenerationRef.current || !playbackIntentRef.current || !currentSongRef.current) {
        audio.pause();
        return;
      }
      setError(null);
    } catch (error: unknown) {
      if (generation !== playbackGenerationRef.current || !playbackIntentRef.current) return;
      const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
      // A newer pause, seek or load interrupted this request. That is not a failure, and the call
      // that interrupted it has its own outcome (a seek asks to play again straight away).
      if (name === 'AbortError') return;
      const attempt = activeWebSearchAttempt();
      if (attempt && matchesSelectedPlaybackSource(attempt, currentSongRef.current?.id ?? '')) {
        webPerformanceTrace?.finish(attempt, 'playback-failure');
      }
      setError(playbackRejectionMessage(name));
      // The browser refused: nothing is playing and nothing is waiting to, so the next tap plays
      // (and a later source switch does not start sound the listener never heard).
      playbackIntentRef.current = false;
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
    }
  }, []);

  /** Brings the shuffle order in line with a queue that was just replaced, so Next never points at a song that left it. */
  const syncShuffleOrder = useCallback((list: readonly UnifiedSong[], currentId: string): void => {
    if (!shuffleRef.current) return;
    shuffleOrderRef.current = reshuffleOrder(list.map((item) => item.id), currentId, shuffleOrderRef.current);
    setShuffleOrder([...shuffleOrderRef.current]);
  }, []);

  const selectSongWithIntent = useCallback((song: UnifiedSong, nextQueue: UnifiedSong[], shouldPlay: boolean, automatic = false): void => {
    if (!automatic) {
      automaticRecoveryRef.current = null;
      autoAdvancedRef.current = false;
    }
    const audio = audioRef.current;
    if (currentSongRef.current?.id === song.id && audio) {
      const next = uniqueByIdentity(nextQueue.length > 0 ? nextQueue : [song]);
      const withCurrent = next.some((item) => item.id === song.id) ? next : [song, ...next];
      queueRef.current = withCurrent;
      setQueue(withCurrent);
      // The same song picked inside another list (a playlist that holds it) replaces the queue but
      // not the shuffle order, which would then name songs that are gone.
      syncShuffleOrder(withCurrent, song.id);
      pendingPlaybackRef.current = shouldPlay;
      playbackIntentRef.current = shouldPlay;
      if (shouldPlay) void requestPlayback(true);
      else void requestPlayback(false);
      return;
    }
    sourceOverrideRef.current = null;
    const source = nextQueue.length > 0 ? nextQueue : [song];
    const withCurrent = source.some((item) => item.id === song.id) ? source : [song, ...source];
    // Collapse remasters (same title/artists, different cover/release id).
    const next = uniqueByIdentity(withCurrent);
    const playable = next.find((item) => item.id === song.id) ?? next.find((item) => songIdentity(item) === songIdentity(song)) ?? song;
    const ordered = next.some((item) => item.id === playable.id) ? next : [playable, ...next];
    syncShuffleOrder(ordered, playable.id);
    playbackGenerationRef.current += 1;
    currentSongRef.current = playable;
    queueRef.current = ordered;
    pendingPlaybackRef.current = shouldPlay;
    playbackIntentRef.current = shouldPlay;
    setCurrentSong(playable);
    setQueue(ordered);
    setCurrentTime(0);
    setDuration(playable.duration);
    setError(null);
  }, [requestPlayback, syncShuffleOrder]);

  const selectSong = useCallback((song: UnifiedSong, nextQueue: UnifiedSong[] = []): void => {
    selectSongWithIntent(song, nextQueue, true);
  }, [selectSongWithIntent]);

  const loadForConnect = useCallback((song: UnifiedSong, nextQueue: UnifiedSong[], play: boolean): void => {
    selectSongWithIntent(song, nextQueue, play);
  }, [selectSongWithIntent]);

  const seek = useCallback(async (seconds: number): Promise<void> => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = clamp(seconds, 0, Number.isFinite(audio.duration) ? audio.duration : duration);
    const wasPlaying = !audio.paused;
    audio.pause();
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
    if (wasPlaying) await requestPlayback(true);
  }, [duration, requestPlayback]);

  const appendQueue = useCallback((songs: readonly UnifiedSong[]): number => {
    if (songs.length === 0) return 0;
    const current = queueRef.current;
    const seenIds = new Set(current.map((item) => item.id));
    const seenIdentities = new Set(current.map((item) => songIdentity(item)));
    const added: UnifiedSong[] = [];
    for (const song of songs) {
      const identity = songIdentity(song);
      if (seenIds.has(song.id) || seenIdentities.has(identity)) continue;
      seenIds.add(song.id);
      seenIdentities.add(identity);
      added.push(song);
    }
    if (added.length === 0) return 0;
    const next = [...current, ...added];
    if (shuffleRef.current) {
      shuffleOrderRef.current = orderWithAppended(shuffleOrderRef.current, added.map((item) => item.id));
      setShuffleOrder([...shuffleOrderRef.current]);
    }
    if (automaticRecoveryRef.current) {
      automaticRecoveryRef.current = {
        ...automaticRecoveryRef.current,
        remaining: automaticRecoveryRef.current.remaining + added.length,
      };
    }
    queueRef.current = next;
    setQueue(next);
    return added.length;
  }, []);

  const replaceUpcoming = useCallback((songs: readonly UnifiedSong[]): void => {
    const current = currentSongRef.current;
    if (!current) return;
    const next = withUpcoming(queueRef.current, current, songs);
    if (shuffleRef.current) {
      const ids = next.map((item) => item.id);
      const retained = shuffleOrderRef.current.filter((id) => ids.includes(id));
      shuffleOrderRef.current = orderWithAppended(retained, ids.filter((id) => !retained.includes(id)));
      setShuffleOrder([...shuffleOrderRef.current]);
    }
    queueRef.current = next;
    setQueue(next);
  }, []);

  const advanceToNext = useCallback((afterLoadFailure = false): void => {
    const song = currentSongRef.current;
    const list = queueRef.current;
    if (!song || (autoAdvancedRef.current && !afterLoadFailure)) return;
    const audio = audioRef.current;
    if (repeatRef.current === 'one' && audio) {
      // Same song again, through the one playback funnel.
      automaticRecoveryRef.current = null;
      audio.currentTime = 0;
      void requestPlayback(true);
      return;
    }
    const index = list.findIndex((item) => item.id === song.id);
    const flow = automaticRecoveryRef.current ?? (afterLoadFailure ? null : {
      remaining: list.length - 1,
      visited: new Set([song.id]),
    });
    if (!flow || flow.remaining <= 0) {
      automaticRecoveryRef.current = null;
      autoAdvancedRef.current = true;
      setIsPlaying(false);
      if (afterLoadFailure) setError('This track could not be loaded. Try another song.');
      return;
    }
    const candidates: UnifiedSong[] = [];
    const wrap = repeatRef.current === 'all';
    if (shuffleRef.current && list.length > 1) {
      const order = shufflePlayOrder(list, shuffleOrderRef.current);
      const orderAt = order.indexOf(song.id);
      const limit = wrap ? order.length - 1 : Math.max(0, order.length - orderAt - 1);
      for (let step = 1; step <= limit; step += 1) {
        const id = orderAt >= 0 ? order[(orderAt + step) % order.length] : null;
        const candidate = id ? list.find((item) => item.id === id) : undefined;
        if (candidate && songIdentity(candidate) !== songIdentity(song)) candidates.push(candidate);
      }
    } else if (index >= 0) {
      const limit = wrap ? list.length - 1 : list.length - index - 1;
      for (let step = 1; step <= limit; step += 1) {
        const candidate = list[(index + step) % list.length];
        if (candidate && songIdentity(candidate) !== songIdentity(song)) candidates.push(candidate);
      }
    }
    const selection = takeNextUnvisited(candidates, flow);
    const next = selection.candidate;
    if (!next) {
      automaticRecoveryRef.current = null;
      autoAdvancedRef.current = true;
      setIsPlaying(false);
      if (afterLoadFailure) setError('This track could not be loaded. Try another song.');
      return;
    }
    automaticRecoveryRef.current = selection.cursor;
    autoAdvancedRef.current = true;
    selectSongWithIntent(next, list, true, true);
  }, [selectSongWithIntent, requestPlayback]);

  const skipNext = useCallback((): UnifiedSong | null => {
    const song = currentSongRef.current;
    const list = queueRef.current;
    if (!song) return null;
    automaticRecoveryRef.current = null;
    autoAdvancedRef.current = false;
    const next = manualNext({ list, current: song, shuffle: shuffleRef.current, shuffleOrder: shuffleOrderRef.current });
    if (!next) return null;
    selectSong(next, list);
    return next;
  }, [selectSong]);

  const skipPrevious = useCallback((): UnifiedSong | null => {
    const song = currentSongRef.current;
    if (!song || !audioRef.current) return null;
    const list = queueRef.current;
    // Where the selected song is, from the playhead: a song picked a moment ago is at 0 even while
    // the element still holds the previous source at its old position (a second press of
    // Previous from a media key must go back again, not restart a song that is not playing).
    const decision = decidePrevious({
      list,
      current: song,
      shuffle: shuffleRef.current,
      shuffleOrder: shuffleOrderRef.current,
      repeatAll: repeatRef.current === 'all',
      positionSec: playhead.get(),
    });
    automaticRecoveryRef.current = null;
    autoAdvancedRef.current = false;
    if (decision.kind === 'restart') {
      void seek(0);
      return null;
    }
    selectSong(decision.song, list);
    return decision.song;
  }, [playhead, selectSong, seek]);

  const stop = useCallback((): void => {
    playbackGenerationRef.current += 1;
    sourceOverrideRef.current = null;
    playbackIntentRef.current = false;
    pendingPlaybackRef.current = false;
    autoAdvancedRef.current = true;
    currentSongRef.current = null;
    queueRef.current = [];
    isPlayingRef.current = false;
    automaticRecoveryRef.current = null;
    shuffleOrderRef.current = [];

    const audio = audioRef.current;
    if (audio) {
      if (pendingCanPlayRef.current) {
        audio.removeEventListener('canplay', pendingCanPlayRef.current);
        pendingCanPlayRef.current = null;
      }
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    setCurrentSong(null);
    setQueue([]);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setIsBuffering(false);
    setError(null);
    setShuffleOrder([]);
  }, []);

  const swapAudioSource = useCallback(async (streamUrl: string): Promise<boolean> => {
    const audio = audioRef.current;
    const song = currentSongRef.current;
    if (!audio || !song) return false;
    const nextSrc = resolveApiUrl(streamUrl);
    if (audio.src === nextSrc || audio.getAttribute('src') === streamUrl) return true;

    const wasPlaying = playbackIntentRef.current;
    const resumeAt = audio.currentTime;

    /** Points the element at one source and waits for it. Each switch is its own generation. */
    const switchTo = async (url: string): Promise<'ready' | 'failed' | 'superseded'> => {
      playbackGenerationRef.current += 1;
      const generation = playbackGenerationRef.current;
      sourceOverrideRef.current = url === song.streamUrl ? null : url;
      audio.pause();
      setIsBuffering(true);
      audio.src = resolveApiUrl(url);
      loadedSongIdRef.current = song.id;
      expectedSourceRef.current = audio.src;
      audio.load();
      const ready = await waitForSourceReady(audio, SOURCE_SWAP_TIMEOUT_MS);
      if (generation !== playbackGenerationRef.current || currentSongRef.current?.id !== song.id) return 'superseded';
      return ready ? 'ready' : 'failed';
    };

    let outcome = await switchTo(streamUrl);
    if (outcome === 'superseded') return false;
    const switched = outcome === 'ready';
    if (!switched && streamUrl !== song.streamUrl) {
      // The new source would not open. Put the original back rather than leave a dead element.
      outcome = await switchTo(song.streamUrl);
      if (outcome === 'superseded') return false;
    }
    if (outcome === 'ready') {
      audio.currentTime = resumeAt;
      setCurrentTime(resumeAt);
      // The source that failed reported an error on its way out; the original is playable again.
      if (!switched) setError(null);
    }
    setIsBuffering(false);
    // The intent is read again here: a pause during the switch (it can take a while) must stay paused.
    if (wasPlaying && playbackIntentRef.current) await requestPlayback(true);
    return switched;
  }, [requestPlayback]);

  const setVolume = useCallback((value: number): void => {
    const audio = audioRef.current;
    const next = clamp(value, 0, 1);
    setVolumeState(next);
    try { window.localStorage.setItem('allegra-volume', String(next)); } catch { /* storage unavailable: volume just will not persist */ }
    if (!audio) return;
    audio.volume = next;
    // Dragging the slider up from silence is an explicit "I want to hear it".
    if (next > 0 && audio.muted) {
      audio.muted = false;
      setIsMuted(false);
    }
  }, []);

  const toggleShuffle = useCallback((): void => {
    shuffleRef.current = !shuffleRef.current;
    shuffleOrderRef.current = shuffleRef.current
      ? shuffledOrder(queueRef.current.map((item) => item.id), currentSongRef.current?.id ?? null)
      : [];
    setShuffleOrder([...shuffleOrderRef.current]);
    setShuffle(shuffleRef.current);
  }, []);

  const cycleRepeat = useCallback((): void => {
    repeatRef.current = repeatRef.current === 'off' ? 'all' : repeatRef.current === 'all' ? 'one' : 'off';
    setRepeat(repeatRef.current);
  }, []);

  const toggleMute = useCallback((): void => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(audio.muted);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const sourceIsSelected = (): boolean => {
      const expected = expectedSourceRef.current;
      return currentSongRef.current?.id === loadedSongIdRef.current
        && expected !== null
        && expected === audio.src
        && (!audio.currentSrc || audio.currentSrc === expected);
    };
    const sourceIsLoaded = (): boolean => isCurrentMediaGeneration({
      activeGeneration: playbackGenerationRef.current,
      loadedGeneration: loadedGenerationRef.current,
      activeSongId: currentSongRef.current?.id ?? null,
      loadedSongId: loadedSongIdRef.current,
      expectedSource: expectedSourceRef.current,
      currentSource: audio.currentSrc,
    });

    /**
     * The `play` and `pause` events of a fresh pick arrive before its metadata, while they are still
     * ignored as the previous source's, and are never repeated. Once the source is current the
     * element is asked what it is doing, so "playing" can never stay false over audible sound
     * (which left the button on Play and made Pause start the song again).
     */
    const syncPlaying = (): void => {
      const playing = shownAsPlaying({ paused: audio.paused, wantsPlay: playbackIntentRef.current, shown: isPlayingRef.current });
      if (playing === isPlayingRef.current) return;
      isPlayingRef.current = playing;
      setIsPlaying(playing);
    };

    audio.volume = volume;
    const onTimeUpdate = (): void => {
      if (!sourceIsLoaded()) return;
      const time = audio.currentTime;
      setCurrentTime(time);
      if (webPerformanceTrace && !audio.paused && !audio.seeking
        && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
        && !audio.muted && audio.volume > 0) {
        const attempt = activeWebSearchAttempt();
        const songId = currentSongRef.current?.id ?? '';
        if (hasSelectedPlaybackProgress(attempt, songId, time)
          && webPerformanceTrace.record(attempt, 'playback.observed')) {
          webPerformanceTrace.finish(attempt, 'success');
        }
      }
      // A timeupdate means the playhead moved, so any earlier stall is over.
      if (!audio.paused && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) setIsBuffering(false);
      // Some streams stop short of `ended`; move on when within a frame of the end.
      const length = Number.isFinite(audio.duration) ? audio.duration : durationRef.current;
      if (length > 0 && length - time <= 0.35 && isPlayingRef.current && !autoAdvancedRef.current) advanceToNext();
    };
    const onLoadedMetadata = (): void => {
      if (!sourceIsSelected()) return;
      loadedGenerationRef.current = playbackGenerationRef.current;
      autoAdvancedRef.current = false;
      const nextDuration = Number.isFinite(audio.duration) ? audio.duration : currentSongRef.current?.duration ?? 0;
      setDuration(nextDuration);
      syncPlaying();
    };
    const onPlay = (): void => {
      if (!sourceIsLoaded()) return;
      isPlayingRef.current = true;
      setIsPlaying(true);
      if (webPerformanceTrace) {
        const attempt = activeWebSearchAttempt();
        const songId = currentSongRef.current?.id ?? '';
        if (matchesSelectedPlaybackSource(attempt, songId)) webPerformanceTrace.record(attempt, 'media.play');
      }
    };
    const onPause = (): void => {
      if (!sourceIsLoaded()) return;
      // A seek pauses and plays again in one go, queueing both events: by the time this one runs
      // the element is playing again, and showing Pause -> Play for it would flicker the button,
      // the lock screen and Connect on every seek.
      if (!audio.paused) return;
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
      // The element stopped without the funnel asking (headset, system, end of the queue): nothing
      // is left wanting to play, so a later source switch does not start it again.
      playbackIntentRef.current = false;
    };
    const onEnded = (): void => { if (sourceIsLoaded()) advanceToNext(); };
    const onError = (): void => {
      if (!sourceIsSelected()) return;
      setIsBuffering(false);
      if (!currentSongRef.current) return;
      if (webPerformanceTrace) {
        const attempt = activeWebSearchAttempt();
        if (matchesSelectedPlaybackSource(attempt, currentSongRef.current.id)) {
          webPerformanceTrace.record(attempt, 'media.error');
          webPerformanceTrace.finish(attempt, 'playback-failure');
        }
      }
      if (automaticRecoveryRef.current) {
        advanceToNext(true);
        return;
      }
      setError('This track could not be loaded. Try another song.');
      isPlayingRef.current = false;
      setIsPlaying(false);
    };
    // `waiting` is the only honest signal that sound has stopped for lack of data.
    const onWaiting = (): void => {
      if (!sourceIsLoaded()) return;
      if (playbackIntentRef.current) setIsBuffering(true);
      if (webPerformanceTrace) {
        const attempt = activeWebSearchAttempt();
        const songId = currentSongRef.current?.id ?? '';
        if (matchesSelectedPlaybackSource(attempt, songId)) webPerformanceTrace.record(attempt, 'media.waiting');
      }
    };
    const onPlaying = (): void => {
      if (!sourceIsLoaded()) return;
      automaticRecoveryRef.current = null;
      setIsBuffering(false);
      syncPlaying();
      if (webPerformanceTrace) {
        const attempt = activeWebSearchAttempt();
        const songId = currentSongRef.current?.id ?? '';
        if (matchesSelectedPlaybackSource(attempt, songId)) webPerformanceTrace.record(attempt, 'media.playing');
      }
    };
    const onCanPlay = (): void => {
      if (!sourceIsLoaded()) return;
      setIsBuffering(false);
      if (webPerformanceTrace) {
        const attempt = activeWebSearchAttempt();
        const songId = currentSongRef.current?.id ?? '';
        if (matchesSelectedPlaybackSource(attempt, songId)) webPerformanceTrace.record(attempt, 'media.ready');
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('canplay', onCanPlay);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, [advanceToNext]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;
    if (pendingCanPlayRef.current) {
      audio.removeEventListener('canplay', pendingCanPlayRef.current);
      pendingCanPlayRef.current = null;
    }
    const generation = playbackGenerationRef.current;
    const songId = currentSong.id;
    let onCanPlay: (() => void) | null = null;
    audio.pause();
    audio.src = resolveApiUrl(sourceOverrideRef.current ?? currentSong.streamUrl);
    loadedSongIdRef.current = songId;
    expectedSourceRef.current = audio.src;
    audio.load();
    const shouldPlay = pendingPlaybackRef.current;
    pendingPlaybackRef.current = false;
    if (shouldPlay) {
      setIsBuffering(true);
      onCanPlay = (): void => {
        if (generation !== playbackGenerationRef.current || currentSongRef.current?.id !== songId || !playbackIntentRef.current) return;
        void requestPlayback(true);
      };
      pendingCanPlayRef.current = onCanPlay;
      audio.addEventListener('canplay', onCanPlay, { once: true });
      void requestPlayback(true);
    } else {
      // Loaded to stay paused (a transfer or room that decides when it starts). The previous song's
      // `pause` event is ignored as stale, so say here that nothing plays.
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
    }
    return () => {
      if (onCanPlay) audio.removeEventListener('canplay', onCanPlay);
      if (pendingCanPlayRef.current === onCanPlay) pendingCanPlayRef.current = null;
    };
  }, [currentSong, requestPlayback]);

  useEffect(() => {
    const stopOnPageExit = (): void => stop();
    window.addEventListener('pagehide', stopOnPageExit);
    window.addEventListener('beforeunload', stopOnPageExit);
    return () => {
      window.removeEventListener('pagehide', stopOnPageExit);
      window.removeEventListener('beforeunload', stopOnPageExit);
      stop();
    };
  }, [stop]);

  // No keyboard handler lives here. Space and the arrows are App's: it knows when another device
  // owns playback and sends the command there. A handler on the local element answered the same
  // keys a second time (arrows seeked 10 s, not 5) and, while another device played, started the
  // stale local song beside it.

  const togglePlayback = useCallback((): void => {
    void requestPlayback(!isPlayingRef.current);
  }, [requestPlayback]);

  return {
    currentSong,
    queue,
    isPlaying,
    isBuffering,
    playhead,
    duration,
    isMuted,
    volume,
    shuffle,
    shuffleOrder,
    repeat,
    error,
    selectSong,
    loadForConnect,
    appendQueue,
    replaceUpcoming,
    togglePlayback,
    requestPlayback,
    stop,
    seek,
    skipNext,
    skipPrevious,
    toggleMute,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    swapAudioSource,
    audioRef
  };
}

/**
 * The song that plays after `current` when it ends on its own, or null when it is the same song
 * (repeat one) or nothing follows.
 */
export function upcomingSong(
  list: readonly UnifiedSong[],
  current: UnifiedSong | null,
  shuffle: boolean,
  repeat: RepeatMode,
  currentShuffleOrder?: readonly string[]
): UnifiedSong | null {
  if (!current || repeat === 'one') return null;
  if (shuffle) {
    if (!currentShuffleOrder?.length) return null;
    const nextId = nextInOrder(shufflePlayOrder(list, currentShuffleOrder), current.id, repeat === 'all');
    return list.find((item) => item.id === nextId) ?? null;
  }
  return nextDistinct(list, list.findIndex((item) => item.id === current.id), current, repeat === 'all') ?? null;
}

/** Resolves true once the element has the metadata of the source it was just pointed at; false on an error or after `timeoutMs`. */
function waitForSourceReady(audio: HTMLAudioElement, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let timer = 0;
    const finish = (ready: boolean): void => {
      window.clearTimeout(timer);
      audio.removeEventListener('loadedmetadata', onReady);
      audio.removeEventListener('error', onFail);
      resolve(ready);
    };
    const onReady = (): void => finish(true);
    const onFail = (): void => finish(false);
    audio.addEventListener('loadedmetadata', onReady, { once: true });
    audio.addEventListener('error', onFail, { once: true });
    timer = window.setTimeout(() => finish(false), timeoutMs);
  });
}
