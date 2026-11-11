import { acceptPositionReport, PLAYHEAD_RESET_WINDOW_MS } from './playheadReset';

describe('acceptPositionReport', () => {
  const resetAt = 10_000;

  it('accepts everything when there has been no reset', () => {
    expect(acceptPositionReport(184, null, resetAt)).toBe(true);
  });

  it('refuses the old song\'s position that lands just after a skip', () => {
    expect(acceptPositionReport(121.4, resetAt, resetAt + 120)).toBe(false);
  });

  it('accepts the new song starting from the top', () => {
    expect(acceptPositionReport(0, resetAt, resetAt + 40)).toBe(true);
    expect(acceptPositionReport(0.3, resetAt, resetAt + 250)).toBe(true);
  });

  it('allows a little slack for a player that started a beat early', () => {
    expect(acceptPositionReport(1.2, resetAt, resetAt + 250)).toBe(true);
    expect(acceptPositionReport(1.4, resetAt, resetAt + 250)).toBe(false);
  });

  it('stops checking once the window has passed (a seek right after a skip must land)', () => {
    expect(acceptPositionReport(95, resetAt, resetAt + PLAYHEAD_RESET_WINDOW_MS + 1)).toBe(true);
  });

  it('accepts a report that is not a number rather than freezing the playhead on it', () => {
    expect(acceptPositionReport(Number.NaN, resetAt, resetAt + 100)).toBe(true);
  });
});
