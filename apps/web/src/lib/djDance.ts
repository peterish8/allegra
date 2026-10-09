import { motionTokens } from '../motion';
import type { Palette } from './palette';

/** How the mascot moves while music plays. Chosen from the session's tone and planned energy. */
export type DjDanceVibe = 'calm' | 'steady' | 'bouncy' | 'dreamy';

/** What the mascot is doing right now: hopping about, holding still to think, or heading for the prompt. */
export type DjRoamMode = 'roam' | 'still' | 'listen';

/** What the mascot is doing: hopping about, holding still to think, or heading for the prompt to listen. */
export interface DjMotion {
  readonly mode: DjRoamMode;
  /** Seconds of rest between hops, [shortest, longest]. */
  readonly rest: readonly [number, number];
  /** Seconds in the air for one hop, [quickest, slowest]. */
  readonly flight: readonly [number, number];
  /** Apex of a hop as a fraction of the mascot's own height. */
  readonly height: number;
  /** How far across the stage a hop may land, 0..1 of the roam box. */
  readonly reach: number;
  /** Chance that a landing leads straight into a second, smaller hop. */
  readonly doubleHop: number;
  /** A fixed lean in degrees. */
  readonly tilt: number;
}

const d = motionTokens.duration;

/** The vibe of a turn: coral or high energy bounces, violet dreams, blue or low energy floats, the rest walks. */
export function djDanceVibe(tone: string, energy: number): DjDanceVibe {
  if (tone === 'coral' || energy >= 4) return 'bouncy';
  if (tone === 'violet') return 'dreamy';
  if (tone === 'blue' || energy <= 2) return 'calm';
  return 'steady';
}

/*
 * Always ball-like, never a glide: even the calmest vibe hops in half a second. What changes with the
 * vibe is how often it hops, how far, how high, and how likely it is to bounce twice.
 */
const PLAYING: Readonly<Record<DjDanceVibe, DjMotion>> = {
  calm: { mode: 'roam', rest: [d.restLazy, d.restIdle], flight: [d.hopEasy, d.hopLazy], height: 0.17, reach: 0.5, doubleHop: 0.1, tilt: 0 },
  steady: { mode: 'roam', rest: [d.restEasy, d.restLazy], flight: [d.hopQuick, d.hopEasy], height: 0.24, reach: 0.75, doubleHop: 0.25, tilt: 0 },
  bouncy: { mode: 'roam', rest: [d.restQuick, d.restEasy], flight: [d.hopQuick, d.hopEasy], height: 0.3, reach: 1, doubleHop: 0.45, tilt: 0 },
  dreamy: { mode: 'roam', rest: [d.restEasy, d.restLazy], flight: [d.hopEasy, d.hopLazy], height: 0.2, reach: 0.6, doubleHop: 0.2, tilt: 0 }
};

/** Not playing: the occasional lazy hop. */
const IDLE: DjMotion = { mode: 'roam', rest: [d.restLazy, d.restIdle], flight: [d.hopEasy, d.hopLazy], height: 0.14, reach: 0.5, doubleHop: 0.05, tilt: 0 };

/**
 * Where the mascot should be heading. Thinking holds it where it is, leaning; listening sends it down
 * to the prompt and keeps it there. Otherwise playing music hops in the session's vibe and silence idles.
 */
export function djMotionFor(vibe: DjDanceVibe, playing: boolean, mode: DjRoamMode): DjMotion {
  if (mode === 'still') return { ...IDLE, mode, tilt: -6 };
  if (mode === 'listen') return { ...IDLE, mode, doubleHop: 0 };
  return playing ? PLAYING[vibe] : IDLE;
}

/**
 * The mascot's colours when no cover is playing, one trio per tone. They are the darkened tones of the
 * stylesheet's `.dj-hero[data-tone]` (`--dj-core`, `--dj-soft`), so they sit on the app background
 * instead of glaring from it.
 */
const TONE_PALETTES: Readonly<Record<string, Palette>> = {
  amber: { primary: '#b9772f', secondary: '#7a5a33', tertiary: '#5c4226' },
  violet: { primary: '#6f5cb8', secondary: '#46508f', tertiary: '#35406f' },
  blue: { primary: '#3f87a6', secondary: '#2f5f7a', tertiary: '#264a60' },
  coral: { primary: '#b95443', secondary: '#8a5238', tertiary: '#6a4030' }
};

export function djTonePalette(tone: string): Palette {
  return TONE_PALETTES[tone] ?? TONE_PALETTES['amber']!;
}
