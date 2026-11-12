/**
 * LuvLyrics V6. The one runtime source for colour, type, shape and motion.
 * Artwork supplies colour; white marks actions and selection. Screens consume
 * these through src/ui. Legacy Signal names remain aliases during migration.
 */
import { Easing } from 'react-native-reanimated';

/** Stable product colors. Artwork tints the ambient layer, never these. */
export const Signal = {
  wave: '#F4F4F5',
  waveInk: '#0B0D10',
  accent: '#F4F4F5',
  accentBright: '#F4F4F5',
  accentDeep: '#22252C',
  vibeBlue: '#A3A5AE',
  ink: '#F4F4F5',
  inkSoft: '#A3A5AE',
  inkMuted: '#8A8D96',
  inkFaint: '#8A8D96',
  bg: '#0B0D10',
  bgDeep: '#0B0D10',
  bgSubtle: '#17191E',
  danger: '#FF6B61',
} as const;

/** Use semantic surfaces for new code; glass is reserved for persistent player surfaces. */
export const Surface = {
  base: Signal.bg,
  raised: Signal.bgSubtle,
  control: '#22252C',
  pressed: '#2A2D34',
  deep: '#0D0F12',
  divider: 'rgba(255,255,255,0.06)',
  scrim: '#000000',
  /** The page behind an immersive cover header's track list: pure black, never tinted by a cover. */
  immersive: '#000000',
} as const;

/** Geometry shared by controls; minimum sizes allow system text scaling. */
export const Control = {
  target: 48,
  button: 48,
  compactButton: 48,
  icon: { sm: 36, md: 40, lg: 44 },
  glyph: { sm: 18, md: 20, lg: 22 },
  /** Every list's row (Round 7): 56 tall, a 44 cover, title and artist one line each. Grows with large text. */
  row: 56,
  rowArtwork: 44,
  option: 52,
  gutter: 16,
  disabledOpacity: 0.4,
} as const;

/**
 * Text over artwork, the player and floating glass: three steps, nothing in between.
 * `Signal.ink*` stays for text on the app's own dark surfaces.
 */
export const OnMedia = {
  primary: '#ffffff',
  secondary: 'rgba(255, 255, 255, 0.86)',
  muted: 'rgba(255, 255, 255, 0.62)',
} as const;

/** Frosted material recipe: translucent fill + hairline + inset highlight. */
export const Glass = {
  fill: 'rgba(24, 29, 32, 0.62)',
  fillHeavy: 'rgba(18, 21, 23, 0.86)',
  fillLight: 'rgba(255, 255, 255, 0.08)',
  fillPressed: 'rgba(255, 255, 255, 0.14)',
  hairline: 'rgba(255, 255, 255, 0.10)',
  hairlineStrong: 'rgba(255, 255, 255, 0.18)',
  /** Round 7 capsules: a chip's and a secondary button's light frost over the page and its glow. */
  chip: 'rgba(255, 255, 255, 0.09)',
  capsule: 'rgba(255, 255, 255, 0.10)',
  capsulePressed: 'rgba(255, 255, 255, 0.16)',
  /** A chosen tile or row on glass (the Connect device, a picked playlist): a lit white step, never a hue. */
  selected: 'rgba(255, 255, 255, 0.14)',
  selectedRim: 'rgba(255, 255, 255, 0.32)',
  /** The keyboard focus ring: its own ring, never the look of selection. */
  focusRing: 'rgba(255, 255, 255, 0.9)',
  highlight: 'rgba(255, 255, 255, 0.12)',
  grabber: 'rgba(255,255,255,0.35)',
  scrim: 'rgba(7, 8, 11, 0.55)',
  scrimHeavy: 'rgba(7, 8, 11, 0.78)',
} as const;

/** expo-blur intensities that approximate the web blur tokens (8/16/24/40px). */
export const BlurIntensity = {
  control: 20,
  compact: 35,
  panel: 55,
  sheet: 80,
} as const;

/**
 * The bottom shell (Round 7 item 8): mini player and navigation are one frosted surface. A faint, blurred hint of the
 * cover under a dark tint; the page scrolling underneath shows only faintly through it. Opaque `solid` under Reduce
 * Transparency, Battery Saver, low-end devices or with no cover.
 */
