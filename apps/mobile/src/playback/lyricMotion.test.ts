import { sweepAt } from '@shared/wordSync';
import { GLIDE_SMOOTH_S, glideSettled, glideStep, lineRestOpacity, lyricSweep } from './lyricMotion';

describe('lyricSweep', () => {
  it('matches the shared sweep it copies', () => {
    const segs = [1, 1.2, 4, 1.2, 1.4, 2, 1.4, 1.8, 3];
    for (let t = 0.8; t <= 2; t += 0.05) expect(lyricSweep(t, segs, 9)).toBeCloseTo(sweepAt(t, segs, 9), 9);
    expect(lyricSweep(1, [], 0)).toBe(0);
  });
});

describe('glideStep', () => {
  const run = (offset: number, velocity: number, seconds: number) => {
    let s = { offset, velocity };
    for (let t = 0; t < seconds; t += 1 / 60) s = glideStep(s.offset, s.velocity, 1 / 60, GLIDE_SMOOTH_S);
    return s;
  };

  it('eases a jump home with no overshoot and settles within ~1.5 s', () => {
    let s = { offset: 120, velocity: 0 };
    let min = Infinity;
    for (let i = 0; i < 90; i++) {
      s = glideStep(s.offset, s.velocity, 1 / 60);
      min = Math.min(min, s.offset);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(glideSettled(run(120, 0, 1.6))).toBe(true);
  });

  it('starts gently rather than at full speed', () => {
    const first = glideStep(100, 0, 1 / 60);
    const later = glideStep(first.offset, first.velocity, 1 / 60);
    expect(100 - first.offset).toBeLessThan(first.offset - later.offset + 1);
  });

  it('keeps its speed when a new line lands mid-glide', () => {
    const mid = run(100, 0, 0.3);
    const after = glideStep(mid.offset + 80, mid.velocity, 1 / 60);
    expect(Math.sign(after.velocity)).toBe(Math.sign(mid.velocity));
  });
});

describe('lineRestOpacity', () => {
  it('lights the sung line and lets the lines just sung stay brighter than the ones to come', () => {
    expect(lineRestOpacity(5, 5, false, false)).toBe(1);
    expect(lineRestOpacity(5, 5, false, true)).toBe(0.45);
    expect(lineRestOpacity(4, 5, false, false)).toBeGreaterThan(lineRestOpacity(6, 5, false, false));
    expect(lineRestOpacity(1, 5, false, false)).toBeLessThan(lineRestOpacity(4, 5, false, false));
    expect(lineRestOpacity(9, 5, true, false)).toBe(0.62);
  });
});
