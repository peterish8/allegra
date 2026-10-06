import { useCallback, useMemo, useRef } from 'react';

import type { ListenVerdict } from '@shared/listenSignal';
import { RadioSession, radioReasonLabel } from '@shared/radio';
import type { UnifiedSong } from '@shared/types';

import { fetchRadio, fetchSuggestions } from '../lib/api';
import { catalogSongId } from '../lib/songIdentity';

/** The slice of the audio player the radio drives. */
interface RadioTransport {
  readonly currentSong: UnifiedSong | null;
  readonly queue: readonly UnifiedSong[];
  appendQueue(songs: readonly UnifiedSong[]): number;
  replaceUpcoming(songs: readonly UnifiedSong[]): void;
}

/** Songs kept ready after the current one. */
const UPCOMING = 10;

/**
 * A song radio that re-ranks as the listener reacts (`packages/shared/radio.ts`). The catalog's
 * suggestions for the seed arrive first, so Next works within a second; the fuller pool (seed
 * artist, the listener's own artists, their taste) merges in when it lands. Songs the listener
 * queued themselves stay in front and are never re-ranked.
 */
export function useSongRadio(transportRef: { readonly current: RadioTransport }, userQueued: { readonly current: Set<string> }) {
  const session = useRef<RadioSession<UnifiedSong> | null>(null);
  const loading = useRef<Promise<void> | null>(null);
  const reasons = useRef(new Map<string, string>());
  const skipped = useRef(new Set<string>());
  /** Songs that started under this radio: only their endings teach it. */
  const heard = useRef(new Set<string>());

  const picks = useCallback((count: number, after: UnifiedSong | null, exclude: readonly string[]): UnifiedSong[] => {
    const radio = session.current;
    if (!radio) return [];
    return radio.next(count, { exclude, after }).map((pick) => {
      reasons.current.set(pick.song.id, radioReasonLabel(pick.reason));
      return pick.song;
    });
  }, []);

  /** Re-ranks everything after the listener's own picks. */
  const rerank = useCallback((): void => {
    const player = transportRef.current;
    const current = player.currentSong;
    if (!session.current || !current) return;
    const at = player.queue.findIndex((item) => item.id === current.id);
    const mine = (at >= 0 ? player.queue.slice(at + 1) : []).filter((item) => userQueued.current.has(item.id));
    const ranked = picks(UPCOMING, mine[mine.length - 1] ?? current, mine.map((item) => item.id));
    if (ranked.length > 0) player.replaceUpcoming([...mine, ...ranked]);
  }, [picks, transportRef, userQueued]);

  /**
   * Fetches candidates for `from`. Resolves as soon as one source added songs (the catalog's
   * suggestions are usually first, so Next works within a second); the fuller pool with the
   * listener's taste re-ranks the queue when it lands.
   */
  const load = useCallback((radio: RadioSession<UnifiedSong>, from: UnifiedSong, signal?: AbortSignal): Promise<void> => {
    const id = catalogSongId(from);
    const similar = fetchSuggestions(id, signal, 20).then((songs) => radio.add(songs, 'similar', from)).catch(() => 0);
    const pool = fetchRadio(id, signal).then(({ candidates, taste }) => {
      if (taste) radio.setTaste(taste);
      let added = 0;
      for (const source of ['similar', 'artist', 'taste'] as const) {
        added += radio.add(candidates.filter((candidate) => candidate.source === source).map((candidate) => candidate.song), source, from);
      }
      if (session.current === radio && !signal?.aborted) rerank();
      return added;
    }).catch(() => 0);
    return new Promise((resolve) => {
      let pending = 2;
      const settle = (added: number): void => {
        pending -= 1;
        if (added > 0 || pending === 0) resolve();
      };
      void similar.then(settle);
      void pool.then(settle);
    });
  }, [rerank]);

  /** Starts a fresh radio from `seed` (a search tap). */
  const start = useCallback((seed: UnifiedSong): void => {
    const radio = new RadioSession(seed);
    session.current = radio;
    reasons.current.clear();
    skipped.current.clear();
    heard.current = new Set([seed.id]);
    loading.current = load(radio, seed);
  }, [load]);

  /**
   * Tops the queue up to `UPCOMING` songs after the current one. Starts a radio from the playing
   * song when none is running (a Radio tap, a song handed over by Connect). Returns songs added.
   */
  const fill = useCallback(async (signal?: AbortSignal): Promise<number> => {
    const player = transportRef.current;
    const current = player.currentSong;
    if (!current) return 0;
    if (!session.current) start(current);
    const radio = session.current;
    if (!radio) return 0;
    await loading.current;
    if (signal?.aborted || session.current !== radio) return 0;
    if (radio.needsMore) {
      loading.current = load(radio, radio.refillSeed, signal);
      await loading.current;
      if (signal?.aborted || session.current !== radio) return 0;
    }
    const at = player.queue.findIndex((song) => song.id === current.id);
    const upcoming = at >= 0 ? player.queue.length - at - 1 : 0;
    return player.appendQueue(picks(Math.max(0, UPCOMING - upcoming), player.queue[player.queue.length - 1] ?? current, player.queue.map((song) => song.id)));
  }, [load, picks, start, transportRef]);

  /** How a song ended: the radio learns, and everything after the listener's own picks is re-ranked. */
  const outcome = useCallback((song: UnifiedSong, verdict: ListenVerdict): void => {
    const radio = session.current;
    if (!radio || !heard.current.has(song.id)) return;
    radio.record(song, verdict);
    if (verdict === 'early-skip' || verdict === 'instant-skip') skipped.current.add(song.id);
    rerank();
  }, [rerank]);

  /** A song started. Coming back to one skipped moments ago takes the skip back. */
  const started = useCallback((song: UnifiedSong): void => {
    const radio = session.current;
    if (!radio) return;
    if (skipped.current.delete(song.id)) radio.undoSkip(song);
    radio.markPlayed(song);
    heard.current.add(song.id);
  }, []);

  const love = useCallback((song: UnifiedSong): void => {
    if (!session.current) return;
    session.current.love(song);
    rerank();
  }, [rerank]);

  const stop = useCallback((): void => {
    session.current = null;
    loading.current = null;
  }, []);

  const reasonFor = useCallback((songId: string): string | undefined => (session.current ? reasons.current.get(songId) : undefined), []);

  return useMemo(() => ({ start, fill, outcome, started, love, stop, reasonFor }), [start, fill, outcome, started, love, stop, reasonFor]);
}