export const ShellFrost = {
  tint: 'rgba(13, 15, 19, 0.84)',
  coverOpacity: 0.16,
  solid: '#16181D',
  /**
   * The mini player alone (1.41.3, owner): opaque, never see-through. The cover's animated glow (Settings' "Glow
   * animated", Echo's two mini blobs) at full strength on its own near-black base, a soft blurred copy of the cover for
   * texture, and a light scrim so white text always reads. Nothing of the page behind shows through.
   */
  miniBase: '#050505',
  /**
   * The navigation bar (1.43.0, owner's Spotify screenshot): no slab of its own. The page fades to black under it,
   * starting `navFade` above the bar, so rows scroll softly out under the icons.
   */
  navFadeColors: ['rgba(0, 0, 0, 0.04)', 'rgba(0, 0, 0, 0.96)', '#000000'] as const,
  navFadeStops: [0, 0.32, 1] as const,
  navFade: 80,
  /**
   * Liked songs' header (1.43.0, owner): Spotify's layout, but a smooth forest-green wash instead of its blue, from the
   * top of the screen down into the page's black. No cover.
   */
  /**
   * 1.44.0 (owner: "premium"): a two-tone forest wash, lit emerald at the top left sinking diagonally through deep
   * forest and a near-black pine into the page, instead of one flat green.
   */
  likedWashColors: ['#2F8058', '#1C5C3D', '#0F3424', '#07170F', 'rgba(5, 5, 5, 0)'] as const,
  likedWashStops: [0, 0.28, 0.58, 0.82, 1] as const,
  likedWashStart: { x: 0.15, y: 0 } as const,
  likedWashEnd: { x: 0.55, y: 1 } as const,
  /** The profile side menu (1.44.0, owner): true black, like Spotify's. */
  menuBlack: '#000000',
  miniGlowOpacity: 1,
  miniCoverOpacity: 0.22,
  miniTint: 'rgba(5, 5, 5, 0.3)',
} as const;

/**
 * Listening stats (1.45.0). Cards sit on a lifted black with a hairline; the hero washes in the colour of your most
 * heard song. Tempo bands run cool to warm so slow and fast read at a glance, always with their names beside them.
 */
export const StatsTheme = {
  card: '#121316',
  cardRim: 'rgba(255, 255, 255, 0.06)',
  track: 'rgba(255, 255, 255, 0.08)',
  bar: 'rgba(255, 255, 255, 0.82)',
  barQuiet: 'rgba(255, 255, 255, 0.28)',
  up: '#7EE2A8',
  down: '#FF8A80',
  tempo: { slow: '#6C9BFF', steady: '#4FD1B5', upbeat: '#FFC75F', fast: '#FF6B81' },
  rank: 'rgba(255, 255, 255, 0.42)',
  /** Spotify's rank chips: a dark lozenge on the artwork with a coloured arrow. */
  chip: 'rgba(0, 0, 0, 0.62)',
  /** The highlight card's shade: clear over the cover, deep at the bottom where its words sit. */
  shade: ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0.18)', 'rgba(0, 0, 0, 0.86)'] as const,
  shadeStops: [0, 0.45, 1] as const,
} as const;

/** One corner family everywhere. Artwork is never over-rounded. */
export const Radius = {
  pill: 999,
  panel: 12,
  sheet: 16,
  well: 12,
  art: 12,
  thumb: 8,
  /** List covers: the same small rounded corners in every list (artists stay round). */
  cover: 6,
  control: 12,
  chip: 8,
} as const;

export const Space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/**
 * The type scale, in points. Every `fontSize` comes from here. Nothing below 11: it stops being readable on
 * 1080p Android. Weights are only Regular, Semibold and Bold — the three SF Pro faces that ship (`Weight`).
 */
export const TypeScale = {
  meta: 13,
  caption: 12,
  secondary: 13,
  body: 15,
  row: 15,
  lead: 19,
  section: 18,
  detail: 24,
  playerTitle: 24,
  page: 28,
  display: 34,
  hero: 42,
} as const;

export type Weight = '400' | '600' | '700';

