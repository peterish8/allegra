/** Layout of Stream's "Jump back in" tiles, kept apart from the component (and React Native) so it can be tested. */

/** Two tiles a row; one from 130% text, so a title keeps room to be read. */
export const shortcutColumns = (fontScale: number): 1 | 2 => (fontScale >= 1.3 ? 1 : 2);

/**
 * Each tile's width from the window: the grid's side inset on both sides, split into columns. A definite number, never
 * "50%": the feed measures its cells before it knows its own width, and a share of an unknown width gave the grid a
 * stale, far taller size (the blank gap under "Jump back in", 2026-11-06).
 */
export const shortcutCellWidth = (windowWidth: number, columns: 1 | 2, inset: number): number =>
  Math.max(0, Math.floor((windowWidth - inset * 2) / columns));

/** Reserve two title lines and the metadata line, uniformly for the current text scale. */
export const shortcutCellHeight = (fontScale: number): number => Math.max(72, Math.ceil(58 * fontScale + 14));
