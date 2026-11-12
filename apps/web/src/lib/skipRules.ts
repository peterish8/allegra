import type { UnifiedSong } from '@shared/types';

import { nextInOrder, orderWithAppended, previousAction, previousInOrder, shuffledOrder } from '../../../../packages/connect/src/queueRules.ts';
import { songIdentity } from './songIdentity';

/**
 * Where the Next and Previous buttons, the media keys and the lock screen go. Pure: the player
 * hook reads its refs and asks here, so the rules can be tested without a browser.
 */

export type QueueSong = Pick<UnifiedSong, 'id' | 'title' | 'artist'>;

export interface SkipInput<S extends QueueSong> {
  /** The whole queue, played songs included. */
  readonly list: readonly S[];
  readonly current: S;
  readonly shuffle: boolean;
  readonly shuffleOrder: readonly string[];
}

/**
 * The order Next and Previous walk while shuffle is on: the saved order trimmed to the songs still
 * queued, with any song it has not met at the end. A saved order that lags the queue (a song added
 * or swapped out since) must never point Next at a song that is no longer there.
 */
export function shufflePlayOrder(list: readonly QueueSong[], saved: readonly string[]): string[] {
  const queued = new Set(list.map((item) => item.id));
  return orderWithAppended(saved.filter((id) => queued.has(id)), list.map((item) => item.id));
}

/** A new shuffle order after the queue changed: kept if it still holds the current song, otherwise dealt again. */
export function reshuffleOrder(
  ids: readonly string[],
  currentId: string,
  saved: readonly string[],
  random: () => number = Math.random
): string[] {
  const queued = new Set(ids);
  const kept = saved.filter((id) => queued.has(id));
  return kept.length === 0 || !kept.includes(currentId)
    ? shuffledOrder(ids, currentId, random)
    : orderWithAppended(kept, ids);
}

/** The next song after `index` that is not a remaster of `current`; `wrap` carries on from the top. */
export function nextDistinct<S extends QueueSong>(
  list: readonly S[],
  index: number,
  current: S,
  wrap: boolean
): S | undefined {
  const key = songIdentity(current);
  const usable = (candidate: S | undefined): candidate is S =>
    candidate !== undefined && candidate.id !== current.id && songIdentity(candidate) !== key;
  const start = index >= 0 ? index : -1;
  for (let at = start + 1; at < list.length; at += 1) {
    const candidate = list[at];
    if (usable(candidate)) return candidate;
  }
  if (!wrap) return undefined;
  for (let at = 0; at < start; at += 1) {
    const candidate = list[at];
    if (usable(candidate)) return candidate;
  }
  return undefined;
}

/** The song before `index` that is not a remaster of `current`; `wrap` carries on from the bottom. */
export function previousDistinct<S extends QueueSong>(
  list: readonly S[],
  index: number,
  current: S,
  wrap: boolean
): S | undefined {
  if (list.length < 2) return undefined;
  const key = songIdentity(current);
  const usable = (candidate: S | undefined): candidate is S =>
    candidate !== undefined && candidate.id !== current.id && songIdentity(candidate) !== key;
  const start = index >= 0 ? index : 0;
  for (let at = start - 1; at >= 0; at -= 1) {
    const candidate = list[at];
    if (usable(candidate)) return candidate;
  }
  if (!wrap) return undefined;
  for (let at = list.length - 1; at > start; at -= 1) {
    const candidate = list[at];
    if (usable(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Where the Next button goes. It carries on round from the last song to the first whatever the
 * repeat mode (Android does the same); repeat only decides what happens when a song ends by itself.
 * Null when there is nowhere distinct to go (one song, or only remasters of it).
 */
export function manualNext<S extends QueueSong>({ list, current, shuffle, shuffleOrder }: SkipInput<S>): S | null {
  if (shuffle) {
    const id = nextInOrder(shufflePlayOrder(list, shuffleOrder), current.id, true);
    return list.find((item) => item.id === id) ?? null;
  }
  return nextDistinct(list, list.findIndex((item) => item.id === current.id), current, true) ?? null;
}

/** True while some song still follows the current one without going round, so Next has real upcoming music. */
export function hasUpcoming<S extends QueueSong>({ list, current, shuffle, shuffleOrder }: SkipInput<S>): boolean {
  if (shuffle) return nextInOrder(shufflePlayOrder(list, shuffleOrder), current.id, false) !== null;
  return nextDistinct(list, list.findIndex((item) => item.id === current.id), current, false) !== undefined;
}

export type PreviousDecision<S> =
  | { readonly kind: 'restart' }
  | { readonly kind: 'back'; readonly song: S };

/**
 * Previous restarts the song once it has played past three seconds, or when nothing comes before it;
 * otherwise it goes back one. `repeatAll` lets the first song go back to the last.
 * `positionSec` is where the SELECTED song is, which is 0 while a freshly picked song is still
 * loading, not wherever the element happens to be before it switches source.
 */
export function decidePrevious<S extends QueueSong>(
  input: SkipInput<S> & { readonly positionSec: number; readonly repeatAll: boolean }
): PreviousDecision<S> {
  const { list, current, shuffle, shuffleOrder, positionSec, repeatAll } = input;
  let back: S | undefined;
  if (shuffle) {
    const id = previousInOrder(shufflePlayOrder(list, shuffleOrder), current.id, repeatAll);
    back = list.find((item) => item.id === id);
  } else {
    back = previousDistinct(list, list.findIndex((item) => item.id === current.id), current, repeatAll);
  }
  if (!back || previousAction(positionSec, true) === 'restart') return { kind: 'restart' };
  return { kind: 'back', song: back };
}
