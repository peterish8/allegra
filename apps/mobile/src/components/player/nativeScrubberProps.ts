/**
 * What the native scrubber (`NativeScrubber`, android/.../views/NativeScrubberView.kt) is handed, decided in plain
 * TypeScript so it is unit-testable: whether it is used at all, the seed it holds at while the player is not on this
 * song, and what a commit from it is allowed to mean.
 */

/** Seconds as a finite, non-negative number rounded to `step`; anything unusable is 0. */
export const cleanSeconds = (value: unknown, step: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / step) * step;
};

/** The local player's scrubber is native where the view exists; Connect's remote player (no `localSongId`) keeps its own clock. */
export const shouldUseNativeScrubber = (available: boolean, localSongId?: string | null): boolean =>
  available && typeof localSongId === 'string' && localSongId.length > 0;

/** The place to seek to from a native commit, or null when the event is not a usable place. */
export const commitSeconds = (event: { nativeEvent?: { seconds?: unknown } } | undefined, durationSec: number): number | null => {
  const raw = event?.nativeEvent?.seconds;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return durationSec > 0 ? Math.min(raw, durationSec) : raw;
};
