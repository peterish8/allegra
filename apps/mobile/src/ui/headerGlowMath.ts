/**
 * Geometry for the header glow on Stream and Library (owner, 2026-11-06: "the top 20 percent ... glow animated ...
 * if scrolled it can go disappear in top but scrolled back should come back").
 *
 * The glow covers about the top fifth of the window, measured from the real window height and status-bar inset,
 * and fades softly below that. It leaves with the page: the same scroll offset that moves the content moves the
 * glow up and fades it, so it is gone once the header region has scrolled away and back as the page returns.
 */

/** The share of the window the glow covers at rest, before its soft falloff. */
export const GLOW_SHARE = 0.2;
/** The falloff below the glow's body, as a share of the body. */
export const GLOW_FALLOFF = 0.6;
/** The glow never collapses to a sliver on a short window. */
export const GLOW_MIN = 120;

export interface GlowFrame {
  /** The glow's body: about 20% of the window, plus the status bar it sits behind. */
  body: number;
  /** The whole layer, body plus falloff: what has to scroll away before it is gone. */
  extent: number;
}

export function glowFrame(windowHeight: number, insetTop: number): GlowFrame {
  const usable = Number.isFinite(windowHeight) && windowHeight > 0 ? windowHeight : 0;
  const top = Number.isFinite(insetTop) && insetTop > 0 ? insetTop : 0;
  const body = Math.round(Math.max(GLOW_MIN, usable * GLOW_SHARE) + top);
  return { body, extent: Math.round(body * (1 + GLOW_FALLOFF)) };
}

/**
 * Where the glow sits for a scroll offset: it travels up with the content (never down on a pull to refresh) and
 * fades as it goes, gone once the whole layer has passed the top.
 */
export function glowScroll(offset: number, frame: GlowFrame): { translateY: number; opacity: number } {
  'worklet';
  const y = Number.isFinite(offset) ? Math.min(frame.extent, Math.max(0, offset)) : 0;
  const opacity = frame.body > 0 ? Math.max(0, 1 - y / frame.body) : 0;
  return { translateY: -y, opacity };
}

/** The glow moves only when it is seen and the device can afford it; otherwise it rests, still and lit. */
export function glowAnimates(state: {
  focused: boolean; appActive: boolean; reduceMotion: boolean; lowEnd: boolean; batterySaver: boolean; reduceTransparency: boolean; scrolledAway: boolean;
}): boolean {
  return state.focused && state.appActive && !state.reduceMotion && !state.lowEnd && !state.batterySaver && !state.reduceTransparency && !state.scrolledAway;
}
