import { MINI_COVER_SIZE, MINI_ROW_HEIGHT, NAV_BAR_HEIGHT, SEEK_BAND_HEIGHT, miniRowHeight, shellHeight, shellNavHeight } from './v6Shell';

it('uses the compact navigation below 700 while preserving larger safe areas', () => {
  expect(shellNavHeight(699, 0)).toBe(64);
  expect(shellNavHeight(700, 16)).toBe(72);
  expect(shellNavHeight(699, 24)).toBe(80);
});

it('reserves seek, mini row and navigation, with room for large text', () => {
  expect(shellHeight(800, 16, false, 1)).toBe(72);
  expect(shellHeight(800, 16, true, 1)).toBe(136);
  expect(shellHeight(800, 16, true, 2)).toBe(160);
});

// Owner, 2026-11-06: the mini player and nav were too tall and left too little list. The shell gives 24dp
// back to content at normal text (was 24 + 56 + 64 = 144dp above the inset) without dropping below the
// 48dp control target: the cover is 40dp inside a 48dp row.
it('keeps the slimmer shell above the minimum control target', () => {
  expect(SEEK_BAND_HEIGHT + MINI_ROW_HEIGHT + NAV_BAR_HEIGHT).toBe(120);
  expect(MINI_ROW_HEIGHT).toBeGreaterThanOrEqual(48);
  expect(MINI_COVER_SIZE).toBeLessThan(MINI_ROW_HEIGHT);
  expect(miniRowHeight(1.3)).toBe(MINI_ROW_HEIGHT);
  expect(miniRowHeight(1.6)).toBeGreaterThan(MINI_ROW_HEIGHT);
});
