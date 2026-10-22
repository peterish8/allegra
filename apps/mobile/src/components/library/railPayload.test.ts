import {
  RAIL_REACH_LEFT,
  RAIL_REACH_V,
  railHeight,
  railIndexOf,
  railLettersJson,
  railPalette,
  shouldUseNativeRail,
} from './railPayload';

describe('railPayload', () => {
  it('hands over the letters and their list indexes', () => {
    const json = railLettersJson([{ letter: 'A', index: 0 }, { letter: 'B', index: 14 }]);
    expect(JSON.parse(json)).toEqual([{ letter: 'A', index: 0 }, { letter: 'B', index: 14 }]);
  });

  it('hands over only the colours it draws with', () => {
    const palette = JSON.parse(railPalette({ inkSoft: '#111111', wave: '#222222', waveInk: '#333333' })) as Record<string, string>;
    expect(Object.keys(palette).sort()).toEqual(['inkSoft', 'wave', 'waveInk']);
    expect(palette.wave).toBe('#222222');
  });

  it('sizes the rail like its styles', () => {
    expect(railHeight(5, 0.5)).toBe(16 + 75 + 1);
    expect(railHeight(26, 1)).toBe(16 + 390 + 2);
  });

  it('keeps the view reach in step with the bubble (56 dp, 40 dp left of a 26 dp rail)', () => {
    expect(RAIL_REACH_LEFT).toBe(40 + 56 - 26);
    expect(RAIL_REACH_V).toBe(56 / 2);
  });

  it('reads the picked index', () => {
    expect(railIndexOf({ nativeEvent: { index: 12 } })).toBe(12);
    expect(railIndexOf({ nativeEvent: { index: 0 } })).toBe(0);
    expect(railIndexOf({ nativeEvent: { index: -1 } })).toBeNull();
    expect(railIndexOf({ nativeEvent: { index: 1.5 } })).toBeNull();
    expect(railIndexOf({ nativeEvent: { index: '3' } })).toBeNull();
    expect(railIndexOf(undefined)).toBeNull();
  });

  it('is native only with the view and a long enough list', () => {
    expect(shouldUseNativeRail(true, 4)).toBe(true);
    expect(shouldUseNativeRail(true, 3)).toBe(false);
    expect(shouldUseNativeRail(false, 10)).toBe(false);
  });
});
