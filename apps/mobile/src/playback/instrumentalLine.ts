import { isInstrumentalLine } from '@shared/lyricsText';

/**
 * A music break: a blank line, or one of the "[INSTRUMENTAL]" markers. The in-app lyrics draw the equalizer
 * for it instead of text, and so do the native lyrics, which are told by JavaScript so the two cannot disagree.
 */
export function isInstrumentalLyric(text: string): boolean {
  // A blank line is a break on the phone; the markers are the same everywhere (@shared/lyricsText).
  return !text.trim() || isInstrumentalLine(text);
}
