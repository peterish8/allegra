import type { AuraPalette } from '../allegra/palette';
import { backdropHeroHeight, nativeAppleBackdropPayload } from './nativeAppleBackdropProps';

describe('nativeAppleBackdropPayload', () => {
  const palette = {
    primary: '#123456',
    secondary: '#789abc',
    tertiary: '#fedcba',
  } as AuraPalette;

  it('passes the selected cover, fallback palette and measured player frame', () => {
    expect(nativeAppleBackdropPayload('https://art/cover.jpg', palette, { width: 393, height: 852 }, true, false)).toEqual({
      uri: 'https://art/cover.jpg',
      primary: '#123456',
      secondary: '#789abc',
      tertiary: '#fedcba',
      frameWidth: 393,
      frameHeight: 852,
      showHero: true,
      veil: false,
    });
  });

  it('uses the palette while there is no cover', () => {
    expect(nativeAppleBackdropPayload(undefined, palette, { width: 360, height: 800 }, false, true)).toMatchObject({ uri: null, showHero: false, veil: true });
  });

  it('uses the same sixty five percent hero height as the Skia fallback', () => {
    expect(backdropHeroHeight(393, 852)).toBe(554);
  });
});
