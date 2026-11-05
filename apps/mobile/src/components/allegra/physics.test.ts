// The theme's easing curves come from Reanimated, which does not load in this Node test environment.
jest.mock('react-native-reanimated', () => ({ Easing: { bezier: () => (t: number) => t } }));

import { Motion } from '../../constants/allegraTheme';
import { dampingRatio, isFling, projectMomentum, releaseSpring, rubberBand } from './physics';

describe('rubberBand', () => {
  it('is zero at rest and keeps the direction of the pull', () => {
    expect(rubberBand(0, 120)).toBe(0);
    expect(rubberBand(40, 120)).toBeGreaterThan(0);
    expect(rubberBand(-40, 120)).toBeLessThan(0);
  });

  it('resists harder the further it is pulled and never reaches the dimension', () => {
    const steps = [10, 50, 100, 400, 2000].map(p => rubberBand(p, 120));
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
      expect(steps[i] - steps[i - 1]).toBeLessThan([10, 50, 100, 400, 2000][i] - [10, 50, 100, 400, 2000][i - 1]);
    }
    expect(rubberBand(100_000, 120)).toBeLessThan(120);
  });
});

describe('release physics', () => {
  it('projects a flick forward in its own direction', () => {
    expect(projectMomentum(1000)).toBeCloseTo(99, 0);
    expect(projectMomentum(-1000)).toBeCloseTo(-99, 0);
  });

  it('takes the firm spring for a flick and the soft one for a slow release, carrying the velocity', () => {
    expect(isFling(Motion.flingVelocity + 1)).toBe(true);
    expect(isFling(Motion.flingVelocity - 1)).toBe(false);
    expect(releaseSpring(3, 2000)).toMatchObject({ stiffness: Motion.spring.fling.stiffness, velocity: 3 });
    expect(releaseSpring(0.2, 100)).toMatchObject({ stiffness: Motion.spring.open.stiffness, velocity: 0.2 });
  });
});

describe('springs', () => {
  it('never wobble: every shared spring is at least 0.6 damped', () => {
    for (const [name, spring] of Object.entries(Motion.spring)) {
      expect([name, dampingRatio(spring) >= 0.6]).toEqual([name, true]);
    }
  });
});
