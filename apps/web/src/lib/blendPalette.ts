/**
 * Mixes two cover palettes for a Blend's reveal. Averaging in OKLab rather than sRGB keeps the
 * midpoint of two vivid colours vivid (sRGB averages of complementary colours turn to grey-brown).
 */
import type { Palette } from './palette';

type Lab = readonly [number, number, number];

function channelToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToChannel(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/** '#rrggbb' or '#rgb' → OKLab. An unreadable colour reads as mid grey. */
export function hexToOklab(hex: string): Lab {
  const clean = hex.trim().replace(/^#/u, '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const value = /^[0-9a-f]{6}$/iu.test(full) ? Number.parseInt(full, 16) : 0x777777;
  const r = channelToLinear(((value >> 16) & 255) / 255);
  const g = channelToLinear(((value >> 8) & 255) / 255);
  const b = channelToLinear((value & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

export function oklabToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
  return `#${rgb.map((channel) => Math.round(linearToChannel(channel) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function mix(a: string, b: string): string {
  const x = hexToOklab(a);
  const y = hexToOklab(b);
  return oklabToHex([(x[0] + y[0]) / 2, (x[1] + y[1]) / 2, (x[2] + y[2]) / 2]);
}

export function mixPalettes(a: Palette, b: Palette): Palette {
  return { primary: mix(a.primary, b.primary), secondary: mix(a.secondary, b.secondary), tertiary: mix(a.tertiary, b.tertiary) };
}
