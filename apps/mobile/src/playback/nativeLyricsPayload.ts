/**
 * What the Kotlin lyrics (`NativeLyricsView`) are told: the lines with the player-clock times the island uses
 * (`lyricTimingRows`), whether each is a music break, and the text style to lay them out in. Built in one place so the
 * native list and the React Native list (`SynchronizedLyrics`) agree on what a line is, and so nothing native invents
 * a time: a line without usable timing has no segments and lights as a whole.
 */
import type { LyricWord } from '@shared/wordSync';
import { sfTracking } from '../constants/fonts';
import { isInstrumentalLyric } from './instrumentalLine';
import { lyricTimingRows } from './lyricTiming';

export interface NativeLyricLine {
  timestamp: number;
  text: string;
  words?: readonly LyricWord[];
}

/** True when no line carries a time: plain text, which the React Native list scrolls on its own schedule. */
export const isPlainLyrics = (lines: readonly NativeLyricLine[]): boolean =>
  lines.length > 0 && lines.every(line => line.timestamp === 0 && !line.words?.length);

export function nativeLyricsPayload(
  songId: string,
  lines: readonly NativeLyricLine[],
  delaySeconds: number,
  letters: boolean,
): string {
  const timed = lines.filter(line => Number.isFinite(line.timestamp));
  const rows = lyricTimingRows(timed, delaySeconds, text => text);
  return JSON.stringify({
    songId,
    letters,
    rows: rows.map((row, i) => {
      const instrumental = isInstrumentalLyric(row.text);
      return {
        atMs: row.atMs,
        ts: timed[i]!.timestamp,
        text: row.text,
        instrumental,
        segments: letters && !instrumental ? row.segments : [],
      };
    }),
  });
}

export interface NativeLyricsStyle {
  fontSize: number;
  lineHeight?: number;
  gap: number;
  align: 'left' | 'center' | 'right';
  activePos: number;
  topSpacer: number;
  bottomSpacer: number;
  edgeFade: number;
  title?: string;
  reduceMotion: boolean;
  lowEnd: boolean;
}

export function nativeLyricsConfig(style: NativeLyricsStyle): string {
  return JSON.stringify({
    fontSize: style.fontSize,
    lineHeight: style.lineHeight ?? Math.round(style.fontSize * 1.22),
    tracking: sfTracking(style.fontSize),
    gap: style.gap,
    align: style.align,
    padH: 28,
    activePos: style.activePos,
    topSpacer: style.topSpacer,
    bottomSpacer: style.bottomSpacer,
    edgeFade: style.edgeFade,
    title: style.title ?? '',
    // One hard-edged copy under Reduce Motion, two on a low-end phone, three otherwise (as in SynchronizedLyrics).
    featherCount: style.reduceMotion ? 1 : style.lowEnd ? 2 : 3,
    reduceMotion: style.reduceMotion,
  });
}
