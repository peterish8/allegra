/**
 * What the native More items (`NativeMoreItems`, android/.../views/NativeMoreItemsView.kt) are handed, decided in plain
 * TypeScript so it is unit-testable. The numbers mirror `MoreMenuGeometry.kt`.
 */

export interface MoreMenuEntry {
  key: string;
  label: string;
  icon: string;
  hint?: string;
}

/** The icons the Kotlin view can draw; a menu with any other falls back to the React Native items. */
export const NATIVE_MORE_ICONS: readonly string[] = ['dj-mascot', 'search', 'albums-outline', 'settings-outline'];

/** The view lays out exactly three tiles across the top. */
export const NATIVE_MORE_TILES = 3;

/**
 * A row is 58 dp at least and grows in React Native when its label and hint need more (large font sizes); the native
 * rows stay 58. Up to this font scale the two lines fit, above it the menu keeps the React Native items.
 */
export const NATIVE_MORE_MAX_FONT_SCALE = 1.3;

export const moreItemsFitFontScale = (fontScale: number): boolean =>
  Number.isFinite(fontScale) && fontScale <= NATIVE_MORE_MAX_FONT_SCALE;

/** `items` JSON for the native view, or null when this menu is not something it can draw. */
export const moreItemsPayload = (tiles: readonly MoreMenuEntry[], rows: readonly MoreMenuEntry[]): string | null => {
  if (tiles.length !== NATIVE_MORE_TILES) return null;
  const all = [...tiles.map(t => ({ ...t, tile: true })), ...rows.map(r => ({ ...r, tile: false }))];
  if (all.some(i => !NATIVE_MORE_ICONS.includes(i.icon))) return null;
  return JSON.stringify(all.map(i => ({ key: i.key, label: i.label, icon: i.icon, hint: i.hint ?? null, tile: i.tile })));
};

/** The theme colours the view needs, from `Signal`: one source of truth. */
export const morePalette = (signal: { ink: string; inkSoft: string; inkMuted: string; inkFaint: string; wave: string }): string =>
  JSON.stringify({ ink: signal.ink, inkSoft: signal.inkSoft, inkMuted: signal.inkMuted, inkFaint: signal.inkFaint, wave: signal.wave });

const TILE_H = 78;
const ROWS_TOP_GAP = 8;
const ROW_MIN_H = 58;

/** The height the items take in dp: the tiles, then the rows block (a rule of `hairline` between rows). */
export const moreItemsHeight = (rowCount: number, hairline: number): number =>
  TILE_H + (rowCount > 0 ? ROWS_TOP_GAP + ROW_MIN_H * rowCount + hairline * (rowCount - 1) : 0);

/** The key in a native selection event, or null. */
export const moreSelectionOf = (event: { nativeEvent?: { key?: unknown } } | undefined): string | null => {
  const key = event?.nativeEvent?.key;
  return typeof key === 'string' && key.length > 0 ? key : null;
};
