import {
  formatTrackDuration,
  shouldUseNativeTrackRow,
  toNativeColor,
  trackRowFitsFontScale,
  trackRowLabel,
  trackRowMeta,
  trackRowPalette,
  trackRowTile,
} from './trackRowPayload';

describe('trackRowPayload', () => {
  it('formats a length like the row does', () => {
    expect(formatTrackDuration(undefined)).toBe('');
    expect(formatTrackDuration(0)).toBe('');
    expect(formatTrackDuration(-5)).toBe('');
    expect(formatTrackDuration(65)).toBe('1:05');
    expect(formatTrackDuration(600.9)).toBe('10:00');
  });

  it('joins the meta line from what is there', () => {
    expect(trackRowMeta('Artist', 'Lyrics', 200)).toBe('Artist · Lyrics · 3:20');
    expect(trackRowMeta(undefined, 'Failed', undefined)).toBe('Failed');
    expect(trackRowMeta('', undefined, 0)).toBe('');
  });

  it('words the accessibility label with the artist when there is one', () => {
    expect(trackRowLabel('Song', 'Band')).toBe('Song by Band');
    expect(trackRowLabel('Song', undefined)).toBe('Song');
    expect(trackRowLabel('Song', '')).toBe('Song');
  });

  it('seeds the generated cover as Artwork does', () => {
    const a = trackRowTile('Song', 'Band');
    expect(a).toEqual(trackRowTile('Song', 'Band'));
    expect(a.base).toMatch(/^#[0-9a-f]{6}$/i);
    expect(a.variant).toBeGreaterThanOrEqual(0);
    expect(a.variant).toBeLessThan(3);
    // A song with no title reads as "Untitled", like Artwork's label.
    expect(trackRowTile('', 'Band')).toEqual(trackRowTile('Untitled', 'Band'));
    expect(trackRowTile('Song', 'Band').glyph.length).toBeGreaterThan(0);
  });

  it('keeps the row at 64 dp only while the text block fits the cover', () => {
    expect(trackRowFitsFontScale(1, false)).toBe(true);
    expect(trackRowFitsFontScale(1.3, false)).toBe(true);
    expect(trackRowFitsFontScale(1.5, false)).toBe(false);
    // A download's progress line takes 8 dp more.
    expect(trackRowFitsFontScale(1, true)).toBe(true);
    expect(trackRowFitsFontScale(1.15, true)).toBe(false);
  });

  it('is native only for the retry button, a fitting font size and a build with the view', () => {
    expect(shouldUseNativeTrackRow(true, 1, false, undefined)).toBe(true);
    expect(shouldUseNativeTrackRow(true, 1, false, 'refresh')).toBe(true);
    expect(shouldUseNativeTrackRow(true, 1, false, 'ellipsis-vertical')).toBe(false);
    expect(shouldUseNativeTrackRow(false, 1, false, undefined)).toBe(false);
    expect(shouldUseNativeTrackRow(true, 2, false, undefined)).toBe(false);
  });

  it('turns theme colours into the strings Color.parseColor reads', () => {
    expect(toNativeColor('rgba(255, 255, 255, 0.08)')).toBe('#14ffffff');
    expect(toNativeColor('rgba(0, 0, 0, 1)')).toBe('#ff000000');
    expect(toNativeColor('rgb(10, 11, 14)')).toBe('#ff0a0b0e');
    expect(toNativeColor('#d9e66a')).toBe('#d9e66a');
  });

  it('builds the palette JSON the view reads', () => {
    const json = trackRowPalette(
      { ink: '#f4f1ea', inkSoft: '#d1d0c9', inkMuted: '#8e9498', wave: '#d9e66a', waveInk: '#17180d', bg: '#0a0b0e' },
      'rgba(255, 255, 255, 0.08)',
    );
    expect(JSON.parse(json)).toEqual({
      ink: '#f4f1ea', inkSoft: '#d1d0c9', inkMuted: '#8e9498', wave: '#d9e66a', waveInk: '#17180d', bg: '#0a0b0e', pressed: '#14ffffff',
    });
  });
});
