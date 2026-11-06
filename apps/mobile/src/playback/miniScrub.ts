/**
 * The mini player's scrub, in plain numbers (1.41.0). Worklet-safe: the gesture calls these on the UI thread.
 */

/** At rest the line is this share of its scrubbing thickness (6dp → 2.4dp); it springs to full under the finger. */
export const SCRUB_REST_SCALE = 0.4;

/** Where along the line a finger is, 0..1, from its x in the line's own frame. */
export const scrubFraction = (x: number, width: number): number => {
  'worklet';
  if (!(width > 0) || !Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x / width));
};

/** The second a fraction of the song is at; nothing to seek to without a known length. */
export const scrubSeconds = (fraction: number, duration: number): number | null =>
  Number.isFinite(duration) && duration > 0 ? Math.max(0, Math.min(duration, fraction * duration)) : null;
