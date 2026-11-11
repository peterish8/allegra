import { MINI_COVER_SIZE, MINI_ROW_HEIGHT, NAV_BAR_HEIGHT, SEEK_BAND_HEIGHT, miniRowHeight, navBarHeight, shellHeight, shellNavHeight } from './v6Shell';

it('uses the compact navigation below 700 while preserving larger safe areas', () => {
  expect(shellNavHeight(699, 0)).toBe(64);
  expect(shellNavHeight(700, 16)).toBe(72);
  expect(shellNavHeight(699, 24)).toBe(80);
});

it('reserves seek, mini row and navigation, with room for large text', () => {
  expect(shellHeight(800, 16, false, 1)).toBe(72);
  expect(shellHeight(800, 16, true, 1)).toBe(132);
  // At 200% text the navigation target grows too (navBarHeight), on top of the large-text mini row.
  expect(shellHeight(800, 16, true, 2)).toBe(navBarHeight(2) + 16 + SEEK_BAND_HEIGHT + miniRowHeight(2));
  expect(shellHeight(800, 16, true, 2)).toBe(170);
});

// Owner, 2026-11-06: the mini player and nav were too tall and left too little list. The shell gives 24dp
// back to content at normal text (was 24 + 56 + 64 = 144dp above the inset) without dropping below the
// 48dp control target: the cover is 40dp inside a 48dp row.
it('keeps the slimmer shell above the minimum control target', () => {
  // 1.41.0: the owner asked for a little less above the mini player: the band is 12dp (was 16).
  expect(SEEK_BAND_HEIGHT + MINI_ROW_HEIGHT + NAV_BAR_HEIGHT).toBe(116);
  // The band still holds the 6dp scrub line with room around it.
  expect(SEEK_BAND_HEIGHT).toBeGreaterThanOrEqual(10);
  expect(MINI_ROW_HEIGHT).toBeGreaterThanOrEqual(48);
  expect(MINI_COVER_SIZE).toBeLessThan(MINI_ROW_HEIGHT);
  expect(miniRowHeight(1.3)).toBe(MINI_ROW_HEIGHT);
  expect(miniRowHeight(1.6)).toBeGreaterThan(MINI_ROW_HEIGHT);
});

it('grows the navigation target with system text and reserves the same height above the gesture inset', () => {
  expect(navBarHeight(1)).toBe(56);
  expect(navBarHeight(1.3)).toBeGreaterThan(NAV_BAR_HEIGHT);
  expect(navBarHeight(2)).toBeGreaterThanOrEqual(68);
  expect(shellNavHeight(800, 24, 2)).toBe(navBarHeight(2) + 24);
  expect(shellHeight(800, 24, false, 2)).toBe(navBarHeight(2) + 24);
});
