import type { LyricLine, LyricsPayload } from '@shared/types';
import type { LyricWord } from '@shared/wordSync';

const PREFIX = 'allegra-local-lyric-timing-v1:';

export function rememberLocalTiming(ref: string, payload: LyricsPayload): void {
  try { localStorage.setItem(PREFIX + ref, JSON.stringify(payload)); } catch { /* Preview still works when storage is full. */ }
}

export function readLocalTiming(ref: string): LyricsPayload | null {
  try {
    const raw = localStorage.getItem(PREFIX + ref);
    if (!raw || raw.length > 500_000) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('lines' in value) || !Array.isArray(value.lines) || value.lines.length > 3000) return null;
    let previous = -1;
    const lines: LyricLine[] = [];
    for (const line of value.lines as unknown[]) {
      if (!line || typeof line !== 'object' || !('timestamp' in line) || typeof line.timestamp !== 'number' || !Number.isFinite(line.timestamp) || line.timestamp < 0 || line.timestamp < previous || !('text' in line) || typeof line.text !== 'string') return null;
      previous = line.timestamp;
      const words: LyricWord[] = [];
      if ('words' in line && Array.isArray(line.words)) {
        let end = line.timestamp;
        for (const word of line.words as unknown[]) {
          if (!word || typeof word !== 'object' || !('text' in word) || typeof word.text !== 'string' || !('start' in word) || typeof word.start !== 'number' || !Number.isFinite(word.start) || word.start < end || !('end' in word) || typeof word.end !== 'number' || !Number.isFinite(word.end) || word.end <= word.start) return null;
          words.push({ text: word.text, start: word.start, end: word.end }); end = word.end;
        }
      }
      lines.push({ text: line.text, timestamp: line.timestamp, lineOrder: lines.length, ...(words.length ? { words } : {}) });
    }
    return { source: 'On this device', type: 'synced', matchScore: 1, matchReason: 'Timing you previewed and kept on this device.', lines };
  } catch { return null; }
}
