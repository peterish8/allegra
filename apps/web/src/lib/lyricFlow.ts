/**
 * The arithmetic behind the lyrics' flow, run every animation frame (the phone
 * runs the same rules on its UI thread: apps/mobile/src/playback/lyricMotion.ts).
 *
 * - `lyricClockAt`: the audio element reports its time about four times a second;
 *   while a song plays the clock carries on from the last report a frame at a time,
 *   so lines switch and letters fill on the music rather than in quarter-second steps.
 * - `followStep`: the list easing onto the sung line. A critically damped follow:
 *   it starts gently, lands without overshoot, and keeps its speed when the next line
 *   arrives mid-glide, so the lines flow on instead of restarting. Settles in ~1.5 s.
 * - A line goes live `LINE_LEAD_S` before it is sung, so the glide is under way when
 *   the singing starts (Echo Music's lead).
 */

export const LINE_LEAD_S = 0.3;
/** Never run on further than this past a report: if reports stop (a stall), the lyrics wait. */
export const MAX_AHEAD_S = 0.6;
/** A report landing this far behind a clock already running ahead is late news: keep going. */
export const LATE_REPORT_S = 0.35;
export const FOLLOW_SMOOTH_S = 0.42;

export function lyricClockAt(anchorTime: number, anchorAtMs: number, nowMs: number, previous: number | undefined): number {
  const ahead = Math.min(MAX_AHEAD_S, Math.max(0, (nowMs - anchorAtMs) / 1000));
  const estimate = anchorTime + ahead;
  if (previous !== undefined && estimate < previous && previous - estimate < LATE_REPORT_S) return previous;
  return estimate;
}

export interface FollowState {
  /** How far the list still is from where it is going, px. */
  readonly offset: number;
  /** px per second. */
  readonly velocity: number;
}

export function followStep(offset: number, velocity: number, dt: number, smoothS: number = FOLLOW_SMOOTH_S): FollowState {
  const omega = 2 / smoothS;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const temp = (velocity + omega * offset) * dt;
  return { offset: (offset + temp) * decay, velocity: (velocity - omega * temp) * decay };
}

export function followSettled(state: FollowState): boolean {
  return Math.abs(state.offset) < 0.75 && Math.abs(state.velocity) < 6;
}

/** The line being sung at `time` (the last one started), 0 before the first. */
export function lineAt(timestamps: readonly number[], time: number): number {
  let low = 0;
  let high = timestamps.length - 1;
  let answer = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = timestamps[middle];
    if (start === undefined || start > time) high = middle - 1;
    else {
      answer = middle;
      low = middle + 1;
    }
  }
  return answer;
}
