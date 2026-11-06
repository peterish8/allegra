import { SCRUB_REST_SCALE, scrubFraction, scrubSeconds } from './miniScrub';

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
