/**
 * The playhead a status report implies between reports.
 *
 * Android's engine reports position about four times a second, and decides "previous restarts this song" from its
 * own clock. JavaScript deciding the same thing from the last report alone is up to a quarter of a second behind:
 * at 2.8–3.0 s it says "go back" while the engine has just crossed 3 s and restarts, so the screen moves and then
 * snaps back. While the song is playing, the last report plus the time since it lands on the engine's side of the
 * line.
 */
export function extrapolatePosition(
  lastPositionSec: number,
  lastReportAt: number,
  now: number,
  playing: boolean,
  upperBoundSec?: number,
): number {
  if (!playing || !Number.isFinite(lastPositionSec) || !Number.isFinite(lastReportAt)) return lastPositionSec;
  const elapsed = Math.max(0, (now - lastReportAt) / 1000);
  const next = lastPositionSec + elapsed;
  if (upperBoundSec !== undefined && Number.isFinite(upperBoundSec) && upperBoundSec > 0) {
    return Math.min(next, upperBoundSec);
  }
  return next;
}
