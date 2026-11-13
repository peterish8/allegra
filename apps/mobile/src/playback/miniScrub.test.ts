import { SCRUB_REST_SCALE, scrubFraction, scrubSeconds, spokenPosition } from './miniScrub';

describe('mini player scrub (1.41.0)', () => {
  it('follows the finger along the line and never leaves it', () => {
    expect(scrubFraction(50, 200)).toBe(0.25);
    expect(scrubFraction(-20, 200)).toBe(0);
    expect(scrubFraction(260, 200)).toBe(1);
  });

  it('is safe before the line is measured', () => {
    expect(scrubFraction(10, 0)).toBe(0);
    expect(scrubFraction(Number.NaN, 200)).toBe(0);
  });

  it('seeks to the matching second, and not at all without a known length', () => {
    expect(scrubSeconds(0.5, 200)).toBe(100);
    expect(scrubSeconds(1.2, 200)).toBe(200);
    expect(scrubSeconds(0.5, 0)).toBeNull();
    expect(scrubSeconds(0.5, Number.NaN)).toBeNull();
  });

  it('rests thin and thickens under the finger', () => {
    expect(SCRUB_REST_SCALE).toBeGreaterThan(0);
    expect(SCRUB_REST_SCALE).toBeLessThan(1);
  });
});

describe('the position TalkBack speaks on the seek band', () => {
  it('holds still between five-second steps, so the pill re-renders once in five ticks', () => {
    const spoken = [10, 11, 12, 13, 14, 15, 16].map(spokenPosition);
    expect(spoken).toEqual([10, 10, 10, 10, 10, 15, 15]);
    expect(new Set([0, 1, 2, 3, 4].map(spokenPosition)).size).toBe(1);
  });

  it('is never ahead of the song and is safe before a position is known', () => {
    expect(spokenPosition(14.99)).toBeLessThanOrEqual(14.99);
    expect(spokenPosition(-3)).toBe(0);
    expect(spokenPosition(Number.NaN)).toBe(0);
  });
});
