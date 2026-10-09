import { motionTokens, spring } from '../motion';
import type { DjMotion } from './djDance';

/**
 * The DJ mascot as a ball: it crouches, jumps to a new spot along an arc, lands with a squash and a
 * wobble, rests, and goes again. Pure and clock-free (the caller feeds `dt`), so it can be checked
 * without a browser.
 *
 * All values are unitless and meant for CSS custom properties:
 *  - `x`, `y`: where it stands, as fractions of the stage's roam box (-1..1; y grows downward, toward the prompt).
 *  - `lift`: how high above the floor it is, as a fraction of its own height (0 on the ground).
 *  - `squash`: negative when crushed against the floor, positive when stretched in flight.
 *  - `sway`: degrees of lean or wobble.
 */
export interface HopPose {
  readonly x: number;
  readonly y: number;
  readonly lift: number;
  readonly squash: number;
  readonly sway: number;
}

export interface Hopper {
  readonly step: (dt: number, motion: DjMotion) => HopPose;
}

type Phase = 'rest' | 'crouch' | 'air' | 'land';

/** The prompt sits below the stage; listening parks the mascot at the bottom middle of its box. */
const LISTEN_SPOT = { x: 0, y: 0.9 } as const;
/** The floor of the roam box: a hop never lands higher than this, so the arc has room above it. */
const FLOOR_TOP = -0.1;
/** A new spot must be at least this far from the old one, or it is not a hop to somewhere. */
const MIN_TRAVEL = 0.25;
const CROUCH_SQUASH = -0.16;
const STRETCH = 0.14;
const LANDING_SQUASH = -0.24;
/** Degrees of wobble thrown into a landing, in the direction of travel. */
const WOBBLE = 6;
/** A second hop in place follows its landing after this long, and is this much smaller and quicker. */
const DOUBLE_DELAY = 0.12;
const DOUBLE_SCALE = 0.6;
/** Springs are integrated in steps no longer than this, so a stiff spring stays stable at any frame rate. */
const MAX_SUBSTEP = 1 / 240;
/** Seconds for the lean to close most of the gap to a new tilt. */
const TILT_EASE = 0.3;

interface Spring1 { value: number; velocity: number }

function integrate(state: Spring1, dt: number): void {
  const { stiffness, damping, mass } = spring.bounce;
  let left = dt;
  while (left > 0) {
    const h = Math.min(MAX_SUBSTEP, left);
    state.velocity += ((-stiffness * state.value - damping * state.velocity) / mass) * h;
    state.value += state.velocity * h;
    left -= h;
  }
}

const settled = (state: Spring1): boolean => Math.abs(state.value) < 0.01 && Math.abs(state.velocity) < 0.4;

export function createHopper(rand: () => number = Math.random): Hopper {
  const between = (range: readonly [number, number]): number => range[0] + (range[1] - range[0]) * rand();

  let phase: Phase = 'rest';
  let clock = 0;
  let restLeft = 0.5;
  let x = 0;
  let y = 0.2;
  let fromX = 0;
  let fromY = 0;
  let toX = 0;
  let toY = 0;
  let flight = motionTokens.duration.hopEasy;
  let apex = 0;
  let double = false;
  let lift = 0;
  const squash: Spring1 = { value: 0, velocity: 0 };
  const wobble: Spring1 = { value: 0, velocity: 0 };
  let tilt = 0;

  const aim = (motion: DjMotion): void => {
    fromX = x;
    fromY = y;
    if (motion.mode === 'listen') {
      toX = LISTEN_SPOT.x;
      toY = LISTEN_SPOT.y;
      return;
    }
    // A few tries for a spot far enough away; after that, take whatever came up.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      toX = (rand() * 2 - 1) * motion.reach;
      toY = FLOOR_TOP + rand() * 1.1 * motion.reach;
      if (Math.hypot(toX - x, toY - y) >= MIN_TRAVEL) break;
    }
  };

  const startCrouch = (): void => {
    phase = 'crouch';
    clock = 0;
  };

  const step = (dtRaw: number, motion: DjMotion): HopPose => {
    const dt = Math.max(0, Math.min(0.1, dtRaw));
    tilt += (motion.tilt - tilt) * (1 - Math.exp(-dt / TILT_EASE));

    if (phase === 'crouch') {
      clock += dt;
      const t = Math.min(1, clock / motionTokens.duration.crouch);
      squash.value = CROUCH_SQUASH * t * (2 - t);
      squash.velocity = 0;
      if (clock >= motionTokens.duration.crouch) {
        phase = 'air';
        clock = 0;
        if (!double) aim(motion);
        else { fromX = x; fromY = y; toX = x; toY = y; }
        flight = between(motion.flight) * (double ? DOUBLE_SCALE : 1);
        apex = motion.height * (double ? DOUBLE_SCALE : 1);
      }
    } else if (phase === 'air') {
      clock += dt;
      const u = Math.min(1, clock / flight);
      x = fromX + (toX - fromX) * u;
      y = fromY + (toY - fromY) * u;
      lift = 4 * apex * u * (1 - u);
      // Fastest, so most stretched, at takeoff and landing; round at the top.
      squash.value = STRETCH * Math.abs(2 * u - 1);
      squash.velocity = 0;
      if (u >= 1) {
        x = toX;
        y = toY;
        lift = 0;
        phase = 'land';
        clock = 0;
        squash.value = LANDING_SQUASH;
        squash.velocity = 0;
        const travelled = toX - fromX;
        wobble.value = (travelled === 0 ? (rand() < 0.5 ? -1 : 1) : Math.sign(travelled)) * WOBBLE;
        wobble.velocity = 0;
        double = !double && motion.mode === 'roam' && rand() < motion.doubleHop;
      }
    } else {
      integrate(squash, dt);
      integrate(wobble, dt);
      if (phase === 'land') {
        clock += dt;
        if (double && clock >= DOUBLE_DELAY) {
          startCrouch();
        } else if (!double && settled(squash) && settled(wobble)) {
          phase = 'rest';
          restLeft = between(motion.rest);
        }
      } else {
        // Resting: holds still while thinking, and stays put once it has reached the prompt.
        const arrived = motion.mode === 'listen' && Math.hypot(x - LISTEN_SPOT.x, y - LISTEN_SPOT.y) < 0.02;
        if (motion.mode !== 'still' && !arrived) {
          restLeft -= dt;
          if (restLeft <= 0) startCrouch();
        }
      }
    }

    return { x, y, lift, squash: squash.value, sway: wobble.value + tilt };
  };

  return { step };
}
