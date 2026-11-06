import { GLOW_MIN, glowAnimates, glowFrame, glowScroll } from './headerGlowMath';

describe('glowFrame', () => {
  it('covers about the top fifth of the real window plus the status bar', () => {
    expect(glowFrame(800, 24)).toEqual({ body: 184, extent: 294 });
    expect(glowFrame(932, 47).body).toBe(Math.round(932 * 0.2 + 47));
  });

  it('keeps a usable glow on a short window and survives bad input', () => {
    expect(glowFrame(480, 0).body).toBe(GLOW_MIN);
    expect(glowFrame(Number.NaN, -5).body).toBe(GLOW_MIN);
  });
});

describe('glowScroll', () => {
  const frame = glowFrame(800, 24);

  it('rests in place at the top and on a pull to refresh', () => {
    expect(glowScroll(0, frame)).toEqual({ translateY: -0, opacity: 1 });
    expect(glowScroll(-80, frame)).toEqual({ translateY: -0, opacity: 1 });
  });

  it('travels up with the content and fades as the header leaves', () => {
    const half = glowScroll(frame.body / 2, frame);
    expect(half.translateY).toBe(-frame.body / 2);
    expect(half.opacity).toBeCloseTo(0.5);
  });

  it('is gone once the header has scrolled away and comes back the same way', () => {
    expect(glowScroll(frame.body, frame).opacity).toBe(0);
    expect(glowScroll(5000, frame)).toEqual({ translateY: -frame.extent, opacity: 0 });
    expect(glowScroll(10, frame)).toEqual(glowScroll(10, frame));
  });
});

describe('glowAnimates', () => {
  const on = { focused: true, appActive: true, reduceMotion: false, lowEnd: false, batterySaver: false, reduceTransparency: false, scrolledAway: false };

  it('drifts only while seen on a capable device', () => {
    expect(glowAnimates(on)).toBe(true);
  });

  it.each(['focused', 'appActive'] as const)('rests when %s is false', key => {
    expect(glowAnimates({ ...on, [key]: false })).toBe(false);
  });

  it.each(['reduceMotion', 'lowEnd', 'batterySaver', 'reduceTransparency', 'scrolledAway'] as const)('rests under %s', key => {
    expect(glowAnimates({ ...on, [key]: true })).toBe(false);
  });
});
