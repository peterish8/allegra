/**
 * Where a sheet comes to rest when the finger lets go. Pure worklets, shared by every `Sheet`, so a drag feels
 * the same in a short menu and in an expandable list:
 *
 * - the drag is direct (1:1 under the finger); past the top rest it rubber-bands instead of stopping hard,
 * - on release the sheet is thrown: its resting place is projected from the finger's speed (`projectMomentum`),
 *   then the nearest rest wins, never skipping more than one rest from where the drag began,
 * - the spring that carries it there starts at the finger's speed and never overshoots (`releaseSpring`).
 *
 * Positions are the card's downward offset in points: 0 is fully open, larger is lower.
 */
import { projectMomentum, rubberBand } from '../components/allegra/physics';
import { Motion } from '../constants/allegraTheme';

/** How far past the top rest a pull may stretch (the rubber band's dimension, pt). */
export const SHEET_STRETCH = Motion.stretch.sheet;

/** The card's offset under the finger: direct inside the travel, rubber-banded above the top rest. */
export const dragPosition = (start: number, translation: number, top: number): number => {
  'worklet';
  const raw = start + translation;
  return raw < top ? top + rubberBand(raw - top, SHEET_STRETCH) : raw;
};

/** The rest nearest to `position`, by index into `rests` (ascending offsets). */
export const nearestRest = (position: number, rests: readonly number[]): number => {
  'worklet';
  let best = 0;
  for (let i = 1; i < rests.length; i++) {
    if (Math.abs(rests[i] - position) < Math.abs(rests[best] - position)) best = i;
  }
  return best;
};

/**
 * The rest a release settles on. `rests` are ascending offsets (open … closed), `from` the index the drag began
 * at, `velocity` the finger's speed in pt/s (positive is downward). A flick always moves at least one rest in its
 * direction; a slow release takes the nearest; nothing skips more than one rest.
 */
export const pickRest = (position: number, velocity: number, rests: readonly number[], from: number, flingVelocity: number): number => {
  'worklet';
  const projected = position + projectMomentum(velocity);
  let target = nearestRest(projected, rests);
  if (Math.abs(velocity) > flingVelocity) {
    if (velocity > 0 && target <= from) target = from + 1;
    if (velocity < 0 && target >= from) target = from - 1;
  }
  return Math.max(0, Math.min(rests.length - 1, Math.max(from - 1, Math.min(from + 1, target))));
};

/** 0 at `low`, 1 at `high` (either order), clamped: e.g. how expanded a sheet is between its short and full rest. */
export const progressBetween = (position: number, low: number, high: number): number => {
  'worklet';
  if (low === high) return 1;
  return Math.max(0, Math.min(1, (low - position) / (low - high)));
};
