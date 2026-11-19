/**
 * The full player's background, YouTube Music's recipe: one calm wash of the cover's colour instead of moving
 * blobs. The cover's main colour pools at the top right and fades down into near-black, its second colour gives
 * a low glow from the bottom left, and the left edge is held darker so the cover and the words read on it.
 *
 *   layer 1  a left-edge shade: black 42% at the edge, gone by 38% of the width
 *   layer 2  the main glow: primary at up to 55% alpha (less on a pale cover, see `glowAlpha`), an ellipse
 *            centred at 78% x / 8% y, clear by 62%
 *   layer 3  the low glow: secondary at 26% alpha, an ellipse at 16% x / 100% y, clear by 70%
 *   layer 4  the base: primary mixed 34% into near-black at the top, 16% by 62% down, near-black at the bottom
 *
 * Pure (a palette in, a CSS `background` out), so every stop is tested and nothing animates per frame.
 */
import { relativeLuminance, type Palette } from './palette';

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

/** `amount` (0..1) of `color` mixed into `base`. */
function mixRgb(color: Rgb, base: Rgb, amount: number): Rgb {
  const t = Math.min(1, Math.max(0, amount));
  const ch = (a: number, z: number) => Math.round(z + (a - z) * t);
  return { r: ch(color.r, base.r), g: ch(color.g, base.g), b: ch(color.b, base.b) };
}

/** `amount` (0..1) of `color` mixed into `base`, as an opaque rgb(). */
export function mixInto(color: Rgb, base: Rgb, amount: number): string {
  const { r, g, b } = mixRgb(color, base, amount);
  return `rgb(${r}, ${g}, ${b})`;
}

const MAIN_GLOW_ALPHA = 0.55;
/** The main glow's centre, as fractions of the sheet's height: where the base gradient is read for the peak. */
const GLOW_Y = 0.08;
/** The base gradient's two stops: 34% of the cover colour at the top, 16% by 62% of the way down. */
const BASE_TOP = 0.34;
const BASE_MID = 0.16;
const BASE_MID_AT = 0.62;
/** White text on the wash must stay at least this readable (WCAG AA, normal text). */
export const MIN_TEXT_CONTRAST = 4.5;

const toHex = ({ r, g, b }: Rgb): string => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** The wash at the centre of its main glow, the brightest point under the lyrics: the glow over the base gradient. */
export function washPeak(primary: Rgb, glowAlpha: number): Rgb {
  const base = parseHex(WASH_BASE)!;
  const top = mixRgb(primary, base, BASE_TOP);
  const mid = mixRgb(primary, base, BASE_MID);
  const along = GLOW_Y / BASE_MID_AT;
  const under = { r: top.r + (mid.r - top.r) * along, g: top.g + (mid.g - top.g) * along, b: top.b + (mid.b - top.b) * along };
  return { r: primary.r * glowAlpha + under.r * (1 - glowAlpha), g: primary.g * glowAlpha + under.g * (1 - glowAlpha), b: primary.b * glowAlpha + under.b * (1 - glowAlpha) };
}

/** Contrast of white text over the wash's brightest point for a given main-glow alpha. */
export function whiteContrast(primary: Rgb, glowAlpha: number): number {
  return 1.05 / (relativeLuminance(toHex(washPeak(primary, glowAlpha))) + 0.05);
}

/**
 * The main glow's alpha: the full 55%, lowered on a pale cover until white text over the brightest point of
 * the wash still reads at 4.5:1. A cover that is already dark keeps the full glow.
 */
export function glowAlpha(primary: Rgb): number {
  if (whiteContrast(primary, MAIN_GLOW_ALPHA) >= MIN_TEXT_CONTRAST) return MAIN_GLOW_ALPHA;
  let low = 0;
  let high = MAIN_GLOW_ALPHA;
  for (let step = 0; step < 16; step += 1) {
    const mid = (low + high) / 2;
    if (whiteContrast(primary, mid) >= MIN_TEXT_CONTRAST) low = mid;
    else high = mid;
  }
  return Math.floor(low * 100) / 100;
}

/** The CSS `background` for the full player, from the cover's palette. */
export function playerWash(palette: Pick<Palette, 'primary' | 'secondary'>): string {
  const base = parseHex(WASH_BASE)!;
  const primary = parseHex(palette.primary) ?? parseHex('#5b9dff')!;
  const secondary = parseHex(palette.secondary) ?? primary;
  return [
    'linear-gradient(90deg, rgba(0, 0, 0, 0.42) 0%, rgba(0, 0, 0, 0) 38%)',
    `radial-gradient(120% 90% at 78% 8%, ${rgba(primary, glowAlpha(primary))} 0%, ${rgba(primary, 0)} 62%)`,
    `radial-gradient(90% 80% at 16% 100%, ${rgba(secondary, 0.26)} 0%, ${rgba(secondary, 0)} 70%)`,
    `linear-gradient(180deg, ${mixInto(primary, base, 0.34)} 0%, ${mixInto(primary, base, 0.16)} 62%, ${WASH_BASE} 100%)`
  ].join(', ');
}
