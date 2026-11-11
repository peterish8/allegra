/**
 * After a skip the screen puts the playhead back to 0 at once (`playerControls.resetPlayhead`). A position report
 * that was already on its way from the old song can still land a moment later and drag the scrubber, the lyrics and
 * the "previous restarts past 3 s" rule back to where the old song was.
 *
 * Since the reset the new song cannot have played further than the time that has passed (plus a little slack for
 * the player starting a beat early), so for a short window a report further along than that is the old song's.
 * Pure, so it can be tested without React Native.
 */

/** How long after a reset reports are checked. Reports come four times a second, so one stale tick fits well inside. */
export const PLAYHEAD_RESET_WINDOW_MS = 500;
/** How far ahead of the elapsed time a fresh report may be (a decoder that started early, rounding). */
export const PLAYHEAD_RESET_SLACK_S = 1;

/** True when `reportedSec` may be written to the playhead; false when it is a late report from the song before. */
export function acceptPositionReport(reportedSec: number, resetAtMs: number | null, nowMs: number): boolean {
  if (resetAtMs === null || !Number.isFinite(reportedSec)) return true;
  const elapsedMs = nowMs - resetAtMs;
  if (elapsedMs < 0 || elapsedMs > PLAYHEAD_RESET_WINDOW_MS) return true;
  return reportedSec <= elapsedMs / 1000 + PLAYHEAD_RESET_SLACK_S;
}
