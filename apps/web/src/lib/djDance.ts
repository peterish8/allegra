import { motionTokens } from '../motion';
import type { Palette } from './palette';

/** How the mascot moves while music plays. Chosen from the session's tone and planned energy. */
export type DjDanceVibe = 'calm' | 'steady' | 'bouncy' | 'dreamy';

/** What the mascot is doing right now: wandering, holding still to think, or drifting toward the prompt. */
export type DjRoamMode = 'roam' | 'still' | 'listen';

/** One target pose of the wander. The roam loop eases its live values toward these, so changes never snap. */
export interface DjMotion {
  /** Seconds for one lap of the path. */
  readonly period: number;
  /** Reach of the path as a fraction of the stage's roam box, 0..1. */
  readonly ampX: number;
  readonly ampY: number;
  /** The vertical path runs at this multiple of the horizontal one (2 draws a figure eight). */
  readonly yRatio: number;
  /** Extra vertical offset, -1 (top of the roam box) .. 1 (bottom, toward the prompt). */
  readonly yOffset: number;
  /** Sway in degrees either side of upright, and seconds per sway. */
  readonly sway: number;
  readonly swayPeriod: number;
  /** A fixed lean, degrees. */
  readonly tilt: number;
}

const { roamSlow, roamFast } = motionTokens.duration;

/** The vibe of a turn: coral or high energy bounces, violet dreams, blue or low energy floats, the rest walks. */
export function djDanceVibe(tone: string, energy: number): DjDanceVibe {
  if (tone === 'coral' || energy >= 4) return 'bouncy';
  if (tone === 'violet') return 'dreamy';
  if (tone === 'blue' || energy <= 2) return 'calm';
  return 'steady';
}

const PLAYING: Readonly<Record<DjDanceVibe, DjMotion>> = {
  // Slow float, gentle sway, long loop.
  calm: { period: roamSlow, ampX: 0.8, ampY: 0.7, yRatio: 1, yOffset: 0, sway: 4, swayPeriod: roamSlow / 2, tilt: 0 },
  // A walking pace across the stage, a light rock.
  steady: { period: roamSlow * 0.75, ampX: 1, ampY: 0.5, yRatio: 2, yOffset: 0, sway: 3, swayPeriod: roamSlow / 4, tilt: 0 },
  // Quick laps, wide swings, a bouncy sway.
  bouncy: { period: roamFast, ampX: 1, ampY: 0.85, yRatio: 3, yOffset: 0, sway: 8, swayPeriod: roamFast / 3, tilt: 0 },
  // A slow figure-eight glide with a lazy tilt.
  dreamy: { period: roamSlow, ampX: 0.9, ampY: 0.9, yRatio: 2, yOffset: 0, sway: 10, swayPeriod: roamSlow, tilt: 0 }
};

/** Not playing: an idle wander, slow, with no dance moves. */
const IDLE: DjMotion = { period: roamSlow, ampX: 0.6, ampY: 0.5, yRatio: 1, yOffset: 0, sway: 0, swayPeriod: roamSlow, tilt: 0 };

/**
 * Where the mascot should be heading. Thinking holds it near the middle, leaning; listening lets it
 * drift down toward the prompt. Otherwise playing music dances in the session's vibe and silence idles.
 */
export function djMotionFor(vibe: DjDanceVibe, playing: boolean, mode: DjRoamMode): DjMotion {
  if (mode === 'still') return { ...IDLE, ampX: 0, ampY: 0, tilt: -6 };
  if (mode === 'listen') return { ...IDLE, ampX: 0, ampY: 0, yOffset: 0.9 };
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
