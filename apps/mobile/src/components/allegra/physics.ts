/**
 * How things move under a finger, in one place: the player sheet, the remote player, the cover swipe and every
 * glass sheet share these, so a drag feels the same wherever it starts. Pure worklets, safe on either thread.
 * Defaults never name an outside value (the worklet compiler would not copy it; see workletSafety.test.ts).
 */
import { Motion } from '../../constants/allegraTheme';

type Spring = { stiffness: number; damping: number; mass: number; overshootClamping?: boolean; velocity?: number };

/** Where a flick would come to rest if nothing stopped it (deceleration 0.99 per ms), in pt. */
export const projectMomentum = (velocity: number): number => {
  'worklet';
  return (velocity / 1000) * (0.99 / (1 - 0.99));
};

/** Progressive resistance past an edge, instead of a hard stop: never further than `dimension`. */
export const rubberBand = (overshoot: number, dimension: number): number => {
  'worklet';
  const a = Math.abs(overshoot);
  return Math.sign(overshoot) * ((a * dimension * 0.55) / (dimension + 0.55 * a));
};

/** A release this fast counts as a flick. */
export const isFling = (velocity: number): boolean => {
  'worklet';
  return Math.abs(velocity) > Motion.flingVelocity;
};

/**
 * The spring a release hands off to: the firm one for a flick, the soft one otherwise, carrying `velocity`
 * (in the animated value's own units per second) so the surface leaves at the speed it was thrown.
 */
export const releaseSpring = (velocity: number, fingerVelocity: number): Spring => {
  'worklet';
  const base = isFling(fingerVelocity) ? Motion.spring.fling : Motion.spring.open;
  return { ...base, velocity };
};

/** How much of a spring's motion is damped: 1 settles without overshoot, below about 0.6 visibly wobbles. */
export const dampingRatio = (spring: { stiffness: number; damping: number; mass: number }): number =>
  spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
