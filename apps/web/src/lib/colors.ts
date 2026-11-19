/**
 * The few colours JavaScript has to hold as literals: canvas drawing (the Blend share cards), palettes handed to
 * the shaders, and generated gradients. Everything else reads tokens.css. `colors.test.ts` keeps `BRAND` equal to
 * the tokens it mirrors, so a colour change is made in tokens.css and here, and nowhere else.
 */
export const BRAND = {
  wave: '#d9e66a',
  accent: '#ee6b5f',
  accentBright: '#ffaaa0',
  accentDeep: '#783e44',
  /** Cool support colour; the product's blue has no token of its own. */
  blue: '#7bafd4'
} as const;

/** Cover art for the guided tours: a bright top-left into a deep bottom-right, in turn. */
export const TOUR_COVERS = [
  `linear-gradient(145deg, ${BRAND.accent}, ${BRAND.accentDeep})`,
  `linear-gradient(145deg, ${BRAND.wave}, #5a6a1e)`,
  `linear-gradient(145deg, ${BRAND.blue}, #2f4d66)`,
  'linear-gradient(145deg, #c58bd8, #4d2f66)',
  'linear-gradient(145deg, #f2b66d, #7a4a1e)'
] as const;

/** What the Blend share cards are drawn with. */
export const SHARE_CARD = {
  ink: '#ffffff',
  ground: '#0e0e10',
  groundTop: '#121216',
  groundDeep: '#0a0a0c',
  disc: '#f2f2f4',
  discMuted: '#8f8f98'
} as const;
