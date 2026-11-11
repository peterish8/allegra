/**
 * The V6 shell's geometry: the nav bar, the mini player above it and the list clearance they leave.
 * Insets are counted once here and shared by the native bar, the mini player and every screen's clearance,
 * so changing a height below moves all of them together.
 *
 * Normal text: a 12dp seek band (the rounded progress line along its top, the band itself the drag target), a 48dp
 * transport row with a 40dp cover, and a 56dp nav: 116dp above the inset, down from 144dp (owner, 2026-11-06:
 * "too large height in mini player especially"; 1.41.0 took 4dp more off the band). Large text (fontScale ≥ 1.6)
 * keeps a taller 72dp row.
 */
/** 1.41.0: 12 (was 16). The scrub line sits along its top and thickens under the finger (MiniScrubber). */
export const SEEK_BAND_HEIGHT = 12;
export const MINI_ROW_HEIGHT = 48;
export const MINI_ROW_HEIGHT_LARGE_TEXT = 72;
export const MINI_COVER_SIZE = 40;
export const NAV_BAR_HEIGHT = 56;
const NAV_LABEL_SP = 12;

/** Grows the shell tab target when system text grows; the normal 56dp geometry stays unchanged. */
export const navBarHeight = (fontScale = 1): number =>
  Math.max(NAV_BAR_HEIGHT, Math.ceil(6 + 24 + 4 + NAV_LABEL_SP * Math.max(1, fontScale) * 1.3 + 4));

export const miniRowHeight = (fontScale = 1): number => (fontScale >= 1.6 ? MINI_ROW_HEIGHT_LARGE_TEXT : MINI_ROW_HEIGHT);

export const shellNavHeight = (screenHeight: number, bottomInset: number, fontScale = 1): number => {
  const navHeight = navBarHeight(fontScale);
  return screenHeight < 700 ? navHeight + Math.max(8, bottomInset) : navHeight + bottomInset;
};

export const shellHeight = (screenHeight: number, bottomInset: number, hasSong: boolean, fontScale = 1): number =>
  shellNavHeight(screenHeight, bottomInset, fontScale) + (hasSong ? SEEK_BAND_HEIGHT + miniRowHeight(fontScale) : 0);
