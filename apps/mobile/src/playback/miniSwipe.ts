/**
 * The mini player's sideways swipe: left plays the next song, right goes to the previous one (the queue owner
 * decides whether "previous" restarts the song). A swipe has to mean it: a short, slow or mostly vertical drag
 * changes nothing, so a noisy flick or a scroll that strays sideways never skips.
 */
/** A flick: the theme's Motion.flingVelocity (pt/s). Kept here so this rule stays free of React Native imports. */
export const SWIPE_FLICK_VELOCITY = 800;

export type MiniSwipe = 'next' | 'previous' | null;

/** A slow drag commits past this, or past 22% of the bar's width when that is wider. */
export const SWIPE_MIN_DISTANCE = 56;
/** A flick commits sooner, but only once the finger has travelled this far the same way. */
export const SWIPE_FLICK_DISTANCE = 24;
/** How far the cover and title follow the finger, at most. */
export const SWIPE_FOLLOW_MAX = 48;

export function swipeThreshold(width: number): number {
  'worklet';
  return Math.max(SWIPE_MIN_DISTANCE, width * 0.22);
}

export function miniSwipe(dx: number, dy: number, vx: number, width: number, rtl = false): MiniSwipe {
  'worklet';
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dy) >= Math.abs(dx)) return null;
  const far = Math.abs(dx) >= swipeThreshold(width);
  const flick = Math.abs(vx) >= SWIPE_FLICK_VELOCITY && Math.abs(dx) >= SWIPE_FLICK_DISTANCE && Math.sign(vx) === Math.sign(dx);
  if (!far && !flick) return null;
  const towardStart = dx < 0;
  return towardStart !== rtl ? 'next' : 'previous';
}

/** How far the content follows a drag: half the finger's travel, damped to SWIPE_FOLLOW_MAX. */
export function swipeFollow(dx: number): number {
  'worklet';
  const half = dx / 2;
  return Math.max(-SWIPE_FOLLOW_MAX, Math.min(SWIPE_FOLLOW_MAX, half));
}
