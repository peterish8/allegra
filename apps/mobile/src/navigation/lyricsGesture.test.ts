import {
  LYRICS_SWIPE_DISTANCE,
  LYRICS_SWIPE_VELOCITY,
  shouldExitLyricsFullscreen,
  shouldOpenLyricsFullscreen,
  startsInFooter,
} from './lyricsGesture';

describe('shouldOpenLyricsFullscreen', () => {
  it('opens on a long upward drag or a fast upward flick', () => {
    expect(shouldOpenLyricsFullscreen(-(LYRICS_SWIPE_DISTANCE + 1), 0)).toBe(true);
    expect(shouldOpenLyricsFullscreen(-10, -(LYRICS_SWIPE_VELOCITY + 1))).toBe(true);
  });

  it('settles back on a short, slow or downward drag', () => {
    expect(shouldOpenLyricsFullscreen(-20, -100)).toBe(false);
    expect(shouldOpenLyricsFullscreen(0, 0)).toBe(false);
    expect(shouldOpenLyricsFullscreen(LYRICS_SWIPE_DISTANCE + 40, 2000)).toBe(false);
  });
});

describe('shouldExitLyricsFullscreen', () => {
  it('exits on a long downward drag or a fast downward flick', () => {
    expect(shouldExitLyricsFullscreen(LYRICS_SWIPE_DISTANCE + 1, 0)).toBe(true);
    expect(shouldExitLyricsFullscreen(10, LYRICS_SWIPE_VELOCITY + 1)).toBe(true);
  });

  it('keeps fullscreen on a short, slow or upward drag', () => {
    expect(shouldExitLyricsFullscreen(20, 100)).toBe(false);
    expect(shouldExitLyricsFullscreen(-200, -2000)).toBe(false);
  });
});

describe('startsInFooter', () => {
  it('is true only at or below the footer top, so lyric scrolling is never claimed', () => {
    expect(startsInFooter(700, 800, 372)).toBe(true);
    expect(startsInFooter(428, 800, 372)).toBe(true);
    expect(startsInFooter(427, 800, 372)).toBe(false);
    expect(startsInFooter(100, 800, 372)).toBe(false);
  });
});
