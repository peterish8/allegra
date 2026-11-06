import { SWIPE_FOLLOW_MAX, miniSwipe, swipeFollow, swipeThreshold } from './miniSwipe';

const W = 330; // a 360dp phone's mini player info lane

describe('miniSwipe', () => {
  it('commits left to next and right to previous once the drag passes the threshold', () => {
    const t = swipeThreshold(W);
    expect(miniSwipe(-(t + 1), 4, 0, W)).toBe('next');
    expect(miniSwipe(t + 1, -4, 0, W)).toBe('previous');
  });

  it('ignores short slow drags and noisy flicks', () => {
    expect(miniSwipe(-40, 0, -200, W)).toBeNull();
    expect(miniSwipe(-12, 0, -3000, W)).toBeNull();
  });

  it('lets a deliberate flick commit before the slow-drag threshold', () => {
    expect(miniSwipe(-30, 2, -1200, W)).toBe('next');
    expect(miniSwipe(30, 2, 1200, W)).toBe('previous');
  });

  it('never commits a flick that reverses against the drag', () => {
    expect(miniSwipe(-30, 0, 1200, W)).toBeNull();
  });

  it('leaves mostly vertical and diagonal drags to the open-player gesture', () => {
    expect(miniSwipe(-120, -130, -2000, W)).toBeNull();
    expect(miniSwipe(-100, 100, 0, W)).toBeNull();
  });

  it('mirrors direction in right-to-left layouts', () => {
    expect(miniSwipe(-200, 0, 0, W, true)).toBe('previous');
    expect(miniSwipe(200, 0, 0, W, true)).toBe('next');
  });

  it('rejects bad numbers instead of skipping', () => {
    expect(miniSwipe(Number.NaN, 0, 0, W)).toBeNull();
  });

  it('scales the threshold with wide bars but never below the minimum', () => {
    expect(swipeThreshold(100)).toBe(56);
    expect(swipeThreshold(600)).toBeCloseTo(132);
  });

  it('follows the finger at half speed, clamped', () => {
    expect(swipeFollow(-40)).toBe(-20);
    expect(swipeFollow(500)).toBe(SWIPE_FOLLOW_MAX);
    expect(swipeFollow(-500)).toBe(-SWIPE_FOLLOW_MAX);
  });
});
