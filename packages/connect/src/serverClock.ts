import type { Clock } from './types.ts';

/** A wall clock that moved this far against the monotonic clock has jumped. */
const JUMP_TOLERANCE_MS = 2_000;
/** After this long a slower round trip may replace the sample in use. */
const SAMPLE_MAX_AGE_MS = 10 * 60_000;

interface Sample {
  readonly serverAtMidpoint: number;
  readonly monotonicAtMidpoint: number;
  readonly wallAtMidpoint: number;
  readonly roundTripMs: number;
}

export interface ServerClock {
  /**
   * Starts timing one request. Call the returned function with the server time from its reply;
   * a request that fails is simply never finished.
   */
  begin(): (serverNow: number) => void;
  /** The estimated server time in milliseconds. */
  now(): number;
  /** Half the round trip of the sample in use: the bound on the estimate's error. */
  uncertaintyMs(): number;
}

/**
 * Estimates the server's clock from request/reply pairs. Each sample is placed at the request
 * midpoint, measured with the monotonic clock; the lowest round trip wins. Between samples the
 * estimate advances by monotonic time, so it does not follow a device clock that is wrong or
 * changes. A wall clock that jumps against the monotonic clock discards the estimate and calls
 * `onDiscard`, which should fetch a new sample.
 */
export function createServerClock(clock: Clock, onDiscard?: () => void): ServerClock {
  const hasMonotonic = typeof clock.monotonicNow === 'function';
  let sample: Sample | undefined;
  /** Server minus wall, kept for the gap between a discard and the next sample. */
  let lastOffset = 0;

  function monotonic(): number {
    if (!hasMonotonic) return clock.now();
    try {
      const value = clock.monotonicNow?.();
      return typeof value === 'number' && Number.isFinite(value) ? value : clock.now();
    } catch {
      return clock.now();
    }
  }

  function checkContinuity(): void {
    if (!sample) return;
    const wallElapsed = clock.now() - sample.wallAtMidpoint;
    const monotonicElapsed = monotonic() - sample.monotonicAtMidpoint;
    if (Math.abs(wallElapsed - monotonicElapsed) <= JUMP_TOLERANCE_MS) return;
    sample = undefined;
    onDiscard?.();
  }

  return {
    begin() {
      const sentAt = monotonic();
      return (serverNow) => {
        if (!Number.isFinite(serverNow)) return;
        const receivedAt = monotonic();
        const roundTripMs = Math.max(0, receivedAt - sentAt);
        checkContinuity();
        const isFresh = sample !== undefined && receivedAt - sample.monotonicAtMidpoint < SAMPLE_MAX_AGE_MS;
        if (sample && isFresh && roundTripMs > sample.roundTripMs) return;
        sample = {
          serverAtMidpoint: serverNow,
          monotonicAtMidpoint: receivedAt - roundTripMs / 2,
          wallAtMidpoint: clock.now() - roundTripMs / 2,
          roundTripMs
        };
        lastOffset = sample.serverAtMidpoint - sample.wallAtMidpoint;
      };
    },
    now() {
      checkContinuity();
      if (!sample) return clock.now() + lastOffset;
      return sample.serverAtMidpoint + (monotonic() - sample.monotonicAtMidpoint);
    },
    uncertaintyMs() {
      return sample ? sample.roundTripMs / 2 : Number.POSITIVE_INFINITY;
    }
  };
}
