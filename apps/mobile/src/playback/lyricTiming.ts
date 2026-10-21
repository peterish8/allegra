/**
 * Lyric timing in the form Kotlin reads: every line with when it starts and, for the letter sweep, which
 * characters are sung between which two moments, all on the player's own clock.
 *
 * The system island and the native Now Playing lyrics both build their rows here, so a syllable is lit at
 * the same moment on both and the word shaping (`@shared/wordSync` `displayWords`: the source's real
 * word/syllable times, or the estimate the in-app lyrics already use for a line-timed source) lives in one
 * place. Nothing is invented here: a line with no usable timing gets no segments and is lit as a whole.
 */
import { displayWords, type LyricWord } from '@shared/wordSync';

export interface TimedLyricLine {
  readonly timestamp: number;
  readonly text: string;
  readonly words?: readonly LyricWord[];
}

export interface LyricTimingSegment {
  /** Characters of the line's text, fractional inside a word. */
  from: number;
  to: number;
  startMs: number;
  endMs: number;
}

export interface LyricTimingRow {
  /** When the line is sung on the player's clock, with the listener's lyrics delay already taken off. */
  atMs: number;
  text: string;
  segments: LyricTimingSegment[];
}

/** A line with more words than this lights as a whole, as in `SynchronizedLyrics` (`MAX_SWEEP_WORDS`). */
export const MAX_SWEEP_WORDS = 24;

/**
 * One row per line. `shape` turns the stored text into the text to show (the island trims and normalises music
 * breaks; the in-app list shows the line as written). Lines whose `timestamp` is not finite are dropped; the
 * caller decides about blank ones before calling.
 */
export function lyricTimingRows(
  lines: readonly TimedLyricLine[],
  delaySeconds: number,
  shape: (text: string) => string,
): LyricTimingRow[] {
  const delay = Number.isFinite(delaySeconds) ? delaySeconds : 0;
  return lines.map((line, index): LyricTimingRow => {
    const text = shape(line.text);
    const segments: LyricTimingSegment[] = [];
    const display = text.trim() ? displayWords({ ...line, text }, lines[index + 1]?.timestamp, true) : null;
    let cursor = 0;
    if (display && display.length <= MAX_SWEEP_WORDS) {
      for (const word of display) {
        const from = text.indexOf(word.text, cursor);
        if (from < 0) continue;
        let weight = 0;
        for (let i = 0; i < word.segments.length; i += 3) {
          const start = from + (word.text.length * weight) / word.weight;
          weight += word.segments[i + 2]!;
          segments.push({
            from: start,
            to: from + (word.text.length * weight) / word.weight,
            startMs: Math.max(0, (word.segments[i]! - delay) * 1000),
            endMs: Math.max(0, (word.segments[i + 1]! - delay) * 1000),
          });
        }
        cursor = from + word.text.length;
      }
    }
    return { atMs: Math.max(0, Math.round((line.timestamp - delay) * 1000)), text, segments };
  });
}
