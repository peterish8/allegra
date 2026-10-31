/**
 * Where the cover glow's lights sit and how they drift (allegra/EdgeGlow).
 *
 * The look: black through the middle of the screen, the cover's colour pouring in
 * at an angle from a top corner and rising from the bottom edge, in two tones like
 * the website's listening room (primary and secondary, `--music-*-rgb`). Each light
 * is a wide, shallow ellipse centred just outside its edge, so only its soft rim
 * reaches into the screen and the middle stays black.
 *
 * Every light loops on its own period (no common factor), so the room keeps
 * moving slowly and never visibly repeats, as the website's ambient fields do.
 */

/** [min, max, phase]: a value swinging between min and max on a sine. */
export type Swing = readonly [min: number, max: number, phase: number];

/** Which of the cover's palette colours a light takes. */
export type GlowTone = 'primary' | 'secondary' | 'tertiary';

/** One light: a soft ellipse of one tone, centred just outside an edge. */
export interface EdgeLight {
  readonly tone: GlowTone;
  readonly edge: 'top' | 'bottom';
  /** Centre across the screen, as a share of its width. */
  readonly x: Swing;
  /** How far outside the edge the centre sits, as a share of the screen's height. */
  readonly beyond: number;
  /** Radius along the light's long axis, as a share of the width. */
  readonly radius: number;
  /** Short axis over long axis: how shallow the ellipse is. */
  readonly squash: number;
  /** Tilt in degrees, clockwise: positive dips the light's right end down the screen. */
  readonly angle: Swing;
  /** Gentle breathing of the size. */
  readonly breathe: Swing;
  readonly alpha: number;
  /** Seconds for one full loop. */
  readonly period: number;
}

/** The black under the player's lights; the full cover melts into it. */
export const COVER_GLOW_BASE = '#050507';

/** Player and lyrics: one tone from the top right, the other rising from the bottom. */
export const PLAYER_LIGHTS: readonly EdgeLight[] = [
  { tone: 'primary', edge: 'top', x: [0.6, 0.94, 0], beyond: 0.03, radius: 1.05, squash: 0.4, angle: [12, 26, 0.1], breathe: [0.92, 1.06, 0.3], alpha: 0.82, period: 29 },
  { tone: 'tertiary', edge: 'top', x: [0.02, 0.38, 0.45], beyond: 0.02, radius: 0.72, squash: 0.34, angle: [-22, -10, 0.6], breathe: [0.9, 1.08, 0.2], alpha: 0.42, period: 37 },
  { tone: 'secondary', edge: 'bottom', x: [0.18, 0.62, 0.2], beyond: 0.03, radius: 1.05, squash: 0.36, angle: [6, 18, 0.35], breathe: [0.92, 1.06, 0.7], alpha: 0.78, period: 31 },
  { tone: 'primary', edge: 'bottom', x: [0.62, 0.98, 0.7], beyond: 0.02, radius: 0.62, squash: 0.34, angle: [-18, -6, 0.15], breathe: [0.9, 1.1, 0.5], alpha: 0.4, period: 41 },
];

/** App background: both tones across the top, black below, content on calm black. */
export const ROOM_LIGHTS: readonly EdgeLight[] = [
  { tone: 'primary', edge: 'top', x: [0.55, 0.95, 0], beyond: 0.02, radius: 1.1, squash: 0.5, angle: [8, 24, 0.1], breathe: [0.9, 1.08, 0.3], alpha: 0.78, period: 27 },
  { tone: 'secondary', edge: 'top', x: [0.02, 0.45, 0.5], beyond: 0.02, radius: 0.95, squash: 0.46, angle: [-24, -8, 0.6], breathe: [0.9, 1.08, 0.75], alpha: 0.7, period: 34 },
];

/** Where a swing is `t` seconds into a loop of `period` seconds. */
export const swing = (s: Swing, t: number, period: number): number => {
  'worklet';
  const v = Math.sin(2 * Math.PI * (t / period + s[2]));
  return s[0] + (s[1] - s[0]) * ((v + 1) * 0.5);
};

/** A light's place on the surface at one moment, in points. */
export interface LightPose {
  readonly cx: number;
  readonly cy: number;
  /** Radii in points. */
  readonly rx: number;
  readonly ry: number;
  /** Radians. */
  readonly rotate: number;
}

/** Where a light is at `t` seconds on a `width` × `height` surface. */
export const lightPose = (light: EdgeLight, t: number, width: number, height: number): LightPose => {
  'worklet';
  const size = swing(light.breathe, t, light.period);
  const rx = width * light.radius * size;
  const offset = height * light.beyond;
  return {
    cx: width * swing(light.x, t, light.period),
    cy: light.edge === 'top' ? -offset : height + offset,
    rx,
    ry: rx * light.squash,
    rotate: (swing(light.angle, t, light.period) * Math.PI) / 180,
  };
};

/**
 * How far into the screen a light can reach at its largest, as a share of the
 * height. The middle stays black only while every light stays well short of 0.5.
 */
export const maxReach = (light: EdgeLight, width: number, height: number): number => {
  const rx = width * light.radius * Math.max(light.breathe[0], light.breathe[1]);
  const ry = rx * light.squash;
  const tilt = (Math.max(Math.abs(light.angle[0]), Math.abs(light.angle[1])) * Math.PI) / 180;
  // The furthest point of a tilted ellipse along the vertical axis.
  const reach = Math.sqrt((rx * Math.sin(tilt)) ** 2 + (ry * Math.cos(tilt)) ** 2);
  return Math.max(0, reach - height * light.beyond) / height;
};
