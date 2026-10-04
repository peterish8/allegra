import { LYRICS_TAP_WINDOW_MS, lyricsButtonTap, NO_TAPS } from './lyricsButtonTaps';

const W = LYRICS_TAP_WINDOW_MS;

describe('the lyrics button', () => {
  it('opens lyrics on the first tap, at once', () => {
    expect(lyricsButtonTap(NO_TAPS, 1000, false).action).toBe('toggle');
  });

  it('closes lyrics after the window, so a triple tap does not flicker them shut', () => {
    expect(lyricsButtonTap(NO_TAPS, 1000, true).action).toBe('toggle-later');
  });

  it('switches the highlight on the third quick tap, from the cover or on lyrics', () => {
    for (const shown of [false, true]) {
      let r = lyricsButtonTap(NO_TAPS, 1000, shown);
      r = lyricsButtonTap(r.run, 1000 + W - 20, shown);
      expect(r.action).toBe('none');
      r = lyricsButtonTap(r.run, 1000 + 2 * (W - 20), shown);
      expect(r.action).toBe('switch-highlight');
      expect(r.run).toEqual(NO_TAPS);
    }
  });

  it('counts a slow tap as a new one', () => {
    const first = lyricsButtonTap(NO_TAPS, 1000, false);
    const later = lyricsButtonTap(first.run, 1000 + W + 1, true);
    expect(later.action).toBe('toggle-later');
    expect(later.run.count).toBe(1);
  });
});
