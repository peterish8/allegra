/**
 * The V6 shell's geometry: the nav bar, the mini player above it and the list clearance they leave.
 * Insets are counted once here and shared by the native bar, the mini player and every screen's clearance,
 * so changing a height below moves all of them together.
 *
 * Normal text: a 16dp seek band (the thin progress line along its top, the band itself the drag target), a 48dp
 * transport row with a 40dp cover, and a 56dp nav: 120dp above the inset, down from 144dp (owner, 2026-11-06:
 * "too large height in mini player especially"). Large text (fontScale ≥ 1.6) keeps a taller 72dp row.
 */
export const SEEK_BAND_HEIGHT = 16;
export const MINI_ROW_HEIGHT = 48;
export const MINI_ROW_HEIGHT_LARGE_TEXT = 72;
export const MINI_COVER_SIZE = 40;
export const NAV_BAR_HEIGHT = 56;

export const miniRowHeight = (fontScale = 1): number => (fontScale >= 1.6 ? MINI_ROW_HEIGHT_LARGE_TEXT : MINI_ROW_HEIGHT);

export const shellNavHeight = (screenHeight: number, bottomInset: number): number =>
  screenHeight < 700 ? NAV_BAR_HEIGHT + Math.max(8, bottomInset) : NAV_BAR_HEIGHT + bottomInset;

export const shellHeight = (screenHeight: number, bottomInset: number, hasSong: boolean, fontScale = 1): number =>
  shellNavHeight(screenHeight, bottomInset) + (hasSong ? SEEK_BAND_HEIGHT + miniRowHeight(fontScale) : 0);
