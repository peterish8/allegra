/**
 * What the native A–Z rail (`NativeAlphabetRail`, android/.../views/NativeAlphabetRailView.kt) is handed and gives
 * back, decided in plain TypeScript so it is unit-testable. The numbers mirror `AlphabetRailMath.kt`.
 */

export interface RailEntry {
  letter: string;
  index: number;
}

/** `letters` JSON for the native view. */
export const railLettersJson = (letters: readonly RailEntry[]): string =>
  JSON.stringify(letters.map(l => ({ letter: l.letter, index: l.index })));

/** The theme colours the view draws with, from `Signal`: one source of truth. */
export const railPalette = (signal: { inkSoft: string; wave: string; waveInk: string }): string =>
  JSON.stringify({ inkSoft: signal.inkSoft, wave: signal.wave, waveInk: signal.waveInk });

/**
 * One letter's line in dp. React Native scales `lineHeight: 15` by the font scale and rounds it up to a whole pixel (its
 * custom line height span), so on most screens a line is a little more than 15 dp; the rail is as many of them as
 * there are letters. Handed to the native view, which draws on the same lines.
 */
export const railLineHeight = (fontScale: number, density: number): number => {
  if (!(fontScale > 0) || !(density > 0)) return 15;
  return Math.ceil(15 * fontScale * density) / density;
};

/** The rail's size in dp, as `AlphabetRail`'s styles lay it out: padding 8 either side, a line per letter, the hairline border. */
export const RAIL_W = 26;
export const railHeight = (count: number, hairline: number, lineHeight = 15): number => 2 * 8 + count * lineHeight + 2 * hairline;

/** The view reaches this far left of the rail and above/below it, so the bubble beside the thumb fits inside it. */
export const RAIL_REACH_LEFT = 70;
export const RAIL_REACH_V = 28;

/** The list index a native pick carries, or null when the event is not one. */
export const railIndexOf = (event: { nativeEvent?: { index?: unknown } } | undefined): number | null => {
  const index = event?.nativeEvent?.index;
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : null;
};

/** The rail only shows for a long enough list; it is native where the view exists. */
export const shouldUseNativeRail = (available: boolean, letterCount: number): boolean => available && letterCount >= 4;
