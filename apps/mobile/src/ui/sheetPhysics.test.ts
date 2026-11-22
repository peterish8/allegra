// allegraTheme reads Easing from Reanimated; the math here needs none of it.
jest.mock('react-native-reanimated', () => ({ Easing: { bezier: () => (t: number) => t, linear: (t: number) => t } }));
import { SHEET_STRETCH, dragPosition, nearestRest, pickRest, progressBetween } from './sheetPhysics';

const FLING = 800;
// full · short · closed
const RESTS = [0, 300, 700];

describe('dragPosition', () => {
  it('follows the finger 1:1 inside the travel', () => {
    expect(dragPosition(300, -120, 0)).toBe(180);
    expect(dragPosition(300, 250, 0)).toBe(550);
  });

  it('rubber-bands past the top rest and never exceeds the stretch', () => {
    const small = dragPosition(0, -20, 0);
    const big = dragPosition(0, -2000, 0);
    expect(small).toBeLessThan(0);
    expect(small).toBeGreaterThan(-20);
    expect(big).toBeGreaterThan(-SHEET_STRETCH);
    // Changes across the whole pull, not a hard stop.
    expect(dragPosition(0, -400, 0)).toBeLessThan(dragPosition(0, -200, 0));
  });
});

describe('pickRest', () => {
  it('takes the nearest rest on a slow release', () => {
    expect(pickRest(120, 0, RESTS, 1, FLING)).toBe(0);
    expect(pickRest(260, 0, RESTS, 1, FLING)).toBe(1);
    expect(pickRest(560, 0, RESTS, 1, FLING)).toBe(2);
  });

  it('a flick moves at least one rest in its direction', () => {
    expect(pickRest(290, -900, RESTS, 1, FLING)).toBe(0);
    expect(pickRest(310, 900, RESTS, 1, FLING)).toBe(2);
  });

  it('never skips a rest from where the drag began', () => {
    // A hard flick down from full stops at short, not closed.
    expect(pickRest(20, 5000, RESTS, 0, FLING)).toBe(1);
    expect(pickRest(680, -5000, RESTS, 2, FLING)).toBe(1);
  });

  it('projects momentum: a medium-speed drag lands further than where it was let go', () => {
    expect(pickRest(200, 0, RESTS, 1, FLING)).toBe(1);
    expect(pickRest(200, -700, RESTS, 1, FLING)).toBe(0);
  });

  it('works with two rests (a plain sheet: open · closed)', () => {
    expect(nearestRest(100, [0, 400])).toBe(0);
    expect(pickRest(100, 1200, [0, 400], 0, FLING)).toBe(1);
    expect(pickRest(100, 0, [0, 400], 0, FLING)).toBe(0);
  });
});

describe('progressBetween', () => {
  it('maps short → full to 0 → 1, clamped', () => {
    expect(progressBetween(300, 300, 0)).toBe(0);
    expect(progressBetween(150, 300, 0)).toBe(0.5);
    expect(progressBetween(-20, 300, 0)).toBe(1);
    expect(progressBetween(500, 300, 0)).toBe(0);
  });
});
