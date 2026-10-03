/**
 * Word- and syllable-timed lyrics, for the API, the website and the phone.
 *
 * The richest lyric sources (YouLyPlus, BetterLyrics, Apple Music through
 * Paxsenix) time every syllable. They reach us as Apple TTML, a JSON syllable
 * list, or enhanced LRC; all three are carried as enhanced LRC, one line each:
 *
 *   [00:12.30]<00:12.300>Hel<00:12.520>lo <00:12.900>world<00:13.400>
 *
 * The text after a `<time>` tag is sung from that time until the next tag, so a
 * syllable that does not end its word carries no space ("Hel", "lo "), a tag with
 * no text marks a pause, and the closing tag is when the last syllable ends.
 *
 * `displayWords` turns a line into what the screen draws: whole words (so a
 * word never breaks across a wrap) that each know when every one of their
 * syllables is sung, which `sweepAt` turns into how much of the word is lit.
 * A line with no word timings can be given estimated ones, spread over its
 * letters the way Echo Music does it.
 *
 * Every time is in seconds. Imported by the phone through Metro, so this file
 * imports nothing.
 */

/** One sung piece of a line. `text` keeps a trailing space when a word ends there. */
export interface LyricWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** A whole word as it is drawn. */
export interface DisplayWord {
  /** The word with no surrounding space. */
  readonly text: string;
  /** A space follows it (false inside a word split by syllables, and between CJK characters). */
  readonly gapAfter: boolean;
  readonly start: number;
  readonly end: number;
  /** `[start, end, letters]` for each syllable, flattened, for `sweepAt`. */
  readonly segments: readonly number[];
  /** Letters in the word: the sum of the segments' weights. */
  readonly weight: number;
}

