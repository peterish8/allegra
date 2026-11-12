/**
 * The immersive page header (1.48.0) for Made for you mixes and for albums and playlists opened from an artist page:
 * the cover fills the top edge to edge and dissolves into a solid black list. Pure numbers here so the shape is tested.
 *
 * The rule that matters: nothing below the hero is ever tinted by the cover. The fade is pure black at every stop
 * (never a tone of the cover), it is long and eased so there is no visible edge where the picture ends, and it reaches
 * full black at the hero's bottom edge, where the black list begins.
 */

/** The page behind the list: pure black, fixed, the same for every cover. */
export const IMMERSIVE_BLACK = '#000000';

/** Hero height: about the width (a square cover shows whole), never more than 55% of a tall window. */
export const heroHeight = (windowWidth: number, windowHeight: number): number =>
  Math.round(Math.min(windowWidth * 1.05, windowHeight * 0.55));

/** [position 0..1 down the hero, black alpha]. Starts 45% down, eases in, is solid at the bottom edge. */
export const FADE_STOPS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.45, 0],
  [0.55, 0.08],
  [0.65, 0.22],
  [0.75, 0.42],
  [0.85, 0.65],
  [0.93, 0.85],
  [0.98, 0.96],
  [1, 1],
];

/** Black at the top so the back button reads on a bright cover; gone by 28%. */
export const TOP_SCRIM_STOPS: readonly (readonly [number, number])[] = [
  [0, 0.5],
  [0.14, 0.24],
  [0.28, 0],
];

const toColors = (stops: readonly (readonly [number, number])[]): string[] => stops.map(([, alpha]) => `rgba(0,0,0,${alpha})`);
const toLocations = (stops: readonly (readonly [number, number])[]): number[] => stops.map(([at]) => at);

export const fadeColors = (): [string, string, ...string[]] => toColors(FADE_STOPS) as [string, string, ...string[]];
export const fadeLocations = (): [number, number, ...number[]] => toLocations(FADE_STOPS) as [number, number, ...number[]];
export const topScrimColors = (): [string, string, ...string[]] => toColors(TOP_SCRIM_STOPS) as [string, string, ...string[]];
export const topScrimLocations = (): [number, number, ...number[]] => toLocations(TOP_SCRIM_STOPS) as [number, number, ...number[]];

/** The black alpha at a point `at` (0..1) down the hero, interpolated between stops. */
export const fadeAlphaAt = (at: number, stops: readonly (readonly [number, number])[] = FADE_STOPS): number => {
  if (at <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, a1] = stops[i];
    if (at <= x1) {
      const [x0, a0] = stops[i - 1];
      return a0 + ((a1 - a0) * (at - x0)) / (x1 - x0);
    }
  }
  return stops[stops.length - 1][1];
};

/** The scroll range (pixels) over which the compact black title bar fades in once the hero has mostly gone. */
export const barFadeRange = (height: number): readonly [number, number] => [height * 0.55, height * 0.8];

/** A larger picture for the hero from the small thumbnail a YouTube Music or Google image link names. */
export const heroImageUrl = (url: string | null | undefined, size = 1200): string | undefined => {
  if (!url) return undefined;
  return /=w\d+-h\d+/.test(url) ? url.replace(/=w\d+-h\d+/, `=w${size}-h${size}`) : url;
};
