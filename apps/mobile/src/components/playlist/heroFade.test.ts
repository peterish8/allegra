import { heroImageUrl, barFadeRange, fadeAlphaAt, FADE_STOPS, fadeColors, fadeLocations, heroHeight, IMMERSIVE_BLACK, topScrimColors } from './heroFade';

describe('immersive hero', () => {
  it('is about as tall as it is wide, and never more than 55% of the window', () => {
    expect(heroHeight(360, 800)).toBe(378);
    expect(heroHeight(412, 700)).toBe(385);
    expect(heroHeight(800, 600)).toBe(330);
  });

  it('fades to solid black: clear in the top 45%, then eased, full at the bottom edge', () => {
    expect(fadeAlphaAt(0)).toBe(0);
    expect(fadeAlphaAt(0.45)).toBe(0);
    expect(fadeAlphaAt(1)).toBe(1);
    expect(fadeAlphaAt(0.75)).toBeCloseTo(0.42, 5);
  });

  it('only ever gets darker down the hero, in small steps (no hard edge)', () => {
    let last = 0;
    let biggest = 0;
    for (let i = 0; i <= 200; i++) {
      const alpha = fadeAlphaAt(i / 200);
      expect(alpha).toBeGreaterThanOrEqual(last);
      biggest = Math.max(biggest, alpha - last);
      last = alpha;
    }
    // One percent of the hero's height never darkens by more than 4 points of alpha.
    expect(biggest).toBeLessThan(0.04);
  });

  it('is black at every stop, never a tone of the cover', () => {
    for (const colour of [...fadeColors(), ...topScrimColors()]) expect(colour).toMatch(/^rgba\(0,0,0,[\d.]+\)$/);
    expect(IMMERSIVE_BLACK).toBe('#000000');
    expect(fadeColors()).toHaveLength(FADE_STOPS.length);
    expect(fadeLocations()[fadeLocations().length - 1]).toBe(1);
  });

  it('shows the compact title bar only once the hero has mostly scrolled away', () => {
    const [from, to] = barFadeRange(400);
    expect(from).toBeCloseTo(220, 5);
    expect(to).toBeCloseTo(320, 5);
  });
});

describe('heroImageUrl', () => {
  it('asks for a larger picture where the link names a size, and leaves other links alone', () => {
    expect(heroImageUrl('https://lh3.googleusercontent.com/abc=w544-h544-l90-rj')).toBe('https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj');
    expect(heroImageUrl('https://example.com/cover.jpg')).toBe('https://example.com/cover.jpg');
    expect(heroImageUrl(null)).toBeUndefined();
  });
});
