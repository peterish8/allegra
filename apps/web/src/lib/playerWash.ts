/**
 * The full player's background, YouTube Music's recipe: one calm wash of the cover's colour instead of moving
 * blobs. The cover's main colour pools at the top right and fades down into near-black, its second colour gives
 * a low glow from the bottom left, and the left edge is held darker so the cover and the words read on it.
 *
 *   layer 1  a left-edge shade: black 42% at the edge, gone by 38% of the width
 *   layer 2  the main glow: primary at 55% alpha, an ellipse centred at 78% x / 8% y, clear by 62%
 *   layer 3  the low glow: secondary at 26% alpha, an ellipse at 16% x / 100% y, clear by 70%
 *   layer 4  the base: primary mixed 34% into near-black at the top, 16% by 62% down, near-black at the bottom
 *
 * Pure (a palette in, a CSS `background` out), so every stop is tested and nothing animates per frame.
 */
import type { Palette } from './palette';

/** The near-black the wash settles into. A touch of blue so it never reads as a dead grey. */
export const WASH_BASE = '#060509';

interface Rgb { readonly r: number; readonly g: number; readonly b: number }

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#abc" / "#aabbcc" → channels; anything else → null (the caller falls back). */
export function parseHex(hex: string): Rgb | null {
  const found = hex.trim().match(HEX);
  if (!found) return null;
  const digits = found[1]!;
  const v = digits.length === 3 ? digits.split('').map((c) => c + c).join('') : digits;
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
}

const rgba = ({ r, g, b }: Rgb, alpha: number): string => `rgba(${r}, ${g}, ${b}, ${alpha})`;

/** `amount` (0..1) of `color` mixed into `base`, as an opaque rgb(). */
export function mixInto(color: Rgb, base: Rgb, amount: number): string {
  const t = Math.min(1, Math.max(0, amount));
  const ch = (a: number, z: number) => Math.round(z + (a - z) * t);
  return `rgb(${ch(color.r, base.r)}, ${ch(color.g, base.g)}, ${ch(color.b, base.b)})`;
}

/** The CSS `background` for the full player, from the cover's palette. */
export function playerWash(palette: Pick<Palette, 'primary' | 'secondary'>): string {
  const base = parseHex(WASH_BASE)!;
  const primary = parseHex(palette.primary) ?? parseHex('#5b9dff')!;
  const secondary = parseHex(palette.secondary) ?? primary;
  return [
    'linear-gradient(90deg, rgba(0, 0, 0, 0.42) 0%, rgba(0, 0, 0, 0) 38%)',
    `radial-gradient(120% 90% at 78% 8%, ${rgba(primary, 0.55)} 0%, ${rgba(primary, 0)} 62%)`,
    `radial-gradient(90% 80% at 16% 100%, ${rgba(secondary, 0.26)} 0%, ${rgba(secondary, 0)} 70%)`,
    `linear-gradient(180deg, ${mixInto(primary, base, 0.34)} 0%, ${mixInto(primary, base, 0.16)} 62%, ${WASH_BASE} 100%)`
  ].join(', ');
}
