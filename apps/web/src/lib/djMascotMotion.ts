/**
 * The DJ mascot's body, as numbers. Pure and clock-free (the caller feeds `dt` and the audio), so every
 * behaviour can be checked without a browser. The hook in `components/dj/useDjMascot.ts` writes the pose
 * onto the page as custom properties; the stylesheet turns them into `translate`, `scale` and `rotate`.
 *
 * What it does:
 *  - Drifts on a slow figure-of-eight around its stage instead of jumping to random spots, and eases to
 *    a pose when it thinks (centre), listens (down by the prompt) or sleeps.
 *  - Nods along while music plays: each detected beat dips its head forward and lets it spring back,
 *    over a slow side-to-side sway, so it moves in time with the song without dancing about.
 *  - Looks at the pointer, and glances around on its own when nobody is pointing.
 *  - Blinks at random intervals, sometimes twice.
 *  - Reacts: a hop of joy, a head shake, a small nod (`react`).
 */

/** How the mascot moves while music plays. Chosen from the session's tone and energy. */
export type DjDanceVibe = 'calm' | 'steady' | 'bouncy' | 'dreamy';

/** What the mascot is doing: drifting, dancing to music, thinking, listening to the listener, or asleep. */
export type DjMascotMode = 'idle' | 'groove' | 'think' | 'listen' | 'sleep';

export type DjMascotReaction = 'joy' | 'shake' | 'nod';

export interface DjMascotInput {
  readonly mode: DjMascotMode;
  readonly vibe: DjDanceVibe;
  /** The decaying beat pulse from `createOnsetDetector`, 0..0.9. */
  readonly onset: number;
  /** Where the pointer is relative to the mascot (-1..1 each way), or null when nobody is pointing. */
  readonly look: { readonly x: number; readonly y: number } | null;
}

export interface DjMascotPose {
  /** Where it is, as fractions of the stage's roam box (-1..1; y grows downward, toward the prompt). */
  readonly x: number;
  readonly y: number;
  /** How high above its spot it is, as a fraction of its own height. */
  readonly lift: number;
  /** Negative when crushed against the floor, positive when stretched. */
  readonly squash: number;
  /** Degrees of lean. */
  readonly tilt: number;
  /** Where the eyes point, -1..1 each way. */
  readonly lookX: number;
  readonly lookY: number;
  /** 0 open, 1 shut. */
  readonly blink: number;
  /** How far the head is dipped in a nod, 0 upright. */
  readonly nod: number;
}

export interface DjMascotDriver {
  readonly step: (dt: number, input: DjMascotInput) => DjMascotPose;
  readonly react: (reaction: DjMascotReaction) => void;
}

interface Groove {
  /** Drift reach across the box, 0..1. */
  readonly reach: number;
  /** Figure-of-eight speed, radians per second. */
  readonly speed: number;
  /** How hard a beat squashes it. */
  readonly kick: number;
  /** How far a beat lifts it. */
  readonly bounce: number;
  /** Degrees it sways each beat. */
  readonly sway: number;
}

const GROOVES: Readonly<Record<DjDanceVibe, Groove>> = {
  calm: { reach: 0.28, speed: 0.2, kick: 0.6, bounce: 0.12, sway: 2 },
  steady: { reach: 0.36, speed: 0.24, kick: 0.85, bounce: 0.18, sway: 2.5 },
  bouncy: { reach: 0.42, speed: 0.3, kick: 1.1, bounce: 0.26, sway: 3.5 },
  dreamy: { reach: 0.38, speed: 0.16, kick: 0.45, bounce: 0.1, sway: 4 }
};

const IDLE_GROOVE: Groove = { reach: 0.24, speed: 0.14, kick: 0, bounce: 0, sway: 0 };

/** Where each pose parks the mascot, in roam-box fractions. */
const THINK_SPOT = { x: 0, y: -0.08 } as const;
const LISTEN_SPOT = { x: 0, y: 0.8 } as const;
const SLEEP_SPOT = { x: 0, y: 0.35 } as const;
/** Where the eyes go while thinking (up and to the side) and listening (down at the prompt). */
const THINK_LOOK = { x: 0.6, y: -0.75 } as const;
const LISTEN_LOOK = { x: 0, y: 0.9 } as const;

/** A beat is a rise in the onset pulse of at least this much since the last frame. */
const BEAT_RISE = 0.12;
/** With no beat for this long, the dance falls back to a slow sway so it never freezes. */
const QUIET_AFTER = 1.4;
/** The fallback sway's period, seconds. */
const QUIET_PERIOD = 2.4;

/** Seconds between blinks, and the length of one blink. */
const BLINK_GAP: readonly [number, number] = [2.2, 5.6];
const BLINK_LENGTH = 0.16;
const DOUBLE_BLINK = 0.22;
const DOUBLE_BLINK_GAP = 0.2;

/** Seconds between glances when nobody is pointing. */
const GLANCE_GAP: readonly [number, number] = [1.4, 3.8];
/** Nods closer together than this are one nod. */
const NOD_GAP = 0.09;
/**
 * Animation has three levels: ambient (drift, sway), interactive (gaze, nods) and consequential (a hop
 * for a set that landed, a head shake for an error). For this long after a consequential reaction the
 * beat stops adding nods, so the reaction reads clearly instead of blurring into the dance.
 */
