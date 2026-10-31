jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import { isPlainLyrics, nativeLyricsConfig, nativeLyricsPayload } from './nativeLyricsPayload';

const parse = (json: string) => JSON.parse(json) as {
  songId: string;
  letters: boolean;
  rows: { atMs: number; ts: number; text: string; instrumental: boolean; segments: { from: number; to: number; startMs: number; endMs: number }[] }[];
};

describe('nativeLyricsPayload', () => {
  test('carries the song the lines belong to, so native never applies them to another recording', () => {
    expect(parse(nativeLyricsPayload('song-9', [{ timestamp: 1, text: 'hi' }], 0, true)).songId).toBe('song-9');
  });

  test('a line keeps its own timestamp for the tap and the player-clock time for the follow', () => {
    const { rows } = parse(nativeLyricsPayload('s', [{ timestamp: 2, text: 'First' }, { timestamp: 5, text: 'Second' }], 0.5, true));
    expect(rows.map(r => r.ts)).toEqual([2, 5]);
    expect(rows.map(r => r.atMs)).toEqual([1500, 4500]);
  });

  test('letters mode sends syllable timing with the delay already taken off', () => {
    const { rows } = parse(nativeLyricsPayload('s', [{
      timestamp: 2,
      text: 'First word',
      words: [{ text: 'First ', start: 2, end: 3 }, { text: 'word', start: 3.5, end: 4 }],
    }], 0.5, true));
    expect(rows[0]!.segments).toEqual([
      { from: 0, to: 5, startMs: 1500, endMs: 2500 },
      { from: 6, to: 10, startMs: 3000, endMs: 3500 },
    ]);
  });

  test('line-by-line highlighting sends no segments at all', () => {
    const { letters, rows } = parse(nativeLyricsPayload('s', [{ timestamp: 2, text: 'hello there' }], 0, false));
    expect(letters).toBe(false);
    expect(rows[0]!.segments).toEqual([]);
  });

  test('a blank line and a music-break marker are both drawn as the equalizer, with no sweep', () => {
    const { rows } = parse(nativeLyricsPayload('s', [{ timestamp: 0, text: '' }, { timestamp: 3, text: '[INSTRUMENTAL]' }, { timestamp: 6, text: 'sung' }], 0, true));
    expect(rows.map(r => r.instrumental)).toEqual([true, true, false]);
    expect(rows[0]!.segments).toEqual([]);
    expect(rows[1]!.segments).toEqual([]);
  });

  test('lines without a usable time are left out, never given one', () => {
    const { rows } = parse(nativeLyricsPayload('s', [{ timestamp: Number.NaN, text: 'lost' }, { timestamp: 4, text: 'kept' }], 0, true));
    expect(rows.map(r => r.text)).toEqual(['kept']);
  });

  test('plain lyrics (no times at all) stay with the React Native list', () => {
    expect(isPlainLyrics([{ timestamp: 0, text: 'a' }, { timestamp: 0, text: 'b' }])).toBe(true);
    expect(isPlainLyrics([{ timestamp: 0, text: 'a' }, { timestamp: 4, text: 'b' }])).toBe(false);
    expect(isPlainLyrics([{ timestamp: 0, text: 'a', words: [{ text: 'a', start: 0, end: 1 }] }])).toBe(false);
    expect(isPlainLyrics([])).toBe(false);
  });
});

describe('nativeLyricsConfig', () => {
  const base = { fontSize: 28, gap: 16, align: 'left' as const, activePos: 0.35, topSpacer: 24, bottomSpacer: 320, edgeFade: 56, reduceMotion: false, lowEnd: false };
  const parseConfig = (json: string) => JSON.parse(json) as Record<string, unknown>;

  test('lays out like the list: the same line height, tracking and gap', () => {
    const config = parseConfig(nativeLyricsConfig(base));
    expect(config.lineHeight).toBe(34);
    expect(config.tracking).toBe(-0.8);
    expect(config.gap).toBe(16);
    expect(config.padH).toBe(28);
  });

  test('the sweep edge has three copies, two on a low-end phone and one under Reduce Motion', () => {
    expect(parseConfig(nativeLyricsConfig(base)).featherCount).toBe(3);
    expect(parseConfig(nativeLyricsConfig({ ...base, lowEnd: true })).featherCount).toBe(2);
    expect(parseConfig(nativeLyricsConfig({ ...base, reduceMotion: true })).featherCount).toBe(1);
  });

  test('a missing title is an empty string, not "undefined"', () => {
    expect(parseConfig(nativeLyricsConfig(base)).title).toBe('');
    expect(parseConfig(nativeLyricsConfig({ ...base, title: 'Song' })).title).toBe('Song');
  });
});
