import { artworkUnderlay } from './artworkSeed';

describe('artworkUnderlay', () => {
  it('builds the generated cover only when there is no image to show', () => {
    expect(artworkUnderlay(false, false)).toBe('generated');
    expect(artworkUnderlay(false, true)).toBe('generated');
  });

  it('puts only a base colour under a real cover, and nothing under a quiet one', () => {
    expect(artworkUnderlay(true, false)).toBe('base');
    expect(artworkUnderlay(true, true)).toBe('none');
  });
});
