import type { LyricaResult } from '../LyricaService';

export interface FoundOnlineLyrics {
  type: 'synced' | 'plain';
  result: LyricaResult;
}

interface ApiLine {
  timestamp: number;
  text: string;
  words?: { start: number; text: string }[];
}

interface ApiPayload {
  source: string;
  type: 'synced' | 'plain';
  lines: ApiLine[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const lineTime = (timestamp: number): string => {
  const centiseconds = Math.max(0, Math.round(timestamp * 100));
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor(centiseconds / 100) % 60;
  const fraction = centiseconds % 100;
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')}]`;
};

const wordTime = (timestamp: number): string => {
  const milliseconds = Math.max(0, Math.round(timestamp * 1000));
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor(milliseconds / 1000) % 60;
  const fraction = milliseconds % 1000;
  return `<${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}>`;
};

const TIME_TAG = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]|<\d{1,3}:\d{1,2}(?:\.\d{1,3})?>/g;

function parsePayload(value: unknown): ApiPayload | null {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) return null;
  const { source, type, lines } = value.data;
  if (typeof source !== 'string' || !source.trim() || (type !== 'synced' && type !== 'plain') || !Array.isArray(lines)) return null;

  const usable = lines.filter((line): line is Record<string, unknown> =>
    isRecord(line)
      && typeof line.timestamp === 'number'
      && Number.isFinite(line.timestamp)
      && typeof line.text === 'string'
      && line.text.trim().length > 0,
  );
  if (usable.length === 0) return null;
  return {
    source,
    type,
    lines: usable.map(line => ({
      timestamp: line.timestamp as number,
      text: line.text as string,
      ...(Array.isArray(line.words) ? {
        words: line.words.filter((word): word is Record<string, unknown> =>
          isRecord(word)
            && typeof word.start === 'number'
            && Number.isFinite(word.start)
            && typeof word.text === 'string',
        ).map(word => ({ start: word.start as number, text: word.text as string })),
      } : {}),
    })),
  };
}

/** Maps the website's payload without ever treating estimated plain-line positions as sung timings. */
export function mapFoundOnlineLyrics(value: unknown): FoundOnlineLyrics | null {
  const payload = parsePayload(value);
  if (!payload) return null;

  if (payload.type === 'plain') {
    const lyrics = payload.lines
      .map(line => line.text.replace(TIME_TAG, '').trim())
      .filter(Boolean)
      .join('\n');
    return lyrics ? { type: 'plain', result: { lyrics, source: 'Found online' } } : null;
  }

  const lyrics = payload.lines
    .map(line => `${lineTime(line.timestamp)} ${line.words?.length
      ? line.words.map(word => `${wordTime(word.start)}${word.text}`).join('')
      : line.text.replace(TIME_TAG, '').trim()}`)
    .filter(line => line.trim().length > 0)
    .join('\n');
  return lyrics ? { type: 'synced', result: { lyrics, source: payload.source } } : null;
}

const hasLineTiming = (lyrics: string): boolean => /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(lyrics);

/** Existing synced lyrics win; online synced lyrics beat plain text; online plain text is the final fallback. */
export function chooseLyricsFallback(
  current: LyricaResult | null,
  online: FoundOnlineLyrics | null,
): LyricaResult | null {
  if (current && hasLineTiming(current.lyrics)) return current;
  if (online?.type === 'synced') return online.result;
  return current ?? online?.result ?? null;
}
