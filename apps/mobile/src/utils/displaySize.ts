/**
 * Display size (Settings → Player): the whole app a little smaller or larger, text, icons, spacing and the bars
 * together. Android applies it natively (startup/DisplayScale.kt) by setting the app's density before React starts;
 * saving one rebuilds the screen at the new size while playback carries on. Elsewhere it is not offered.
 *
 * These four steps must match DisplayScale.CHOICES.
 */
export type DisplaySize = 'compact' | 'small' | 'default' | 'large';

export const DISPLAY_SIZES: readonly { value: DisplaySize; label: string; scale: number }[] = [
  { value: 'compact', label: 'Compact', scale: 0.85 },
  { value: 'small', label: 'Small', scale: 0.92 },
  { value: 'default', label: 'Default', scale: 1 },
  { value: 'large', label: 'Large', scale: 1.08 },
];

/** The offered size nearest a native scale; a bad value reads as the default. */
export function sizeForScale(scale: number | null | undefined): DisplaySize {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return 'default';
  let best = DISPLAY_SIZES[2];
  for (const size of DISPLAY_SIZES) if (Math.abs(size.scale - scale) < Math.abs(best.scale - scale)) best = size;
  return best.value;
}

export function scaleForSize(size: DisplaySize): number {
  return DISPLAY_SIZES.find(s => s.value === size)?.scale ?? 1;
}
