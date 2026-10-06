/**
 * What the way a song ended says about the listener. Web, phone and the API read every listen
 * through this one rule, so the queue that reacts now and the taste profile that learns for
 * later never disagree.
 *
 *   finished      heard to the end, or left in the last 15 s / last 10 %: a vote for the song
 *   heard         left after 30 s but well before the end: "not now", nothing stronger
 *   early-skip    left between 10 and 30 s in: a vote against
 *   instant-skip  left inside 10 s: a clear vote against
 *   paused        stopped without moving on: says nothing about taste
 *
 * Seconds are always seconds of audio actually heard (seeks and buffering excluded), except
 * `exitPositionSec`, which is where the playhead was when the listener left.
 */

/** How a listen ended, as the player saw it. */
export type ListenExit = 'ended' | 'skipped' | 'paused' | 'switched';

export type ListenVerdict = 'finished' | 'heard' | 'early-skip' | 'instant-skip' | 'paused';

export const LISTEN_RULES = {
  /** Within this of the end, a track change is the song ending by itself. */
  endSlackSec: 2,
  /** Leaving in the last this-many seconds still counts as hearing the song out. */
  lateSkipSec: 15,
  /** …or after this share of the song. */
  lateSkipShare: 0.9,
  /** Leaving before this many heard seconds is a skip that means "not this". */
  earlySkipSec: 30,
  /** Leaving before this is the strongest "no". */
  instantSkipSec: 10
} as const;

export interface ListenOutcome {
  readonly heardSeconds: number;
  readonly exit: ListenExit;
  /** Where the playhead was when the listener left. Unknown means "use heard seconds". */
  readonly exitPositionSec?: number | undefined;
  readonly durationSec?: number | undefined;
}

const finite = (value: number | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The playhead was at (or near) the end when the song changed. */
export function reachedEnd(outcome: Pick<ListenOutcome, 'heardSeconds' | 'exitPositionSec' | 'durationSec'>): boolean {
  const duration = finite(outcome.durationSec);
  if (duration === null || duration <= 0) return false;
  const position = finite(outcome.exitPositionSec) ?? Math.max(0, outcome.heardSeconds);
  if (position < duration - LISTEN_RULES.lateSkipSec && position < duration * LISTEN_RULES.lateSkipShare) return false;
  // Seeking straight to the outro and leaving is not hearing the song out.
  return outcome.heardSeconds >= Math.min(LISTEN_RULES.earlySkipSec, duration * 0.5);
}

export function listenVerdict(outcome: ListenOutcome): ListenVerdict {
  const heard = Math.max(0, finite(outcome.heardSeconds) ?? 0);
  if (outcome.exit === 'ended' || reachedEnd({ ...outcome, heardSeconds: heard })) return 'finished';
  if (outcome.exit === 'paused') return 'paused';
  if (heard < LISTEN_RULES.instantSkipSec) return 'instant-skip';
  if (heard < LISTEN_RULES.earlySkipSec) return 'early-skip';
  return 'heard';
}

/** How much a verdict moves the long-term taste profile (artists, languages). */
export const LONG_TERM_WEIGHT: Readonly<Record<ListenVerdict, number>> = {
  finished: 1,
  heard: 0,
  'early-skip': -0.5,
  'instant-skip': -0.8,
  paused: 0
};

/** How much a verdict moves the radio that is playing right now. Stronger than long-term on purpose. */
export const SESSION_WEIGHT: Readonly<Record<ListenVerdict, number>> = {
  finished: 1,
  heard: -0.3,
  'early-skip': -1,
  'instant-skip': -1.5,
  paused: 0
};

/** A like or a playlist add while the song plays: the strongest "more like this". */
export const SESSION_LOVE_WEIGHT = 2;

export function isListenExit(value: unknown): value is ListenExit {
  return value === 'ended' || value === 'skipped' || value === 'paused' || value === 'switched';
}
