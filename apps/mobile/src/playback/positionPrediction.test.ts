import { extrapolatePosition } from './positionPrediction';

describe('the playhead between status reports', () => {
  it('advances while the song is playing, so a skip at 2.9 s is read as past 3 s', () => {
    expect(extrapolatePosition(2.9, 1_000, 1_200, true)).toBeCloseTo(3.1);
  });

  it('stands still while paused, however old the report is', () => {
    expect(extrapolatePosition(2.9, 1_000, 9_000, false)).toBe(2.9);
  });

  it('never runs past the length it is given', () => {
    expect(extrapolatePosition(199.9, 1_000, 2_000, true, 200)).toBe(200);
  });

  it('leaves a nonsense position alone', () => {
    expect(extrapolatePosition(Number.NaN, 1_000, 2_000, true)).toBeNaN();
  });
});
