/**
 * The arithmetic behind the lyrics' motion, run on the UI thread every frame.
 *
 * - `lyricSweep`: how much of a word is lit, by syllable and letter. A worklet
 *   copy of `sweepAt` in `@shared/wordSync` (a worklet can only call worklets;
 *   the test keeps the two in step).
 * - `glideStep`: the block of lines easing home after a line change. A
 *   critically damped follow (Unity's SmoothDamp): it starts gently, lands with
 *   no overshoot, and keeps its speed when a new line arrives mid-glide, so the
 *   lines flow on instead of restarting. Settles in about Echo Music's 1.5 s.
 */

/** The glide's time constant, in seconds: ~90% of the way in 0.8 s, at rest by ~1.4 s. */
export const GLIDE_SMOOTH_S = 0.42;
/** A line goes live this long before its first word, so the glide is under way when the singing starts (Echo's lead). */
export const LINE_LEAD_S = 0.3;

export function lyricSweep(t: number, segments: readonly number[], weight: number): number {
  'worklet';
  const n = segments.length;
  if (n === 0 || weight <= 0) return 0;
  if (t <= segments[0]) return 0;
  if (t >= segments[n - 2]) return 1;
  let lit = 0;
  for (let i = 0; i < n; i += 3) {
    const s = segments[i];
    const e = segments[i + 1];
    const w = segments[i + 2];
    if (t >= e) {
      lit += w;
    } else {
      if (t > s) lit += (w * (t - s)) / (e - s);
      break;
    }
  }
  return Math.min(1, lit / weight);
}

export interface GlideState {
  /** How far the lines still sit from home, px. */
  offset: number;
  /** px per second. */
  velocity: number;
}

/**
 * One frame of the glide towards 0.
 *
 * The time constant is read in the body, never as a default parameter: the worklet compiler copies to the UI
 * thread only what the body uses, so `smoothS = GLIDE_SMOOTH_S` left the constant behind and the first glide
 * threw "Property 'GLIDE_SMOOTH_S' doesn't exist", which took the whole screen down when lyrics were open.
 */
export function glideStep(offset: number, velocity: number, dt: number, smoothS?: number): GlideState {
  'worklet';
  const omega = 2 / (smoothS ?? GLIDE_SMOOTH_S);
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const temp = (velocity + omega * offset) * dt;
  return { offset: (offset + temp) * decay, velocity: (velocity - omega * temp) * decay };
}

/** Close enough to home that the rest isn't worth a frame. */
export function glideSettled(state: GlideState): boolean {
  'worklet';
  return Math.abs(state.offset) < 0.75 && Math.abs(state.velocity) < 6;
}

/**
 * How bright a line's resting text is. The sung line is full (or, lit letter by
 * letter, its unsung part sits at 0.45 under the sweep). The lines just sung stay
 * brighter than the ones to come, falling off with distance, as in Echo Music;
 * while you read on your own every line is easy to read.
 */
export function lineRestOpacity(index: number, active: number, reading: boolean, sweeping: boolean): number {
  'worklet';
  if (reading) return index === active && !sweeping ? 1 : 0.62;
  if (index === active) return sweeping ? 0.45 : 1;
  const d = index - active;
  if (d < 0) return d === -1 ? 0.62 : d === -2 ? 0.46 : 0.36;
  return d === 1 ? 0.42 : d === 2 ? 0.33 : 0.27;
}
