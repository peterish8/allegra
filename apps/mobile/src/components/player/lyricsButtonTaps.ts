/**
 * Taps on the player's lyrics button. One tap shows or hides the lyrics; three quick taps switch between lighting
 * the lyrics letter by letter and line by line (Settings → Lyrics → Highlight); a long press opens the lyrics picker.
 *
 * Opening lyrics never waits: the first tap opens them at once, and taps that follow quickly are counted, so a
 * triple tap from the cover lands on open lyrics in the other style. Closing waits the length of the tap window
 * (a first tap with lyrics showing might be the start of a triple tap, and closing then reopening them would
 * flicker the whole cover-and-lyrics morph). A double tap counts as one.
 */

/** The most time between two taps of one run, in ms. */
export const LYRICS_TAP_WINDOW_MS = 320;

export interface LyricsTapRun {
  /** Taps in this run. */
  count: number;
  /** When the last one landed (ms). */
  at: number;
}

export type LyricsTapAction =
  /** Show or hide the lyrics now. */
  | 'toggle'
  /** Hide the lyrics once the window has passed with no third tap. */
  | 'toggle-later'
  /** Switch letter by letter ↔ line by line. */
  | 'switch-highlight'
  /** A tap counted towards a triple tap; nothing to do now. */
  | 'none';

export const NO_TAPS: LyricsTapRun = { count: 0, at: 0 };

export function lyricsButtonTap(run: LyricsTapRun, now: number, lyricsShown: boolean): { run: LyricsTapRun; action: LyricsTapAction } {
  const continues = run.count > 0 && now - run.at <= LYRICS_TAP_WINDOW_MS;
  if (!continues) return { run: { count: 1, at: now }, action: lyricsShown ? 'toggle-later' : 'toggle' };
  const count = run.count + 1;
  if (count >= 3) return { run: NO_TAPS, action: 'switch-highlight' };
  return { run: { count, at: now }, action: 'none' };
}
