import { DRIFT_TOLERANCE_S, LOAD_LEAD_S, driftSeekS, expectedPositionS, handoverStartS } from './handover';

describe('expectedPositionS', () => {
  it('moves a song that was playing at the tap on by the time since, without the loading lead', () => {
    expect(expectedPositionS(61, true, 3.5)).toBe(64.5);
  });

  it('holds a song that was paused at the tap where it was', () => {
    expect(expectedPositionS(61, false, 3.5)).toBe(61);
  });

  it('never goes back in time or below zero', () => {
    expect(expectedPositionS(10, true, -2)).toBe(10);
    expect(expectedPositionS(-1, false, 0)).toBe(0);
  });
});

describe('handoverStartS', () => {
  it('advances a playing song by the time spent and the loading lead', () => {
    expect(handoverStartS(60, true, 2.5)).toBeCloseTo(60 + 2.5 + LOAD_LEAD_S);
  });

  it('keeps a paused song where it was paused', () => {
    expect(handoverStartS(60, false, 5)).toBe(60);
  });

  it('never goes below zero or back in time', () => {
    expect(handoverStartS(0, false, 0)).toBe(0);
    expect(handoverStartS(10, true, -3)).toBeCloseTo(10 + LOAD_LEAD_S);
  });
});

describe('driftSeekS', () => {
  it('leaves a close player alone', () => {
    expect(driftSeekS(100, 100 + DRIFT_TOLERANCE_S - 0.05)).toBeNull();
    expect(driftSeekS(100, 100 - DRIFT_TOLERANCE_S + 0.05)).toBeNull();
  });

  it('seeks to the other app when ours is ahead or behind by more than the tolerance', () => {
    expect(driftSeekS(100, 101)).toBe(100);
    expect(driftSeekS(100, 98.9)).toBe(100);
  });

  it('does nothing when the other app is gone', () => {
    expect(driftSeekS(null, 12)).toBeNull();
    expect(driftSeekS(Number.NaN, 12)).toBeNull();
  });
});
