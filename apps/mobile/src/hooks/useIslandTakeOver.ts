/**
 * @fileoverview "Continue here" on the island: another app (Spotify, YouTube Music, YouTube) is playing, and the
 * listener taps the island to carry the same song on in LuvLyrics. The song is found (services/takeOver/match),
 * started at the other app's position, lined up once more once it is audible, and then the other app is paused, so
 * the listener hears one continuous song.
 *
 * - The pick goes through the same routing as any pick (StreamService.playFromSearch → Connect), so while another
 *   device plays, the song goes there; the other app is still paused.
 * - A miss tells the island and opens its search drawer with the query typed in.
 *
 * Mounted once in RootNavigator, next to useIslandLibrary.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { UnifiedSong } from '../types/song';
import { playerControls, resumeNextLoadAt, usePlayerStore } from '../store/playerStore';
import { currentPlaybackRoute } from '../services/connect/playbackIntents';
import { searchOfficial } from '../services/stream/officialSearch';
import { StreamService } from '../services/stream/StreamService';
import { toStreamSong } from '../services/stream/streamSong';
import {
  onIslandTakeOver,
  pauseOutside,
  readOutsideNow,
  showTakeOverSearch,
  takeOverDone,
  type IslandTakeOver,
} from '../services/NativeDynamicIsland';
import { cleanOutside, pickTakeOver, takeOverQuery, type OutsideSong } from '../services/takeOver/match';
import { START_WAIT_MS, TAKE_OVER_BUDGET_MS, driftSeekS, handoverStartS } from '../services/takeOver/handover';
import { diag } from '../utils/diag';

const SEARCH_LIMIT = 8;
/** How far our position must move past where it was first seen playing to count as sound coming out. */
const AUDIBLE_STEP_S = 0.15;
const POLL_MS = 100;

/** True while [songId] is the loaded song and our player is set to play it. */
function isOurs(songId: string): boolean {
  const state = usePlayerStore.getState();
  return state.currentSongId === songId && state.loadedAudioId === songId && state.isPlaying;
}

/**
 * Waits until [songId] is loaded, playing and its position moves: on Android `isPlaying` follows playWhenReady,
 * which turns true before a stream has buffered, and pausing the other app then would leave a gap. Resolves true
 * once it moves; false after [timeoutMs] or an abort. The poll ends with the wait.
 */
function whenAudible(songId: string, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    const giveUpAt = Date.now() + timeoutMs;
    let from: number | null = null;
    const tick = setInterval(() => {
      if (signal.aborted || Date.now() > giveUpAt) {
        finish(false);
        return;
      }
      if (!isOurs(songId)) {
        return;
      }
      const at = playerControls.getPosition();
      if (from === null) {
        from = at;
      } else if (at > from + AUDIBLE_STEP_S) {
        finish(true);
      }
    }, POLL_MS);
    function finish(audible: boolean): void {
      clearInterval(tick);
      resolve(audible);
    }
  });
}

/**
 * Searches LuvLyrics for the song the other app plays. The search stops waiting on its slowest lookups after
 * TAKE_OVER_BUDGET_MS, or as soon as [signal] aborts (a newer tap).
 */
async function findOutsideSong(cleaned: OutsideSong, durationS: number, signal: AbortSignal): Promise<UnifiedSong | null> {
  const query = takeOverQuery(cleaned);
  if (!query) {
    return null;
  }
  const search = new AbortController();
  const stopSearch = (): void => search.abort();
  signal.addEventListener('abort', stopSearch);
  const budget = setTimeout(stopSearch, TAKE_OVER_BUDGET_MS);
  try {
    const results = await searchOfficial(query, SEARCH_LIMIT, undefined, search.signal)
      .catch((): UnifiedSong[] => []);
    return pickTakeOver(cleaned, durationS, results);
  } finally {
    clearTimeout(budget);
    signal.removeEventListener('abort', stopSearch);
  }
}

/** After our player plays: match the other app's moment (seek pattern: capture, seek, resume), then pause it. */
async function lineUpAndPause(packageName: string): Promise<void> {
  const outside = readOutsideNow(packageName);
  const target = driftSeekS(outside?.playing ? outside.positionS : null, playerControls.getPosition());
  if (target !== null) {
    const wasPlaying = usePlayerStore.getState().isPlaying;
    await playerControls.seekTo(target);
    if (wasPlaying) {
      usePlayerStore.getState().requestPlayback(true);
    }
  }
  pauseOutside(packageName);
}

/**
 * Plays [hit] in place of the other app. Returns false when our player never started, in which case the other app
 * is left playing.
 */
async function handOver(
  hit: UnifiedSong,
  take: IslandTakeOver,
  startedAt: number,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<boolean> {
  const songId = toStreamSong(hit).id;
  const route = await currentPlaybackRoute();
  if (!isCurrent()) {
    return true;
  }
  if (route.kind === 'remote') {
    // Another device plays through Connect: the song goes there, and the other app stops here.
    StreamService.playFromSearch(hit);
    pauseOutside(take.packageName);
    return true;
  }
  // The load seeks before it plays, so the song begins at the other app's moment, not at zero.
  resumeNextLoadAt(songId, handoverStartS(take.positionS, take.playing, (Date.now() - startedAt) / 1000));
  StreamService.playFromSearch(hit);
  const audible = await whenAudible(songId, START_WAIT_MS, signal);
  if (!isCurrent()) {
    return true;
  }
  if (audible) {
    await lineUpAndPause(take.packageName);
    return true;
  }
  if (isOurs(songId)) {
    // Still buffering at the deadline: ours is set to play, so the other app is paused without a line-up.
    pauseOutside(take.packageName);
    return true;
  }
  diag('takeover', `"${songId}" did not start`);
  return false;
}

/** One tap on "Continue here", from search to handover. [isCurrent] turns false once a newer tap takes over. */
async function takeOver(take: IslandTakeOver, signal: AbortSignal, isCurrent: () => boolean): Promise<void> {
  const startedAt = Date.now();
  const cleaned = cleanOutside(take);
  const query = takeOverQuery(cleaned);
  const hit = await findOutsideSong(cleaned, take.durationS, signal);
  if (!isCurrent()) {
    return;
  }
  if (!hit) {
    diag('takeover', `no match for "${query}"`);
    takeOverDone(false, 'Not found');
    if (query) {
      showTakeOverSearch(query);
    }
    return;
  }
  const started = await handOver(hit, take, startedAt, signal, isCurrent);
  if (isCurrent()) {
    takeOverDone(started, started ? 'Playing in LuvLyrics' : 'Could not start');
  }
}

/** Answers the island's "Continue here" taps for as long as the app runs (Android only). */
export function useIslandTakeOver(): void {
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    let run = 0;
    let abort: AbortController | null = null;
    const subscription = onIslandTakeOver(take => {
      // A newer tap takes over: the older one's lookups and waits stop.
      abort?.abort();
      const mine = ++run;
      const controller = new AbortController();
      abort = controller;
      takeOver(take, controller.signal, () => mine === run).catch(() => {
        if (mine === run) {
          takeOverDone(false, 'Not found');
        }
      });
    });
    return () => {
      run += 1;
      subscription.remove();
      abort?.abort();
    };
  }, []);
}
