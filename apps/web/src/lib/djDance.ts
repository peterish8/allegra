import type { Palette } from './palette';

/** The DJ's colour family for a session: coral for energy, violet for night, blue for focus, amber otherwise. */
export type DjTone = 'amber' | 'violet' | 'blue' | 'coral';

export function djToneFor(vibe: string, energy: number): DjTone {
  if (energy >= 4 || /hype|upbeat|energetic|workout|party/i.test(vibe)) return 'coral';
  if (/late|night|dream|melanchol|romantic/i.test(vibe)) return 'violet';
  if (/focus|calm|chill|easy|study/i.test(vibe)) return 'blue';
  return 'amber';
}

/**
 * The DJ's colours when no cover is playing, one trio per tone, darkened to sit on the app background
 * instead of glaring from it.
 */
const TONE_PALETTES: Readonly<Record<DjTone, Palette>> = {
  amber: { primary: '#b9772f', secondary: '#7a5a33', tertiary: '#5c4226' },
  violet: { primary: '#6f5cb8', secondary: '#46508f', tertiary: '#35406f' },
  blue: { primary: '#3f87a6', secondary: '#2f5f7a', tertiary: '#264a60' },
  coral: { primary: '#b95443', secondary: '#8a5238', tertiary: '#6a4030' }
};

export function djTonePalette(tone: string): Palette {
  return TONE_PALETTES[tone as DjTone] ?? TONE_PALETTES.amber;
}
