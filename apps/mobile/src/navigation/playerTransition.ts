/**
 * The maths of the player sheet (finger-tracked since 1.49.0, always on since 1.69.0): where a release settles, how
 * the sheet follows a finger, and what fades when. Pure numbers, so the rules are tested; the gestures and the drawing
 * are in PillPlayer and NowPlayingScreen.
 *
 * One sheet, one motion (1.69.3): the sheet slides from the mini player's top edge carrying the player's own artwork,
 * and the mini player rides that edge and fades. No separate cover flies between the two, so there is never a second
 * cover, thumbnail or bar on screen. `progress` is playerSheetProgress: 0 resting on the mini player, 1 full screen.
 */

/** A release faster than this (px/s) decides the direction whatever the distance. */
export const FLING_VELOCITY = 800;
/** How far ahead (seconds) the finger's momentum is projected when deciding where it was heading. */
const PROJECT_SECONDS = 0.18;

/**
 * Where the sheet settles after a release. `velocityY` is the finger's vertical speed in px/s (negative = up);
 * `travel` is the distance in pixels between closed and open. A fast flick decides; otherwise the sheet goes where the
 * finger was heading (its position plus a little momentum), the nearer end past the half-way mark.
 */
export function settleTarget(progress: number, velocityY: number, travel: number): 'open' | 'closed' {
  'worklet';
  if (velocityY <= -FLING_VELOCITY) return 'open';
  if (velocityY >= FLING_VELOCITY) return 'closed';
  const heading = progress - (velocityY * PROJECT_SECONDS) / Math.max(1, travel);
  return heading > 0.5 ? 'open' : 'closed';
}

const clamp01 = (v: number): number => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};

/** How far past the open edge the sheet may be pulled before it stops giving (points, rubber band). */
export const SHEET_OVERPULL = 120;

/**
 * The sheet's top edge under a finger: where it was grabbed plus how far the finger has moved since, 1:1 in both
 * directions with no easing. It never goes below the mini player (`restY`) and resists past the open edge instead
 * of detaching. Every drag of the sheet (from the mini player, down to close, back up mid-close) uses this, so
 * reversing direction mid-drag simply moves the sheet back, at any speed.
 */
export function sheetYForDrag(grabY: number, dy: number, restY: number): number {
  'worklet';
  const y = grabY + dy;
  if (y >= 0) return Math.min(y, restY);
  const a = -y;
  return -((a * SHEET_OVERPULL * 0.55) / (SHEET_OVERPULL + 0.55 * a));
}

/** The sheet's progress (0 on the mini player, 1 open) for a top edge at `sheetY`. */
export function sheetProgressAt(sheetY: number, restY: number): number {
  'worklet';
  return clamp01(1 - sheetY / Math.max(1, restY));
}

/**
 * The mini player rides the sheet's top edge: it moves up with the sheet as it opens and comes back down with it,
 * so at every frame the pill and the sheet's top are one surface. Parked at rest while the sheet slid, it was
 * drawn over a sheet still above it at the end of every close (two stacked players). Reduce Motion keeps it still
 * (the sheet fades instead of sliding).
 */
export function miniRideY(progress: number, restY: number, reduceMotion: boolean): number {
  'worklet';
  const p = clamp01(progress);
  return reduceMotion || p === 0 ? 0 : -p * restY;
}

/** The mini player's own contents (cover, title, buttons) fade off the sheet's edge over the first 18%. 1 = shown. */
export const miniContentOpacity = (progress: number): number => {
  'worklet';
  return 1 - clamp01(progress / 0.18);
};

/**
 * The player's contents (its artwork, title, controls) fade in on the sheet from 18%, exactly where the mini player
 * has finished leaving its edge, to 40%, and out the same way on a close: one continuous hand-over, one surface at a
 * time, never two players or two covers.
 */
export const playerContentOpacity = (progress: number): number => {
  'worklet';
  return clamp01((progress - 0.18) / 0.22);
};

/**
 * A ready Canvas video shows only near the open end: it fades out over the first tenth of a close (into the still
 * cover under it) and back in on a reopen. Opacity only, so a ready video keeps decoding through a reversal and
 * never restarts.
 */
export const canvasSheetGate = (progress: number): number => {
  'worklet';
  // Written as p·10 − 9 (not (p − 0.9) / 0.1) so the open end is exactly 1, not 0.9999…
  return clamp01(progress * 10 - 9);
};

/**
 * Where a sheet starts when its route mounts. A drag from the mini player hands over the finger's last position
 * even when the finger lifted before the route mounted (a quick flick): the sheet starts there and settles once
 * with the release velocity instead of opening from rest. A tap or link opens from rest on a spring.
 */
export function sheetOpeningStart(instant: boolean, dragOpen: boolean, dragY: number, restY: number): { y: number; tracked: boolean } {
  if (instant) return { y: 0, tracked: false };
  if (dragOpen) return { y: Math.min(restY, Math.max(0, Number.isFinite(dragY) ? dragY : restY)), tracked: true };
  return { y: restY, tracked: false };
}

/** Room the title, buttons and seek bar take under the card (NowPlayingLyricsArea's Stage uses the same number). */
const CARD_CONTROLS_ROOM = 360;
const CARD_MAX = 342;
const CARD_SIDE = 24;

/** The artwork card's side in pixels: the screen's width less its margins, never over 342, never taller than the room. */
export const cardSize = (width: number, screenH: number, paddingTop: number): number =>
  Math.min(width - CARD_SIDE * 2, CARD_MAX, Math.max(160, screenH - paddingTop - CARD_CONTROLS_ROOM));
