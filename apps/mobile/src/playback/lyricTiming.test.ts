import { lyricTimingRows, MAX_SWEEP_WORDS } from './lyricTiming';

const same = (text: string) => text;

describe('lyricTimingRows', () => {
  test('takes the lyrics delay off both the line start and every syllable', () => {
    const rows = lyricTimingRows(
      [{ timestamp: 2, text: 'First word', words: [{ text: 'First ', start: 2, end: 3 }, { text: 'word', start: 3.5, end: 4 }] }],
      0.5,
      same,
    );
    expect(rows[0].atMs).toBe(1500);
    expect(rows[0].segments).toEqual([
      { from: 0, to: 5, startMs: 1500, endMs: 2500 },
      { from: 6, to: 10, startMs: 3000, endMs: 3500 },
    ]);
  });

  test('a line with real word times uses them, never an estimate', () => {
    const [row] = lyricTimingRows(
      [{ timestamp: 1, text: 'ab cd', words: [{ text: 'ab ', start: 1, end: 1.2 }, { text: 'cd', start: 5, end: 5.4 }] }],
      0,
      same,
    );
    // The gap between the words is real silence, not smoothed over.
    expect(row.segments.map(s => [s.startMs, s.endMs])).toEqual([[1000, 1200], [5000, 5400]]);
  });

  test('a line-timed source is estimated inside its own line and never runs into the next', () => {
    const rows = lyricTimingRows(
      [{ timestamp: 10, text: 'hello there' }, { timestamp: 14, text: 'next' }],
      0,
      same,
    );
    const last = rows[0].segments[rows[0].segments.length - 1]!;
    expect(rows[0].segments[0]!.startMs).toBeGreaterThanOrEqual(10_000);
    expect(last.endMs).toBeLessThanOrEqual(14_000);
    expect(last.to).toBeCloseTo('hello there'.length, 5);
  });

  test('a blank or music-break line carries no sweep', () => {
    const rows = lyricTimingRows([{ timestamp: 0, text: '' }, { timestamp: 3, text: '[INSTRUMENTAL]' }], 0, same);
    expect(rows[0].segments).toEqual([]);
    expect(rows[0].text).toBe('');
    expect(rows[1].atMs).toBe(3000);
  });

  test('a run-on line lights as a whole instead of mounting a sweep per word', () => {
    const text = Array.from({ length: MAX_SWEEP_WORDS + 1 }, (_, i) => `w${i}`).join(' ');
    const [row] = lyricTimingRows([{ timestamp: 1, text }], 0, same);
    expect(row.segments).toEqual([]);
  });

  test('never starts before zero and ignores a non-finite delay', () => {
    const [row] = lyricTimingRows([{ timestamp: 0.2, text: 'x' }], 5, same);
    expect(row.atMs).toBe(0);
    expect(lyricTimingRows([{ timestamp: 4, text: 'x' }], Number.NaN, same)[0].atMs).toBe(4000);
  });

  test('shape decides the text the offsets refer to', () => {
    const [row] = lyricTimingRows([{ timestamp: 1, text: '  padded line  ' }], 0, t => t.trim());
    expect(row.text).toBe('padded line');
    expect(row.segments[row.segments.length - 1]!.to).toBeLessThanOrEqual(row.text.length);
  });
});
