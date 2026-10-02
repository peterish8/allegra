import { DEFAULT_LYRICS_DELAY, isCardPlayerBackground, lyricsTextStyle, migrateLyricsDelay, normalizeMiniPlayerBackground, normalizePlayerBackground } from './settingsStore';

describe('lyrics timing', () => {
  it('starts in sync', () => {
    expect(DEFAULT_LYRICS_DELAY).toBe(0);
  });

  // −1.2 was the old default, so a saved −1.2 was never chosen: it lit every line 1.2 s late.
  it('moves the old untouched default to in sync', () => {
    expect(migrateLyricsDelay(4, -1.2)).toBe(0);
    expect(migrateLyricsDelay(3, -1.2)).toBe(0);
  });

  it('keeps a timing someone set, even the same number once they are on the new version', () => {
    expect(migrateLyricsDelay(4, 0.4)).toBe(0.4);
    expect(migrateLyricsDelay(4, -2)).toBe(-2);
    expect(migrateLyricsDelay(5, -1.2)).toBe(-1.2);
  });

  it('falls back to in sync for a missing or broken value', () => {
    expect(migrateLyricsDelay(4, undefined)).toBe(0);
    expect(migrateLyricsDelay(4, Number.NaN)).toBe(0);
    expect(migrateLyricsDelay(4, 'late')).toBe(0);
  });
});

describe('normalizePlayerBackground', () => {
  it('keeps the two backgrounds that still exist', () => {
    expect(normalizePlayerBackground('apple')).toBe('apple');
    expect(normalizePlayerBackground('blend')).toBe('blend');
  });

  it('keeps the shader wash and YouTube Music', () => {
    expect(normalizePlayerBackground('aura')).toBe('aura');
    expect(normalizePlayerBackground('youtube')).toBe('youtube');
  });

  it('moves the retired glow background to Apple + glow', () => {
    expect(normalizePlayerBackground('glow')).toBe('blend');
  });

  it('falls back to Apple + glow for anything unknown', () => {
    expect(normalizePlayerBackground(undefined)).toBe('blend');
    expect(normalizePlayerBackground(42)).toBe('blend');
  });
});

describe('lyricsTextStyle', () => {
  it('keeps the player default at medium / normal / left', () => {
    expect(lyricsTextStyle(28, 'normal')).toEqual({ fontSize: 28, lineHeight: 34, marginVertical: 16, textAlign: 'left' });
  });

  it('follows text size, line spacing and alignment', () => {
    const style = lyricsTextStyle(34, 'relaxed', 'center');
    expect(style.fontSize).toBeGreaterThan(28);
    expect(style.marginVertical).toBeGreaterThan(16);
    expect(style.textAlign).toBe('center');
    expect(lyricsTextStyle(24, 'compact').fontSize).toBeLessThan(28);
  });

  it('keeps a custom size in range', () => {
    expect(lyricsTextStyle(90, 'normal').fontSize).toBe(44);
    expect(lyricsTextStyle(4, 'normal').fontSize).toBe(20);
    expect(lyricsTextStyle(Number.NaN, 'normal').fontSize).toBe(28);
  });
});

describe('isCardPlayerBackground', () => {
  it('is the two styles that show the artwork as a card', () => {
    expect(isCardPlayerBackground('youtube')).toBe(true);
    expect(isCardPlayerBackground('aura')).toBe(true);
    expect(isCardPlayerBackground('apple')).toBe(false);
    expect(isCardPlayerBackground('blend')).toBe(false);
  });
});

describe('normalizeMiniPlayerBackground', () => {
  it('keeps every style the pill has', () => {
    for (const v of ['glow', 'tint', 'glass', 'black'] as const) expect(normalizeMiniPlayerBackground(v)).toBe(v);
  });

  it('falls back to the glow for anything unknown', () => {
    expect(normalizeMiniPlayerBackground(undefined)).toBe('glow');
    expect(normalizeMiniPlayerBackground('neon')).toBe('glow');
  });
});
