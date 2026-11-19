/**
 * The maths of the player transition (finger-tracked since 1.49.0, always on since 1.69.0): where a release settles and
 * where the sheet's top edge is under a finger. The sheet is one surface sliding up and down; nothing travels on its own
 * path. Pure numbers, so the rules are tested; the gestures and the drawing are in PillPlayer and NowPlayingScreen.
 *
 * `progress` is playerSheetProgress: 0 resting on the mini player, 1 full screen.
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

/**
 * The mini player's own contents (title, buttons) fade out over the first 18%, so the rising sheet never sits on
 * top of its text. 1 = fully shown.
 */
export const miniContentOpacity = (progress: number): number => {
  'worklet';
  return 1 - clamp01(progress / 0.18);
};

/** The mini player's glow behind the sheet fades out over the middle of the travel: 0 until 34%, 1 at 72%. */
export const miniGlowOpacity = (progress: number): number => {
  'worklet';
  return clamp01((progress - 0.34) / 0.38);
};

/** Room the title, buttons and seek bar take under the card (NowPlayingLyricsArea's Stage uses the same number). */
export const CARD_CONTROLS_ROOM = 360;
export const CARD_MAX = 342;
const CARD_SIDE = 24;

/** The artwork card's side in pixels: the screen's width less its margins, never over 342, never taller than the room. */
export const cardSize = (width: number, screenH: number, paddingTop: number): number =>
  Math.min(width - CARD_SIDE * 2, CARD_MAX, Math.max(160, screenH - paddingTop - CARD_CONTROLS_ROOM));
