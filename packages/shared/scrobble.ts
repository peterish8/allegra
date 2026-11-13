/**
 * Last.fm scrobble rules, shared by the API (which signs and sends) and any client that shows
 * scrobble state. Pure: no I/O, no clock reads (the caller passes `nowMs`).
 *
 * The threshold follows Last.fm's published rule, not Echo's default: a track must be longer than
 * 30 s, and counts once it has been heard for half its duration or 4 minutes, whichever is earlier.
 * https://www.last.fm/api/scrobbling
 */

export const SCROBBLE_RULES = {
  /** A track must be strictly longer than this (seconds). */
  minTrackSec: 30,
  /** Half the track, capped at this many heard seconds. */
  capSec: 240,
  batchSize: 50,
  flushDebounceSec: 30,
  leaseSec: 60,
  retryDelaysSec: [60, 300, 1_800, 7_200, 21_600] as const,
  maxAgeDays: 14,
  /** A client clock may be ahead by this much before playedAt is distrusted. */
  futureSlackSec: 300,
  nowPlayingBudgetMs: 1_500
} as const;

export type ScrobbleSink = 'lastfm' | 'listenbrainz';

/** Heard seconds needed before a track counts, or null when the track can never count. */
export function scrobbleThresholdSec(durationSec: number): number | null {
  if (!Number.isFinite(durationSec) || durationSec <= SCROBBLE_RULES.minTrackSec) return null;
  return Math.min(durationSec / 2, SCROBBLE_RULES.capSec);
}

export function isScrobbleEligible(input: { readonly durationSec: number; readonly heardSec: number }): boolean {
  const threshold = scrobbleThresholdSec(input.durationSec);
  return threshold !== null && Number.isFinite(input.heardSec) && input.heardSec >= threshold;
}

/** Retry delay after [attempts] failures (1-based), in seconds. The last delay repeats. */
export function retryDelaySec(attempts: number): number {
  const table = SCROBBLE_RULES.retryDelaysSec;
  const index = Math.min(Math.max(attempts, 1), table.length) - 1;
  return table[index] ?? table[table.length - 1] ?? 0;
}

/**
 * Unix seconds for a listen that started at [playedAtIso]; null when unusable.
 * A start time more than the slack in the future is replaced by "now minus heard seconds".
 * A start time older than the retention window is null (the row would be dropped anyway).
 */
export function scrobbleTimestamp(playedAtIso: string, heardSec: number, nowMs: number): number | null {
  const started = Date.parse(playedAtIso);
  if (!Number.isFinite(started) || !Number.isFinite(nowMs)) return null;
  const now = Math.floor(nowMs / 1000);
  let ts = Math.floor(started / 1000);
  if (ts > now + SCROBBLE_RULES.futureSlackSec) {
    const heardBack = Number.isFinite(heardSec) ? Math.ceil(Math.max(0, heardSec)) : 0;
    ts = now - heardBack;
  }
  if (now - ts > SCROBBLE_RULES.maxAgeDays * 86_400) return null;
  return ts;
}

export interface ScrobbleStatus {
  /** The server has Last.fm configured. */
  readonly available: boolean;
  readonly lastfm: { readonly username: string; readonly scrobbling: boolean; readonly needsReauth: boolean; readonly connectedAt: string } | null;
  readonly listenbrainz: { readonly username: string; readonly scrobbling: boolean } | null;
  /** Rows waiting to be sent, capped at 999 for display. */
  readonly pending: number;
}