/** Text roles are shared by React Native primitives and future native adapters. */
export const Typography = {
  hero: { fontSize: TypeScale.hero, lineHeight: 50, fontWeight: '700' },
  display: { fontSize: TypeScale.display, lineHeight: 42, fontWeight: '700' },
  page: { fontSize: TypeScale.page, lineHeight: 34, fontWeight: '700' },
  detail: { fontSize: TypeScale.detail, lineHeight: 30, fontWeight: '700' },
  playerTitle: { fontSize: TypeScale.playerTitle, lineHeight: 30, fontWeight: '700' },
  lead: { fontSize: TypeScale.lead, lineHeight: 25, fontWeight: '700' },
  title: { fontSize: TypeScale.section, lineHeight: 24, fontWeight: '600' },
  row: { fontSize: TypeScale.row, lineHeight: 20, fontWeight: '400' },
  body: { fontSize: TypeScale.body, lineHeight: 21, fontWeight: '400' },
  secondary: { fontSize: TypeScale.secondary, lineHeight: 19, fontWeight: '400' },
  caption: { fontSize: TypeScale.caption, lineHeight: 16, fontWeight: '400' },
  meta: { fontSize: TypeScale.meta, lineHeight: 18, fontWeight: '400' },
  label: { fontSize: TypeScale.body, lineHeight: 20, fontWeight: '600' },
} as const;

/** Apple-Music-style type ramp for the player. */
// Weights only — the face (SF Pro) is resolved per platform; see constants/fonts.ts.
export const PlayerType = {
  title: Typography.playerTitle,
  /** Smaller than the title so the song's name leads (1.41.0, was 18). */
  artist: { fontWeight: '400', fontSize: 16 },
  meta: { fontWeight: '600', fontSize: 11 },
  time: { fontWeight: '600', fontSize: 12, fontVariant: ['tabular-nums' as const] },
} as const;

/**
 * Motion vocabulary. Motion communicates state, it does not decorate. Animate
 * transform and opacity only — never width/height/top.
 */
/** A spring that settles in the least time without overshooting: what a finger-driven surface wants. */
export const criticallyDamped = (stiffness: number) =>
  ({ stiffness, damping: 2 * Math.sqrt(stiffness), mass: 1, overshootClamping: true }) as const;

export const Motion = {
  duration: {
    instant: 100,
    fast: 160,
    base: 240,
    slow: 400,
    cinematic: 700,
    crossfade: 900, // canvas video <-> artwork swap
    flight: 280, // a cover flying from its row into the transfer crate
    deal: 320, // a finished sleeve dealt out of the crate
    morph: 460, // one surface becoming another (lyrics opening, fullscreen)
    drift: 9000, // one leg of the header glow's slow drift (Stream, Library)
  },
  ease: {
    standard: Easing.bezier(0.4, 0, 0.2, 1),
    decelerate: Easing.bezier(0, 0, 0.2, 1),
    accelerate: Easing.bezier(0.4, 0, 1, 1),
    emphasis: Easing.bezier(0.2, 0, 0, 1),
    morph: Easing.bezier(0.32, 0.72, 0, 1),
  },
  spring: {
    // Press feedback: firm and quick to settle, so a tap registers at once (a hint of give, not a wobble).
    tactile: { stiffness: 700, damping: 40, mass: 0.8 },
    sheet: { stiffness: 300, damping: 34, mass: 1 },
    hero: { stiffness: 220, damping: 30, mass: 1 },
    lyrics: { stiffness: 260, damping: 38, mass: 0.85 },
    breathe: { stiffness: 120, damping: 28, mass: 1 },
    /** A tap opens or closes something. */
    open: criticallyDamped(400),
    /** A flick past FLING_VELOCITY: the surface keeps the finger's speed. */
    fling: criticallyDamped(1500),
    /** Coming to rest after a drag that didn't commit. */
    settle: { stiffness: 320, damping: 34, mass: 1, overshootClamping: true },
  },
  /** Release speed (pt/s) above which a drag counts as a flick. */
  flingVelocity: 800,
  /** A tapped control confirms within this window, independent of any IO. */
  ackMs: 120,
  /** The transfer ticker: at most this many visual updates a second; screen readers every summaryMs. */
  ticker: { perSecond: 4, summaryMs: 2000 },
  pressScale: 0.94,
} as const;