const WORD_TAG = /<(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)>/g;
const ANY_WORD_TAG = /<\d{1,3}:\d{1,2}(?:\.\d{1,3})?>/;
/** Scripts written without spaces between words: each character can be its own word. */
const UNSPACED = /[฀-๿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/;
const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
/** A word shorter than this is stretched to it, so its sweep is still seen. */
const MIN_WORD_S = 0.05;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
const squash = (s: string): string => s.replace(/\s+/g, ' ');
const letters = (s: string): number => Math.max(1, Array.from(s).length);

/** Seconds → `[mm:ss.xx]`, a line tag. */
export function lineTag(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `[${pad(Math.floor(ms / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${pad(Math.floor((ms % 1000) / 10))}]`;
}

/** Seconds → `<mm:ss.xxx>`, a word tag. */
export function wordTag(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `<${pad(Math.floor(ms / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${pad(ms % 1000, 3)}>`;
}

export const hasWordTags = (text: string): boolean => ANY_WORD_TAG.test(text);

/** The line with its word tags taken out. */
export const stripWordTags = (text: string): string => squash(text.replace(WORD_TAG, '')).trim();

export const isRtlText = (text: string): boolean => RTL.test(text);

/**
 * Puts the spaces back between syllables using the line's own text: a source
 * that times "beau", "ti", "ful" knows the line reads "beautiful", and one that
 * times whole words without spaces knows they are separate. Empty when the
 * syllables don't spell the line. Without the line, pieces that carry no spaces
 * at all are taken to be whole words.
 */
export function alignSyllables(syllables: readonly LyricWord[], lineText?: string): LyricWord[] {
  const pieces = syllables
    .map(s => ({ text: squash(s.text), start: s.start, end: s.end }))
    .filter(s => s.text.trim() !== '' && Number.isFinite(s.start));
  if (pieces.length === 0) return [];

  const line = lineText ? squash(lineText).trim() : '';
  if (line) {
    // Timed only when the syllables spell the whole line: a line with some words
    // untimed (or that doesn't match its syllables) is lit as a whole instead.
    const aligned: LyricWord[] = [];
    let pos = 0;
    for (const p of pieces) {
      const core = p.text.trim();
      const at = line.indexOf(core, pos);
      if (at < 0) return [];
      pos = at + core.length;
      aligned.push({ text: line[pos] === ' ' ? `${core} ` : core, start: p.start, end: p.end });
    }
    return wordsFor(line, aligned) ? aligned : [];
  }
  if (pieces.length > 1 && !pieces.some(p => /\s/.test(p.text))) {
    return pieces.map((p, i) => (i < pieces.length - 1 && !UNSPACED.test(p.text) ? { ...p, text: `${p.text} ` } : p));
  }
  return pieces;
}

/**
 * One enhanced-LRC line from timed syllables (from `alignSyllables`). A pause
 * between two syllables gets its own empty tag, and the last syllable always
 * closes with one.
 */
export function enhancedLine(lineStart: number, syllables: readonly LyricWord[]): string {
  let out = lineTag(lineStart);
  syllables.forEach((s, i) => {
    const next = syllables[i + 1];
    const end = s.end > s.start ? s.end : next ? next.start : s.start + 0.3;
    out += wordTag(s.start) + s.text;
    if (!next || end < next.start - 0.02) out += wordTag(end);
  });
  return out;
}

/**
 * The text after a line's `[time]` tag → its plain text, plus its words when the
 * text carries word tags. A last syllable with no closing tag is held until the
 * next line, but never for more than three seconds.
 */
export function parseWordTags(content: string, lineStart: number, nextLineStart?: number): { text: string; words?: LyricWord[] } {
  if (!hasWordTags(content)) return { text: squash(content).trim() };

  const tags = Array.from(content.matchAll(WORD_TAG), match => ({
    at: Number(match[1]) * 60 + parseFloat(match[2] ?? '0'),
    index: match.index ?? 0,
    length: match[0].length,
  }));

  const first = tags[0];
  if (!first) return { text: stripWordTags(content) };
  const words: { text: string; start: number; end: number }[] = [];
  const lead = squash(content.slice(0, first.index));
  if (lead.trim()) words.push({ text: lead.trimStart(), start: lineStart, end: first.at });

  tags.forEach((tag, i) => {
    const next = tags[i + 1];
    const text = squash(content.slice(tag.index + tag.length, next ? next.index : content.length));
    const last = words[words.length - 1];
    if (last && Number.isNaN(last.end)) last.end = tag.at;
    if (!text.trim()) {
      // A pause (or a closing tag). A bare space still ends the word before it.
      if (last && text && !last.text.endsWith(' ')) last.text += ' ';
      return;
    }
    if (last && /^\s/.test(text) && !last.text.endsWith(' ')) last.text += ' ';
    words.push({ text: text.trimStart(), start: tag.at, end: NaN });
  });

  const last = words[words.length - 1];
  if (!last) return { text: stripWordTags(content) };
  if (Number.isNaN(last.end)) {
    const held = nextLineStart !== undefined && nextLineStart > last.start ? nextLineStart : last.start + 1;
    last.end = Math.min(held, last.start + 3);
  }
  last.text = last.text.trimEnd();

  const timed = words.map(w => ({ text: w.text, start: w.start, end: Math.max(w.end, w.start + MIN_WORD_S) }));
  return { text: timed.map(w => w.text).join('').trim(), words: timed };
}

/** The words, when they spell exactly the line (a transliteration or an edit leaves them stale). */
export function wordsFor(text: string, words: readonly LyricWord[] | undefined): readonly LyricWord[] | null {
  if (!words || words.length === 0) return null;
  const spelled = squash(words.map(w => w.text).join('')).trim();
  return spelled === squash(text).trim() ? words : null;
}

/**
 * Estimated timings for a line that has none: its words sung one after another,
 * each for its share of the letters. Sung at a natural pace (not stretched over a
 * long instrumental gap) and done before the next line starts.
 */
export function estimateWords(text: string, start: number, nextStart?: number): LyricWord[] {
  const line = squash(text).trim();
  if (!line) return [];
  const pieces: string[] = [];
  const spaced = line.split(' ');
  spaced.forEach((word, i) => {
    const gap = i < spaced.length - 1 ? ' ' : '';
    if (UNSPACED.test(word)) {
      const chars = Array.from(word);
      chars.forEach((c, j) => pieces.push(j === chars.length - 1 ? c + gap : c));
    } else {
      pieces.push(word + gap);
    }
  });
  const room = nextStart !== undefined && nextStart > start ? (nextStart - start) * 0.9 : 4;
  const duration = Math.max(0.3, Math.min(room, 0.3 + letters(line) * 0.085));
  const total = pieces.reduce((n, p) => n + letters(p), 0);
  let at = start;
  return pieces.map(p => {
    const d = (duration * letters(p)) / total;
    const w = { text: p, start: at, end: at + d };
    at += d;
    return w;
  });
}

/** Splits a timed piece that holds several words, sharing its time by letters. */
function splitPhrases(words: readonly LyricWord[]): LyricWord[] {
  const out: LyricWord[] = [];
  for (const w of words) {
    const core = w.text.trim();
    if (!/\s/.test(core)) {
      out.push(w);
      continue;
    }
    const parts = core.split(/\s+/);
    const total = parts.reduce((n, p) => n + letters(p), 0);
    let at = w.start;
    parts.forEach((p, i) => {
      const d = ((w.end - w.start) * letters(p)) / total;
      const trailing = i < parts.length - 1 || /\s$/.test(w.text) ? ' ' : '';
      out.push({ text: p + trailing, start: at, end: at + d });
      at += d;
    });
  }
  return out;
}

/**
 * A line as the screen draws it: whole words, each knowing when its syllables
 * are sung. Uses the line's own word timings when they spell the line; otherwise
 * estimates them when `estimate` is on, else returns null (the line is lit as a whole).
 */
export function displayWords(
  line: { readonly timestamp: number; readonly text: string; readonly words?: readonly LyricWord[] },
  nextTimestamp: number | undefined,
  estimate: boolean,
): DisplayWord[] | null {
  const own = wordsFor(line.text, line.words);
  const source = own ?? (estimate ? estimateWords(line.text, line.timestamp, nextTimestamp) : null);
  if (!source || source.length === 0) return null;

  const out: DisplayWord[] = [];
  let text = '';
  let segments: number[] = [];
  let weight = 0;
  let start = 0;
  let end = 0;
  const close = (gapAfter: boolean) => {
    if (!text) return;
    out.push({ text, gapAfter, start, end, segments, weight });
    text = '';
    segments = [];
    weight = 0;
  };

  for (const w of splitPhrases(source)) {
    const core = w.text.trim();
    if (!core) {
      close(true);
      continue;
    }
    if (/^\s/.test(w.text)) close(true);
    const n = letters(core);
    if (!text) start = w.start;
    end = Math.max(w.end, w.start + MIN_WORD_S);
    text += core;
    segments.push(w.start, end, n);
    weight += n;
    if (/\s$/.test(w.text)) close(true);
    else if (UNSPACED.test(core)) close(false);
  }
  close(false);
  return out.length > 0 ? out : null;
}

/**
 * How much of a word is lit at time `t`, 0..1: whole syllables already sung plus
 * the share of the one being sung, by letters. Pure arithmetic, so the phone runs
 * a copy of it on the UI thread every frame.
 */
export function sweepAt(t: number, segments: readonly number[], weight: number): number {
  const n = segments.length;
  if (n < 3 || weight <= 0) return 0;
  if (t <= (segments[0] ?? 0)) return 0;
  if (t >= (segments[n - 2] ?? 0)) return 1;
  let lit = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    const s = segments[i] ?? 0;
    const e = segments[i + 1] ?? 0;
    const w = segments[i + 2] ?? 0;
    if (t >= e) {
      lit += w;
    } else {
      if (t > s) lit += (w * (t - s)) / (e - s);
      break;
    }
  }
  return Math.min(1, lit / weight);
}
