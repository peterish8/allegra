import { hasWordTags, parseWordTags } from '../shared/wordSync.js';
import type { LyricLine } from '../types.js';

const TIMESTAMP = /(?:\[\s*|\(\s*|)(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?(?:\s*\]|\s*\)|)/g;

/** LRC header tags such as [ar:Artist], [length: 3:47] or [offset:+200]. They are metadata, not lyrics. */
const ID_TAG = /^\s*\[\s*(?:ar|ti|al|au|by|length|offset|re|ve|id|la|tool|#)\s*:/i;

/** The `[mm:ss.xx]` stamps that open a line, when its text carries word tags (whose times are not line times). */
const LEADING_STAMPS = /^\s*((?:\[\s*\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\s*\]\s*)+)/;

export function parseLyrics(raw: string, duration: number): LyricLine[] {
  const timed: { timestamp: number; content: string }[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (ID_TAG.test(line)) {
      continue;
    }
    // Enhanced LRC: only the leading [stamps] are line times; the <stamps> after them time the words.
    const lead = hasWordTags(line) ? line.match(LEADING_STAMPS) : null;
    const stamps = [...(lead ? lead[1] ?? '' : line).matchAll(TIMESTAMP)];
    if (stamps.length === 0) {
      continue;
    }
    const content = lead ? line.slice(lead[0].length) : line.replace(TIMESTAMP, '');
    for (const stamp of stamps) {
      const minutes = Number.parseInt(stamp[1] ?? '0', 10);
      const seconds = Number.parseInt(stamp[2] ?? '0', 10);
      const fraction = stamp[3] ?? '';
      const timestamp = minutes * 60 + seconds + (fraction ? Number(fraction) / 10 ** fraction.length : 0);
      timed.push({ timestamp, content });
    }
  }
  timed.sort((left, right) => left.timestamp - right.timestamp);
  const lines: LyricLine[] = timed.map(({ timestamp, content }, index) => {
    const parsed = parseWordTags(content, timestamp, timed[index + 1]?.timestamp);
    const { text } = parsed;
    // A chorus written once under several [stamps] keeps word times for its first singing only.
    const words = parsed.words && Math.abs((parsed.words[0]?.start ?? timestamp) - timestamp) <= 5 ? parsed.words : undefined;
    return text && words ? { timestamp, text, lineOrder: 0, words } : { timestamp, text: text || '[INSTRUMENTAL]', lineOrder: 0 };
  });

  if (lines.length > 0) {
    return lines.map((line, lineOrder) => ({ ...line, lineOrder }));
  }

  const plain = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !ID_TAG.test(line));
  const safeDuration = duration > 0 ? duration : 180;
  const timePerLine = plain.length > 0 ? safeDuration / plain.length : 0;
  return plain.map((text, lineOrder) => ({
    timestamp: lineOrder * timePerLine,
    text,
    lineOrder
  }));
}

export function hasTimestamps(value: string): boolean {
  return /(?:\[\s*|\(\s*|)\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?(?:\s*\]|\s*\)|)/.test(value);
}
