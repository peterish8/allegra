import { motionTokens, spring } from '../motion';
import type { DjMotion } from './djDance';

/**
 * The DJ mascot floats: it glides to a new spot on an eased path, bobbing softly the whole time, and
 * now and then (`motion.hopChance`) it hops there instead, like a ball: a crouch, an arc, a squash and a
 * wobble on landing. Pure and clock-free (the caller feeds `dt`), so it can be checked without a browser.
 *
 * All values are unitless and meant for CSS custom properties:
 *  - `x`, `y`: where it is, as fractions of the stage's roam box (-1..1; y grows downward, toward the prompt).
 *  - `lift`: how high above its spot it is, as a fraction of its own height (0 on the ground).
 *  - `squash`: negative when crushed against the floor, positive when stretched in flight.
 *  - `sway`: degrees of lean or wobble.
 */
export interface HopPose {
  readonly x: number;
  readonly y: number;
  readonly lift: number;
  readonly squash: number;
  readonly sway: number;
  /** True while it is in the air on a hop (not while floating). */
  readonly airborne: boolean;
}

export interface Hopper {
  readonly step: (dt: number, motion: DjMotion) => HopPose;
}

type Phase = 'rest' | 'glide' | 'crouch' | 'air' | 'land';

/** The prompt sits below the stage; listening parks the mascot at the bottom middle of its box. */
const LISTEN_SPOT = { x: 0, y: 0.9 } as const;
/** The floor of the roam box: a move never ends higher than this, so a hop's arc has room above it. */
const FLOOR_TOP = -0.1;
/** A new spot must be at least this far from the old one, or it is not a move to somewhere. */
const MIN_TRAVEL = 0.25;
const CROUCH_SQUASH = -0.16;
const STRETCH = 0.14;
const LANDING_SQUASH = -0.24;
/** Degrees of wobble thrown into a landing, in the direction of travel. */
const WOBBLE = 6;
/** Degrees of lean into a glide, at its middle. */
const GLIDE_LEAN = 3;
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

/** Slow at both ends, like something floating rather than pushed. */
const easeInOut = (u: number): number => u * u * (3 - 2 * u);

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
  let glide: number = motionTokens.duration.floatEasy;
  let apex = 0;
  let double = false;
  let lift = 0;
  let lean = 0;
  let bobClock = 0;
  let bob = 0;
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

  /** Floating is the usual move; a hop is the occasional one. Listening always floats down to the prompt. */
  const startMove = (motion: DjMotion): void => {
    if (motion.mode === 'roam' && rand() < motion.hopChance) {
      startCrouch();
      return;
    }
    aim(motion);
    phase = 'glide';
    clock = 0;
    glide = between(motion.glide);
  };

  const step = (dtRaw: number, motion: DjMotion): HopPose => {
    const dt = Math.max(0, Math.min(0.1, dtRaw));
    tilt += (motion.tilt - tilt) * (1 - Math.exp(-dt / TILT_EASE));

    // The bob runs under everything while roaming, and eases out when thinking or listening.
    bobClock += dt;
    const bobTarget = motion.mode === 'roam' ? motion.bob : 0;
    bob += (bobTarget - bob) * (1 - Math.exp(-dt / TILT_EASE));
    const bobLift = bob * (0.5 - 0.5 * Math.cos((2 * Math.PI * bobClock) / motionTokens.duration.floatBob));

    if (phase === 'glide') {
      clock += dt;
      const u = Math.min(1, clock / glide);
      const eased = easeInOut(u);
      x = fromX + (toX - fromX) * eased;
      y = fromY + (toY - fromY) * eased;
      lean = Math.sign(toX - fromX) * GLIDE_LEAN * Math.sin(Math.PI * u);
      if (u >= 1) {
        x = toX;
        y = toY;
        lean = 0;
        phase = 'rest';
        restLeft = between(motion.rest);
      }
    } else if (phase === 'crouch') {
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
          if (restLeft <= 0) startMove(motion);
        }
      }
    }

    return { x, y, lift: lift + bobLift, squash: squash.value, sway: wobble.value + lean + tilt, airborne: phase === 'air' };
  };

  return { step };
}
