/**
 * The maths of the player transition (finger-tracked since 1.49.0, always on since 1.69.0): where a release settles, and where the
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

export const lerp = (from: number, to: number, t: number): number => {
  'worklet';
  return from + (to - from) * t;
};

/** The cover's rectangle `progress` of the way from the mini player's cover to its place in the player. */
export function coverFrame(progress: number, from: Rect, to: Rect): Rect {
  'worklet';
  // Use the sheet's own progress so the cover cannot race ahead of its surface.
  const t = clamp01(progress);
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

/** Geometry the moving cover can use: finite, with a size. A missing or late measurement is never "usable". */
export function isUsableRect(rect: Rect | null | undefined): boolean {
  'worklet';
  return !!rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width)
    && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0;
}

/**
 * Who draws the song's thumbnail near the bottom bar at `progress`. The moving cover owns it between the ends while
 * a hand-over runs; otherwise the mini player's own cover does. Exactly one, at every frame, from one shared number.
 */
export function thumbnailOwner(progress: number, handoff: boolean): 'moving' | 'mini' {
  'worklet';
  return handoff && ghostVisible(progress) ? 'moving' : 'mini';
}

/**
 * The mini player's cover at `progress`: its resting rectangle carried up with the pill as it rides the sheet's
 * edge (miniRideY). The moving cover starts from here, so at the closed end it lands on the pill's cover exactly.
 */
export function riddenCoverRect(from: Rect, progress: number, restY: number, reduceMotion: boolean): Rect {
  'worklet';
  return { x: from.x, y: from.y + miniRideY(progress, restY, reduceMotion), width: from.width, height: from.height };
}

/**
 * The moving cover is the same picture in two clips laid over the same rectangle: one cut to the mini cover's
 * corners (exact at the mini player), one to the player's corners (exact in the player). Transforms scale a clip's
 * corners with it, so neither shape is right at both ends. The player's clip fades in under the mini clip early in
 * the flight, while both are small, and only then does the mini clip fade out. The picture is opaque throughout;
 * only the corners change.
 */
export function ghostClipOpacity(progress: number): { mini: number; player: number } {
  'worklet';
  const p = clamp01(progress);
  return { player: clamp01((p - 0.02) / 0.06), mini: 1 - clamp01((p - 0.08) / 0.06) };
}

/**
 * The scale for a square picture laid out at `max(layout.width, layout.height)` and centred in a clip laid out at
 * `layout`, so that with the clip scaled onto `frame` the picture covers the frame like `contentFit: cover` does.
 * The mini cover is square and a hero is tall, so the crop changes along the way and matches both ends.
 */
export function coverPictureScale(frame: Rect, layout: Rect): { x: number; y: number } {
  'worklet';
  const sx = Math.max(0.0001, frame.width / Math.max(1, layout.width));
  const sy = Math.max(0.0001, frame.height / Math.max(1, layout.height));
  const side = Math.max(1, layout.width, layout.height);
  const fill = Math.max(frame.width, frame.height);
  return { x: fill / (side * sx), y: fill / (side * sy) };
}

/**
 * A ready Canvas video shows only near the open end: it fades out over the first tenth of a close (into the still
 * cover under it, which the moving cover then carries down) and back in on a reopen. Opacity only, so a ready video
 * keeps decoding through a reversal and never restarts.
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