const REACTION_FOCUS = 0.9;
/** A head shake lasts this long, at this many shakes a second and this many degrees. */
const SHAKE_LENGTH = 0.55;
const SHAKE_RATE = 5.5;
const SHAKE_DEGREES = 11;

/** Springs are integrated in steps no longer than this, so a stiff spring stays stable at any frame rate. */
const MAX_SUBSTEP = 1 / 240;

interface Spring {
  value: number;
  velocity: number;
  readonly stiffness: number;
  readonly damping: number;
}

function spring(stiffness: number, damping: number, value = 0): Spring {
  return { value, velocity: 0, stiffness, damping };
}

/** Moves a spring toward `target` over `dt` seconds. */
function follow(state: Spring, target: number, dt: number): void {
  let left = dt;
  while (left > 0) {
    const h = Math.min(MAX_SUBSTEP, left);
    state.velocity += (-state.stiffness * (state.value - target) - state.damping * state.velocity) * h;
    state.value += state.velocity * h;
    left -= h;
  }
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function createMascotDriver(rand: () => number = Math.random): DjMascotDriver {
  const between = (range: readonly [number, number]): number => range[0] + (range[1] - range[0]) * rand();

  // Body: a soft, slightly floaty follow for position; a bouncy one for squash; a gentle one for lean.
  const x = spring(7, 4.6);
  const y = spring(7, 4.6, 0.15);
  const lift = spring(70, 9);
  const squash = spring(380, 15);
  const tilt = spring(45, 9);
  // The nod: a quick dip forward on the beat that springs back.
  const nod = spring(170, 15);
  // Eyes: quick saccades that settle.
  const lookX = spring(110, 19);
  const lookY = spring(110, 19);

  let driftClock = rand() * 10;
  let speed = IDLE_GROOVE.speed;
  let reach = IDLE_GROOVE.reach;
  let lastOnset = 0;
  let sinceBeat = QUIET_AFTER;
  let swayTarget = 0;
  let quietNodIn = 0;
  let quietClock = 0;

  let blinkIn = between(BLINK_GAP);
  let blinkClock = -1;
  let doubleQueued = false;
  let secondBlink = false;

  let glanceIn = between(GLANCE_GAP);
  let glance = { x: 0, y: 0 };

  let shakeClock = SHAKE_LENGTH;
  let sinceNod = NOD_GAP;
  let focusLeft = 0;
  let pending: DjMascotReaction[] = [];

  const react = (reaction: DjMascotReaction): void => {
    pending.push(reaction);
  };

  const applyReactions = (): void => {
    for (const reaction of pending) {
      if (reaction === 'joy') {
        lift.velocity += 1.9;
        squash.velocity += 2.6;
        focusLeft = REACTION_FOCUS;
      } else if (reaction === 'shake') {
        shakeClock = 0;
        lift.velocity -= 0.25;
        focusLeft = REACTION_FOCUS;
      } else if (sinceNod >= NOD_GAP) {
        sinceNod = 0;
        nod.velocity += 2.2;
      }
    }
    pending = [];
  };

  const step = (dtRaw: number, input: DjMascotInput): DjMascotPose => {
    const dt = clamp(dtRaw, 0, 0.1);
    sinceNod += dt;
    focusLeft = Math.max(0, focusLeft - dt);
    applyReactions();
    const beatsCount = focusLeft === 0;

    const groove = input.mode === 'groove' ? GROOVES[input.vibe] : IDLE_GROOVE;
    // Reach and speed ease toward the new vibe, so a change of mood never jerks the path.
    const ease = 1 - Math.exp(-dt / 0.8);
    speed += (groove.speed - speed) * ease;
    reach += (groove.reach - reach) * ease;
    driftClock += dt * speed;

    // Where it is heading.
    let targetX: number;
    let targetY: number;
    if (input.mode === 'think') ({ x: targetX, y: targetY } = THINK_SPOT);
    else if (input.mode === 'listen') ({ x: targetX, y: targetY } = LISTEN_SPOT);
    else if (input.mode === 'sleep') ({ x: targetX, y: targetY } = SLEEP_SPOT);
    else {
      // A figure of eight, a little lopsided so the path never visibly repeats.
      targetX = reach * Math.sin(driftClock) * (0.82 + 0.18 * Math.cos(driftClock * 0.37));
      targetY = 0.1 + reach * 0.62 * Math.sin(driftClock * 2 + 0.6);
    }
    follow(x, targetX, dt);
    follow(y, targetY, dt);

    // The groove: a nod on every beat, over a slow sway. Quiet passages keep the sway and a soft nod.
    const rise = input.onset - lastOnset;
    lastOnset = input.onset;
    sinceBeat += dt;
    quietClock += dt;
    if (input.mode === 'groove' && beatsCount && rise > BEAT_RISE) {
      const strength = clamp(input.onset, 0.3, 0.9);
      sinceBeat = 0;
      nod.velocity += groove.kick * 5 * strength;
      lift.velocity -= groove.bounce * strength;
      squash.velocity -= groove.kick * 0.6 * strength;
    }
    if (input.mode === 'groove') {
      swayTarget = groove.sway * Math.sin((2 * Math.PI * quietClock) / QUIET_PERIOD);
      if (beatsCount && sinceBeat >= QUIET_AFTER) {
        quietNodIn -= dt;
        if (quietNodIn <= 0) {
          quietNodIn = QUIET_PERIOD / 2;
          nod.velocity += groove.kick * 1.6;
        }
      }
    } else {
      swayTarget = input.mode === 'think' ? -7 : 0;
    }
    follow(tilt, swayTarget, dt);
    follow(nod, 0, dt);
    follow(lift, 0, dt);
    follow(squash, 0, dt);

    shakeClock += dt;
    const shake = shakeClock < SHAKE_LENGTH
      ? SHAKE_DEGREES * Math.sin(2 * Math.PI * SHAKE_RATE * shakeClock) * (1 - shakeClock / SHAKE_LENGTH)
      : 0;

    // Eyes: pose first, then the pointer, then a glance of its own.
    let eyeX = 0;
    let eyeY = 0;
    if (input.mode === 'think') {
      eyeX = THINK_LOOK.x;
      eyeY = THINK_LOOK.y;
    } else if (input.mode === 'listen') {
      eyeX = LISTEN_LOOK.x;
      eyeY = LISTEN_LOOK.y;
    } else if (input.mode === 'sleep') {
      eyeX = 0;
      eyeY = 0.3;
    } else if (input.look) {
      eyeX = clamp(input.look.x, -1, 1);
      eyeY = clamp(input.look.y, -1, 1);
      glanceIn = between(GLANCE_GAP);
    } else {
      glanceIn -= dt;
      if (glanceIn <= 0) {
        glanceIn = between(GLANCE_GAP);
        // Mostly back to centre, sometimes off to one side.
        glance = rand() < 0.4 ? { x: 0, y: 0 } : { x: (rand() * 2 - 1) * 0.7, y: (rand() * 2 - 1) * 0.45 };
      }
      eyeX = glance.x;
      eyeY = glance.y;
    }
    follow(lookX, eyeX, dt);
    follow(lookY, eyeY, dt);

    // Blinks: random gaps, one in five doubled. Asleep means shut.
    let blink = 0;
    if (input.mode === 'sleep') {
      blink = 1;
    } else if (blinkClock >= 0) {
      blinkClock += dt;
      const u = blinkClock / BLINK_LENGTH;
      blink = u < 0.4 ? u / 0.4 : Math.max(0, 1 - (u - 0.4) / 0.6);
      if (u >= 1) {
        blinkClock = -1;
        blink = 0;
        secondBlink = doubleQueued;
        doubleQueued = false;
        blinkIn = secondBlink ? DOUBLE_BLINK_GAP : between(BLINK_GAP);
      }
    } else {
      blinkIn -= dt;
      if (blinkIn <= 0) {
        blinkClock = 0;
        doubleQueued = !secondBlink && rand() < DOUBLE_BLINK;
      }
    }

    return {
      x: x.value,
      y: y.value,
      lift: lift.value,
      squash: clamp(squash.value, -0.35, 0.3),
      tilt: tilt.value + shake,
      lookX: lookX.value,
      lookY: lookY.value,
      blink,
      nod: clamp(nod.value, -0.15, 0.5)
    };
  };

  return { step, react };
}

/** Loudness must beat the running baseline by this factor, and this floor, to count as a beat. */
const ONSET_RATIO = 1.48;
const ONSET_FLOOR = 0.095;
/** Two beats closer than this are one beat. */
const ONSET_GAP_MS = 300;
const ONSET_CEILING = 0.9;
const ONSET_DECAY = 0.9;
const BASELINE_RATE = 0.025;

export interface OnsetDetector {
  /** Feeds one frame (`level` 0..1, `now` in ms) and returns the pulse, 0..0.9, decaying between beats. */
  readonly next: (level: number, now: number) => number;
}

/** Beat detector over overall loudness. Pure: the caller owns the clock. */
export function createOnsetDetector(): OnsetDetector {
  let baseline = 0.025;
  let pulse = 0;
  let lastOnset = -Infinity;
  return {
    next: (level, now) => {
      baseline += (level - baseline) * BASELINE_RATE;
      const onset = level > Math.max(ONSET_FLOOR, baseline * ONSET_RATIO) && now - lastOnset > ONSET_GAP_MS;
      if (onset) {
        pulse = Math.min(ONSET_CEILING, Math.max(pulse, level * 2.4));
        lastOnset = now;
      } else {
        pulse *= ONSET_DECAY;
      }
      return pulse;
    }
  };
}

/** The vibe of a session: coral or high energy bounces, violet dreams, blue or low energy floats, the rest steps. */
export function djDanceVibe(tone: string, energy: number): DjDanceVibe {
  if (tone === 'coral' || energy >= 4) return 'bouncy';
  if (tone === 'violet') return 'dreamy';
  if (tone === 'blue' || energy <= 2) return 'calm';
  return 'steady';
}
