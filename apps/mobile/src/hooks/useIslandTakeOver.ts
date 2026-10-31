/**
 * Play here: "Play here" tapped on the island while another app (Spotify, YouTube Music, YouTube) plays. The song
 * is found in LuvLyrics (services/takeOver/match), started at the other app's position, lined up once more when it
 * plays, and then the other app is paused, so the listener hears one continuous song.
 * - The pick goes through the same routing as any pick (StreamService.playFromSearch → Connect), so while another
 *   device plays, the song goes there; the other app is still paused.
 * - A miss tells the island and opens its search drawer with the query typed in.
 * Mounted once in RootNavigator (next to useIslandLibrary).
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
import { cleanOutside, pickTakeOver, takeOverQuery } from '../services/takeOver/match';
import { START_WAIT_MS, TAKE_OVER_BUDGET_MS, driftSeekS, handoverStartS } from '../services/takeOver/handover';
import { diag } from '../utils/diag';

const SEARCH_LIMIT = 8;
/** How far our position must move past where it was first seen playing to count as sound coming out. */
const AUDIBLE_STEP_S = 0.15;
const POLL_MS = 100;

const isOurs = (songId: string): boolean => {
  const s = usePlayerStore.getState();
  return s.currentSongId === songId && s.loadedAudioId === songId && s.isPlaying;
};

/**
 * Waits until [songId] is loaded, playing and its position moves: on Android `isPlaying` follows playWhenReady,
 * which turns true before a stream has buffered, and pausing the other app then would leave a gap. True once it
 * moves; false after [timeoutMs] or an abort. The poll ends with the wait.
 */
function whenAudible(songId: string, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    const giveUpAt = Date.now() + timeoutMs;
    let from: number | null = null;
    const tick = setInterval(() => {
      if (signal.aborted || Date.now() > giveUpAt) return finish(false);
      if (!isOurs(songId)) return;
      const at = playerControls.getPosition();
      if (from === null) from = at;
      else if (at > from + AUDIBLE_STEP_S) finish(true);
    }, POLL_MS);
    function finish(ok: boolean) {
      clearInterval(tick);
      resolve(ok);
    }
  });
}

/** After our player plays: match the other app's moment (seek pattern: capture, seek, resume), then pause it. */
async function lineUpAndPause(packageName: string): Promise<void> {
  const outside = readOutsideNow(packageName);
  const target = driftSeekS(outside && outside.playing ? outside.positionS : null, playerControls.getPosition());
  if (target !== null) {
    const wasPlaying = usePlayerStore.getState().isPlaying;
    await playerControls.seekTo(target);
    if (wasPlaying) usePlayerStore.getState().requestPlayback(true);
  }
  pauseOutside(packageName);
}

async function takeOver(take: IslandTakeOver, signal: AbortSignal, isCurrent: () => boolean): Promise<void> {
  const startedAt = Date.now();
  const cleaned = cleanOutside(take);
  const query = takeOverQuery(cleaned);
  let hit: UnifiedSong | null = null;
  // The search stops waiting on its slowest lookups after the budget, or when a newer tap takes over.
  const search = new AbortController();
  const stopSearch = () => search.abort();
  signal.addEventListener('abort', stopSearch);
  const budget = setTimeout(stopSearch, TAKE_OVER_BUDGET_MS);
  try {
    const results = query ? await searchOfficial(query, SEARCH_LIMIT, undefined, search.signal).catch(() => [] as UnifiedSong[]) : [];
    hit = pickTakeOver(cleaned, take.durationS, results);
  } catch {
    hit = null;
  } finally {
    clearTimeout(budget);
    signal.removeEventListener('abort', stopSearch);
  }
  if (!isCurrent()) return;
  if (!hit) {
    diag('takeover', `no match for "${query}"`);
    takeOverDone(false, 'Not found');
    if (query) showTakeOverSearch(query);
    return;
  }

  const songId = toStreamSong(hit).id;
  const route = await currentPlaybackRoute();
  if (!isCurrent()) return;
  if (route.kind !== 'remote') {
    // The load seeks before it plays, so the song begins at the other app's moment, not at zero.
    resumeNextLoadAt(songId, handoverStartS(take.positionS, take.playing, (Date.now() - startedAt) / 1000));
  }
  StreamService.playFromSearch(hit);

  if (route.kind !== 'remote') {
    const audible = await whenAudible(songId, START_WAIT_MS, signal);
    if (!isCurrent()) return;
    if (audible) {
      await lineUpAndPause(take.packageName);
    } else if (isOurs(songId)) {
      // Still buffering at the deadline: ours is set to play, so the other app is paused without a line-up.
      pauseOutside(take.packageName);
    } else {
      // Ours did not start: leave the other app playing.
      diag('takeover', `"${songId}" did not start`);
      takeOverDone(false, 'Could not start');
      return;
    }
  } else {
    pauseOutside(take.packageName);
  }
  if (isCurrent()) takeOverDone(true, 'Playing in LuvLyrics');
}

export function useIslandTakeOver(): void {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let run = 0;
    let abort: AbortController | null = null;
    const sub = onIslandTakeOver(take => {
      // A newer tap takes over: the older one's lookups and waits stop.
      abort?.abort();
      const mine = ++run;
      const controller = new AbortController();
      abort = controller;
      takeOver(take, controller.signal, () => mine === run).catch(() => {
        if (mine === run) takeOverDone(false, 'Not found');
      });
    });
    return () => {
      run += 1;
      sub.remove();
      abort?.abort();
    };
  }, []);
}
