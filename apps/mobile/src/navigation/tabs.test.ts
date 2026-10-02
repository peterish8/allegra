jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import { DOUBLE_TAP_MS, isDoubleTap, playerSheetRest, tabTapParams } from './tabs';

describe('tabTapParams', () => {
  // The ••• menu leaves { screen: 'Playlists' } on the Library tab route; a tap must not replay it.
  it('drops a nested-screen target left on the tab by an earlier navigation', () => {
    expect(tabTapParams({ screen: 'Playlists' })).toBeUndefined();
    expect(tabTapParams({ screen: 'PlaylistDetail', params: { playlistId: 'p1' } })).toBeUndefined();
  });

  it('keeps ordinary params, and nothing at all', () => {
    expect(tabTapParams({ voiceQuery: 'tum hi ho' })).toEqual({ voiceQuery: 'tum hi ho' });
    expect(tabTapParams(undefined)).toBeUndefined();
  });
});

describe('isDoubleTap', () => {
  it('counts a second press inside the window', () => {
    expect(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS - 1)).toBe(true);
  });

  it('ignores a slow second press and a first press', () => {
    expect(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS + 1)).toBe(false);
    expect(isDoubleTap(0, 500)).toBe(false);
  });
});

describe('playerSheetRest', () => {
  it('rests the sheet on the pill, as wide as the pill', () => {
    const rest = playerSheetRest(400, 800, 24, true);
    expect(rest.y).toBeGreaterThan(600);
    expect(rest.y).toBeLessThan(800);
    expect(rest.scale).toBeGreaterThan(0.8);
    expect(rest.scale).toBeLessThan(1);
  });

  it('rests below the screen at full width without a pill', () => {
    expect(playerSheetRest(400, 800, 24, false)).toEqual({ y: 800, scale: 1 });
  });
});
