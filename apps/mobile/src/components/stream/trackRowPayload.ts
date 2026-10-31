/**
 * What the native song row (`NativeTrackRow`, android/.../views/NativeTrackRowView.kt) is handed, decided in plain
 * TypeScript so it is unit-testable. The numbers mirror `TrackRowGeometry.kt`; `TrackRow` keeps its React Native row as
 * the fallback for iOS, builds without the view and large system font sizes.
 */
import { duotoneFor, hashString, monogramOf } from '../allegra/artworkSeed';

/** `m:ss`, or nothing for a missing or empty length. */
export const formatTrackDuration = (seconds?: number): string => {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** The meta line: artist, the caller's note and the length, whichever are there. */
export const trackRowMeta = (artist: string | undefined, meta: string | undefined, duration: number | undefined): string =>
  [artist, meta, formatTrackDuration(duration)].filter(Boolean).join(' · ');

export const trackRowLabel = (title: string, artist: string | undefined): string => `${title}${artist ? ` by ${artist}` : ''}`;

export interface TrackRowTile {
  base: string;
  mid: string;
  spark: string;
  glyph: string;
  variant: number;
}

/** The generated cover's inputs: the same seed `Artwork` builds it from (the title, or "Untitled", and the artist). */
export const trackRowTile = (title: string, artist: string | undefined): TrackRowTile => {
  const label = title || 'Untitled';
  const seed = `${label}|${artist ?? ''}`;
  const [base, mid, spark] = duotoneFor(seed);
  return { base, mid, spark, glyph: monogramOf(label), variant: hashString(`${seed}#v`) % 3 };
};

/** The only trailing button a row has: the download list's retry. Any other icon keeps the React Native row. */
export const NATIVE_TRAILING_ICON = 'refresh';

/** The row is 64 dp when its text block fits in the 48 dp cover; mirrors `TrackRowGeometry.fitsAtFontScale`. */
export const trackRowFitsFontScale = (fontScale: number, hasProgress: boolean): boolean => {
  const block = (16 + 13) * 1.2 * fontScale + 2 + (hasProgress ? 6 + 2 : 0);
  return block <= 48;
};

export const shouldUseNativeTrackRow = (available: boolean, fontScale: number, hasProgress: boolean, trailingIcon: string | undefined): boolean =>
  available && (trailingIcon === undefined || trailingIcon === NATIVE_TRAILING_ICON) && trackRowFitsFontScale(fontScale, hasProgress);

/** `rgba(r, g, b, a)` or `#rrggbb` as `#aarrggbb` / `#rrggbb` for Color.parseColor. */
export const toNativeColor = (css: string): string => {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css.trim());
  if (!m) return css;
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  const a = m[4] === undefined ? 1 : Number(m[4]);
  return `#${hex(a * 255)}${hex(Number(m[1]))}${hex(Number(m[2]))}${hex(Number(m[3]))}`;
};

interface RowSignal {
  ink: string;
  inkSoft: string;
  inkMuted: string;
  wave: string;
  waveInk: string;
  bg: string;
}

/** The theme colours the row draws with, as the JSON the view reads. */
export const trackRowPalette = (signal: RowSignal, pressed: string): string =>
  JSON.stringify({
    ink: toNativeColor(signal.ink),
    inkSoft: toNativeColor(signal.inkSoft),
    inkMuted: toNativeColor(signal.inkMuted),
    wave: toNativeColor(signal.wave),
    waveInk: toNativeColor(signal.waveInk),
    bg: toNativeColor(signal.bg),
    pressed: toNativeColor(pressed),
  });
