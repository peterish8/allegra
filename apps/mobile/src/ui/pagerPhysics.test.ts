// allegraTheme reads Easing from Reanimated; the math here needs none of it.
jest.mock('react-native-reanimated', () => ({ Easing: { bezier: () => (t: number) => t, linear: (t: number) => t } }));
import { indicatorFrame, pageAfterRelease, pagerPosition } from './pagerPhysics';

const W = 400;
const MAX = 3 * W; // four pages

describe('pagerPosition', () => {
  it('moves 1:1 against the finger inside the pages', () => {
    expect(pagerPosition(W, -120, MAX)).toBe(W + 120);
    expect(pagerPosition(W, 150, MAX)).toBe(W - 150);
  });

  it('rubber-bands past the first and the last page, resisting more the further it goes', () => {
    const before = pagerPosition(0, 60, MAX);
    expect(before).toBeLessThan(0);
    expect(before).toBeGreaterThan(-60);
    expect(pagerPosition(0, 400, MAX)).toBeLessThan(pagerPosition(0, 200, MAX));
    const after = pagerPosition(MAX, -60, MAX);
    expect(after).toBeGreaterThan(MAX);
    expect(after).toBeLessThan(MAX + 60);
  });
});

describe('pageAfterRelease', () => {
  it('a slow release settles on the nearest page', () => {
    expect(pageAfterRelease(W * 1.4, 0, W, 4, 1)).toBe(1);
    expect(pageAfterRelease(W * 1.6, 0, W, 4, 1)).toBe(2);
  });

  it('a flick turns at least one page in its direction, even after a short drag', () => {
    expect(pageAfterRelease(W * 1.05, -1200, W, 4, 1)).toBe(2); // finger flicks left → next page
    expect(pageAfterRelease(W * 0.95, 1200, W, 4, 1)).toBe(0); // finger flicks right → previous page
  });

  it('never skips a page and never leaves the ends', () => {
    expect(pageAfterRelease(W * 1.2, -8000, W, 4, 1)).toBe(2);
    expect(pageAfterRelease(-30, 3000, W, 4, 0)).toBe(0);
    expect(pageAfterRelease(MAX + 30, -3000, W, 4, 3)).toBe(3);
  });
});

describe('indicatorFrame', () => {
  const lefts = [16, 96, 196, 270];
  const widths = [60, 80, 54, 64];

  it('sits exactly on a tab at rest', () => {
    expect(indicatorFrame(0, lefts, widths)).toEqual({ left: 16, width: 60 });
    expect(indicatorFrame(2, lefts, widths)).toEqual({ left: 196, width: 54 });
    expect(indicatorFrame(3, lefts, widths)).toEqual({ left: 270, width: 64 });
  });

  it('follows the finger between two tabs (no jump at the end of the travel)', () => {
    expect(indicatorFrame(0.5, lefts, widths)).toEqual({ left: 56, width: 70 });
  });

  it('holds on the end tab while the pager rubber-bands', () => {
    expect(indicatorFrame(-0.2, lefts, widths)).toEqual({ left: 16, width: 60 });
    expect(indicatorFrame(3.2, lefts, widths)).toEqual({ left: 270, width: 64 });
  });
});
