import type { LyricsHighlight } from './settings';

/**
 * Three quick taps on the player's Lyrics tab switch how lyrics light up, letter by letter or line by
 * line, the same gesture as the phone app's lyrics button (apps/mobile lyricsButtonTaps.ts). Each tap
 * still does its own job (select the tab), so nothing waits for the run to finish.
 */

/** The most time between two taps of one run, in ms (the phone app's window). */
export const LYRICS_TAP_WINDOW_MS = 320;

export interface TapRun {
  /** Taps in this run. */
  readonly count: number;
  /** When the last one landed (ms). */
  readonly at: number;
}

export const NO_TAPS: TapRun = { count: 0, at: 0 };

/** Counts one tap; `triple` is true on the third quick one, and the run starts over. */
export function countLyricsTap(run: TapRun, now: number): { readonly run: TapRun; readonly triple: boolean } {
  const continues = run.count > 0 && now - run.at <= LYRICS_TAP_WINDOW_MS;
  const count = continues ? run.count + 1 : 1;
  if (count >= 3) return { run: NO_TAPS, triple: true };
  return { run: { count, at: now }, triple: false };
}

export function otherHighlight(highlight: LyricsHighlight): LyricsHighlight {
  return highlight === 'letters' ? 'lines' : 'letters';
}

/** What the switch says when it happens. */
export function highlightLabel(highlight: LyricsHighlight): string {
  return highlight === 'letters' ? 'Letter by letter' : 'Line by line';
}
