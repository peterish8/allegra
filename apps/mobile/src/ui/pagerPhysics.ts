/**
 * How a sideways pager (Library's Songs · Playlists · Artists · Albums) moves under a finger. Pure worklets; the same
 * rules as the sheets (`sheetPhysics`), turned on their side:
 *
 * - the drag is direct, 1:1, and rubber-bands past the first and last page instead of stopping hard,
 * - a release is thrown: the page is projected from the finger's speed and never more than one page away,
 * - the tab underline reads the same position, so it follows the finger across the whole travel.
 *
 * `pos` is in points from the first page's left edge (page `i` rests at `i * width`).
 */
import { rubberBand } from '../components/allegra/physics';
import { Motion } from '../constants/allegraTheme';
import { pickRest } from './sheetPhysics';

/** The pager's offset under the finger, rubber-banded past either end. A pager's drag runs opposite the finger. */
export const pagerPosition = (start: number, translationX: number, maxPos: number): number => {
  'worklet';
  const raw = start - translationX;
  if (raw < 0) return rubberBand(raw, Motion.stretch.sheet);
  if (raw > maxPos) return maxPos + rubberBand(raw - maxPos, Motion.stretch.sheet);
  return raw;
};

/** The page a release lands on: projected from the finger's speed (pt/s), never skipping a page. */
export const pageAfterRelease = (pos: number, velocityX: number, width: number, count: number, from: number): number => {
  'worklet';
  const rests: number[] = [];
  for (let i = 0; i < count; i++) rests.push(i * width);
  // The content travels against the finger, so a flick to the left moves the pager forward.
  return pickRest(pos, -velocityX, rests, from, Motion.flingVelocity);
};

/**
 * Where the tab underline sits for a pager position: interpolated between the two tabs it lies between, by their
 * measured left edge and width. Past either end it stays on the end tab.
 */
export const indicatorFrame = (
  page: number,
  lefts: readonly number[],
  widths: readonly number[],
): { left: number; width: number } => {
  'worklet';
  const last = lefts.length - 1;
  if (last < 0) return { left: 0, width: 0 };
  const p = Math.max(0, Math.min(last, page));
  const i = Math.min(last - 1, Math.floor(p));
  if (i < 0) return { left: lefts[0], width: widths[0] };
  const t = p - i;
  return {
    left: lefts[i] + (lefts[i + 1] - lefts[i]) * t,
    width: widths[i] + (widths[i + 1] - widths[i]) * t,
  };
};
