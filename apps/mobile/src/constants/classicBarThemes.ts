/**
 * The classic player bar's flat theme backgrounds: three stops each, top to bottom. They are the picker's palette
 * (Settings, Player), not UI chrome, so they live here with the other design constants.
 */
export type ClassicBarStops = [string, string, string];

export const CLASSIC_BAR_THEMES = {
  'purest-black': ['#000000', '#000000', '#000000'],
  grey: ['#121212', '#212121', '#121212'],
  'theme-blue': ['#0A1628', '#1A3A6B', '#2F8CFF'],
  'theme-subtle': ['#0A0A0A', '#1F1F1F', '#0A0A0A'],
  aurora: ['#000000', '#EA7980', '#1D728F'],
} as const satisfies Record<string, ClassicBarStops>;

/** The bar's fallback, and the stops under a song with no gradient of its own. */
export const CLASSIC_BAR_DEFAULT: ClassicBarStops = ['#080808', '#0A0A0A', '#080808'];
/** A song with no gradient of its own: the two stops its bar starts from. */
export const CLASSIC_BAR_SONG_FALLBACK: readonly string[] = ['#222222', '#111111'];

/** The soft tint over the classic bar's cover wash: top, middle, bottom. Kept faint so the cover's colour stays vivid. */
export const CLASSIC_BAR_SCRIM: ClassicBarStops = ['rgba(0,0,0,0.4)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.4)'];

/** The three stops for a background mode; a song's own gradient colours feed `song-gradient`. */
export const classicBarStops = (mode: string, songColors: readonly string[]): ClassicBarStops => {
  if (mode === 'song-gradient') {
    const [a, b, c] = songColors;
    return [a || '#111111', b || '#333333', c || a || '#111111'];
  }
  const theme = (CLASSIC_BAR_THEMES as Record<string, ClassicBarStops>)[mode];
  return theme ?? CLASSIC_BAR_DEFAULT;
};
