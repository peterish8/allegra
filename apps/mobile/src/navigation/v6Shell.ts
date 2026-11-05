/** Insets are included once, shared by the native bar, mini player and list clearance. */
export const SEEK_BAND_HEIGHT = 24;
export const MINI_ROW_HEIGHT = 56;
export const shellNavHeight = (screenHeight: number, bottomInset: number): number =>
  screenHeight < 700 ? 64 + Math.max(8, bottomInset) : 64 + bottomInset;
export const shellHeight = (screenHeight: number, bottomInset: number, hasSong: boolean, fontScale = 1): number =>
  shellNavHeight(screenHeight, bottomInset) + (hasSong ? SEEK_BAND_HEIGHT + (fontScale >= 1.6 ? 72 : MINI_ROW_HEIGHT) : 0);
