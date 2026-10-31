import type { AuraPalette } from '../allegra/palette';

export const BACKDROP_HERO_SHARE = 0.65;

/** Hero height: the sharp cover runs across the top 65% of the player. */
export const backdropHeroHeight = (_width: number, height: number): number => Math.round(height * BACKDROP_HERO_SHARE);

export interface BackdropFrame {
  width: number;
  height: number;
}

export interface NativeAppleBackdropPayload {
  uri: string | null;
  primary: string;
  secondary: string;
  tertiary: string;
  frameWidth: number;
  frameHeight: number;
  showHero: boolean;
  veil: boolean;
}

/** The native blurred room receives only the cover identity, its three fallback colours and the player frame. */
export const nativeAppleBackdropPayload = (
  uri: string | null | undefined,
  palette: AuraPalette,
  frame: BackdropFrame,
  showHero: boolean,
  veil: boolean,
): NativeAppleBackdropPayload => ({
  uri: uri || null,
  primary: palette.primary,
  secondary: palette.secondary,
  tertiary: palette.tertiary,
  frameWidth: frame.width,
  frameHeight: frame.height,
  showHero,
  veil,
});
