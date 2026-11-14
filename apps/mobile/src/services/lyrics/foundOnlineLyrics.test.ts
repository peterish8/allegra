import { chooseLyricsFallback, mapFoundOnlineLyrics } from './foundOnlineLyrics';
import { KIND_LABEL, lyricsKind } from './lyricsChoice';

describe('Found online lyrics mapping', () => {
  it('keeps estimated timestamps out of plain lyric text and labels the source', () => {
    const mapped = mapFoundOnlineLyrics({
      success: true,
      data: {
        source: 'Found online (Tamil)',
        type: 'plain',
        matchScore: 30,
        matchReason: 'Plain text',
        lines: [
          { timestamp: 12, text: 'First line', lineOrder: 0 },
          { timestamp: 18, text: 'Second line', lineOrder: 1 },
        ],
      },
    });
    expect(mapped).toEqual({
      type: 'plain',
      result: { lyrics: 'First line\nSecond line', source: 'Found online' },
    });
    expect(mapped && lyricsKind(mapped.result.lyrics)).toBe('plain');
    expect(KIND_LABEL.plain).toBe('Plain text');
  });

  it('preserves real timestamps on synced lyrics', () => {
    expect(mapFoundOnlineLyrics({
      success: true,
      data: {
        source: 'Allegra (Tamil)',
        type: 'synced',
        lines: [
          { timestamp: 12.34, text: 'First line', lineOrder: 0 },
          { timestamp: 18, text: 'Second line', lineOrder: 1 },
        ],
      },
    })).toEqual({
      type: 'synced',
      result: { lyrics: '[00:12.34] First line\n[00:18.00] Second line', source: 'Allegra (Tamil)' },
    });
  });

  it('ignores malformed or unsuccessful responses', () => {
    expect(mapFoundOnlineLyrics({ success: false, data: null })).toBeNull();
    expect(mapFoundOnlineLyrics({ success: true, data: { type: 'plain', lines: [] } })).toBeNull();
  });
});

describe('Found online fallback order', () => {
  const plain = { lyrics: 'Existing plain', source: 'JioSaavn' };
  const synced = { lyrics: '[00:10.00] Synced', source: 'LRCLIB' };

  it('keeps existing synced lyrics ahead of every online result', () => {
    expect(chooseLyricsFallback(synced, {
      type: 'synced', result: { lyrics: '[00:20.00] Online synced', source: 'Allegra' },
    })).toBe(synced);
  });

  it('uses online synced lyrics ahead of an existing plain fallback', () => {
    const online = { type: 'synced' as const, result: { lyrics: '[00:20.00] Online synced', source: 'Allegra' } };
    expect(chooseLyricsFallback(plain, online)).toBe(online.result);
  });

  it('keeps existing plain lyrics ahead of online plain lyrics, then uses online plain when alone', () => {
    const online = { type: 'plain' as const, result: { lyrics: 'Website words', source: 'Found online' } };
    expect(chooseLyricsFallback(plain, online)).toBe(plain);
    expect(chooseLyricsFallback(null, online)).toBe(online.result);
  });
});
