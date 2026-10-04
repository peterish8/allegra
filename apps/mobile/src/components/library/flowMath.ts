/**
 * The maths of the Library's coverflow (GlassDeck), kept apart from the view so
 * it can be tested. `d` is a card's signed distance from the focus, in cards:
 * 0 = the centre card, -1 = one to its left, +1 = one to its right.
 */

/** How the focus follows a drag: one card per `step` points, resisting past either end. */
export const focusFromDrag = (start: number, translationX: number, step: number, count: number): number => {
  'worklet';
  const raw = start - translationX / step;
  const last = Math.max(0, count - 1);
  if (raw < 0) return raw * 0.35;
  if (raw > last) return last + (raw - last) * 0.35;
  return raw;
};

/** The card a release settles on: where the flick is heading, not where the finger let go. */
export const settleFocus = (focus: number, velocityX: number, step: number, count: number): number => {
  'worklet';
  const landing = focus - (velocityX / step) * 0.16;
  return Math.min(Math.max(0, count - 1), Math.max(0, Math.round(landing)));
};

/** Sideways offset of a card: neighbours a full step out, the ones beyond crowd together. */
export const flowOffset = (d: number, step: number): number => {
  'worklet';
  const a = Math.abs(d);
  const inner = Math.min(a, 1) * step;
  const outer = Math.max(0, a - 1) * step * 0.5;
  return Math.sign(d) * (inner + outer);
};

/** Which side of the centre a tap at `x` (across a stage of `width`) lands on, for a centre card `cardWidth` wide: -1, 0 or 1. */
export const tapSide = (x: number, width: number, cardWidth: number): -1 | 0 | 1 => {
  const from = x - width / 2;
  if (Math.abs(from) <= cardWidth / 2) return 0;
  return from < 0 ? -1 : 1;
};

// -- The loop ---------------------------------------------------------------------------------------------------
// With three cards or more the row has no ends: the position is any number, a card's place in it is read round a
// circle, and past the last card comes the first again. With fewer it would show one card on both sides, so a row of
// one or two keeps its ends (the clamped functions above).

/** Whether a row of `count` cards loops. */
export const loops = (count: number): boolean => {
  'worklet';
  return count >= 3;
};

/** `value` mod `count`, always 0..count-1 (JavaScript's % keeps the sign). */
export const wrapIndex = (value: number, count: number): number => {
  'worklet';
  if (count <= 0) return 0;
  return ((Math.round(value) % count) + count) % count;
};

/**
 * Card `index`'s signed distance from `position`, the short way round when the row loops: in (-count/2, count/2],
 * so the cards on the far side of the circle come in from the other edge.
 */
export const loopDistance = (index: number, position: number, count: number): number => {
  'worklet';
  const d = index - position;
  if (!loops(count)) return d;
  const m = ((d % count) + count) % count;
  return m > count / 2 ? m - count : m;
};

/** How the position follows a drag on a looping row: freely, one card per `step` points. */
export const loopFocusFromDrag = (start: number, translationX: number, step: number): number => {
  'worklet';
  return start - translationX / step;
};

/** Where a release on a looping row settles: the card the flick is heading for, any number of times round. */
export const loopSettleFocus = (position: number, velocityX: number, step: number): number => {
  'worklet';
  return Math.round(position - (velocityX / step) * 0.16);
};

/** The position, nearest to `from`, that puts card `index` in the middle (the short way round). */
export const nearestPositionOf = (index: number, from: number, count: number): number => {
  'worklet';
  if (!loops(count)) return Math.min(Math.max(0, index), Math.max(0, count - 1));
  const base = Math.round(from);
  return base + loopDistance(index, base, count);
};
