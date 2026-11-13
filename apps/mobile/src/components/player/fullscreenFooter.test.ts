import { fullscreenClearance, fullscreenFooterPad } from './fullscreenFooter';

/** NowPlayingLyricsArea's CONTROLS_CLEARANCE: the height the regular lyrics view keeps free for the full controls stack. */
const FULL_STACK = 372;

describe('fullscreen lyrics footer', () => {
  it('is a slim strip, far smaller than the full controls stack', () => {
    expect(fullscreenClearance(0)).toBeLessThan(FULL_STACK / 2);
  });

  it('stays about a tenth of a phone screen (8%-16% of 800 dp)', () => {
    const share = fullscreenClearance(0) / 800;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.16);
  });

  it('keeps clear of the system navigation bar and never presses on the bottom edge', () => {
    expect(fullscreenFooterPad(0)).toBe(16);
    expect(fullscreenFooterPad(34)).toBe(42);
    expect(fullscreenClearance(34)).toBe(fullscreenClearance(0) + 26);
  });
});
