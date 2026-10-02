/**
 * The clock the lyrics follow.
 *
 * The native player reports its position about four times a second, so reading it directly meant a line
 * could switch up to a quarter of a second after it should, always in steps of that size: lyrics a little
 * behind, and a glide that starts on a beat of its own rather than on the music. While a song plays, the
 * clock carries on from the last report with the time that has passed since, a frame at a time, and each
 * new report puts it right again.
 *
 * Pure (and a worklet) so the rules are tested and the lyrics can run it on the UI thread.
 */

/** Never run on further than this past a report: if reports stop (the player stalled), the lyrics wait. */
export const MAX_AHEAD_MS = 600;
/** A report that lands this far behind a clock already running ahead is just late news: keep going. */
export const LATE_REPORT_SECONDS = 0.35;

export function lyricClockAt(
  /** The last reported position, in seconds, and when it arrived (ms). */
  anchorPosition: number,
  anchorAtMs: number,
  nowMs: number,
  /** The clock's own last value, to keep it from stepping backwards on a late report. */
  previous: number | undefined,
): number {
  'worklet';
  const ahead = Math.min(MAX_AHEAD_MS, Math.max(0, nowMs - anchorAtMs)) / 1000;
  const estimate = anchorPosition + ahead;
  if (previous !== undefined && estimate < previous && previous - estimate < LATE_REPORT_SECONDS) return previous;
  return estimate;
}
