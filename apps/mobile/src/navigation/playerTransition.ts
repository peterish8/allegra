/**
 * The maths of the fluid player transition (1.49.0, Settings → Fluid player): where a release settles, and where the
 * cover is on its way from the mini player to the player. Pure numbers, so the rules are tested; the gestures and
 * the drawing are in PillPlayer, NowPlayingScreen and components/player/CoverGhost.
 *
 * `progress` is playerSheetProgress: 0 resting on the mini player, 1 full screen.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

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

export const lerp = (from: number, to: number, t: number): number => {
  'worklet';
  return from + (to - from) * t;
};

/** The cover's rectangle `progress` of the way from the mini player's cover to its place in the player. */
export function coverFrame(progress: number, from: Rect, to: Rect): Rect {
  'worklet';
  const u = 1 - clamp01(progress);
  // Ease-out: the cover is already most of the way up while the surface is still rising (the reference's 35% and 70%).
  const t = 1 - u * u;
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), width: lerp(from.width, to.width, t), height: lerp(from.height, to.height, t) };
}

/** The cover's corner radius on the way: eased, so it keeps the mini cover's corners until the cover has grown. */
export function coverRadius(progress: number, fromRadius: number, toRadius: number): number {
  'worklet';
  const t = clamp01(progress);
  return lerp(fromRadius, toRadius, t * t);
}

/**
 * The mini player's own contents (title, buttons) fade out over the first 18%, so the growing cover never sits on
 * top of its text (the overlap in the reference's second frame). 1 = fully shown.
 */
export const miniContentOpacity = (progress: number): number => {
  'worklet';
  return 1 - clamp01(progress / 0.18);
};

/**
 * The player's own contents (title, controls) fade in late, after the cover has arrived: 0 until 34%, 1 at 72%.
 * Both tap expansion and fluid dragging use this choreography.
 */
export const playerContentOpacity = (progress: number): number => {
  'worklet';
  return clamp01((progress - 0.34) / 0.38);
};

/** The moving cover shows while the sheet is between the ends; at either end the real cover (or the mini one) is. */
export const ghostVisible = (progress: number): boolean => {
  'worklet';
  return progress > 0.001 && progress < 0.999;
};

/** Room the title, buttons and seek bar take under the card (NowPlayingLyricsArea's Stage uses the same number). */
export const CARD_CONTROLS_ROOM = 360;
export const CARD_MAX = 342;
const CARD_SIDE = 24;

/** The artwork card's side in pixels: the screen's width less its margins, never over 342, never taller than the room. */
export const cardSize = (width: number, screenH: number, paddingTop: number): number =>
  Math.min(width - CARD_SIDE * 2, CARD_MAX, Math.max(160, screenH - paddingTop - CARD_CONTROLS_ROOM));

/** Where the square artwork card sits in the player: centred, `paddingTop` from the top. */
export function cardCoverRect(width: number, screenH: number, paddingTop: number): Rect {
  const side = cardSize(width, screenH, paddingTop);
  return { x: (width - side) / 2, y: paddingTop, width: side, height: side };
}

/** Where the full-width hero (the Apple style, and Canvas inside it) sits: the top of the screen, `heroH` tall. */
export const heroCoverRect = (width: number, heroH: number): Rect => ({ x: 0, y: 0, width, height: heroH });
