import { LATE_REPORT_SECONDS, lyricClockAt, MAX_AHEAD_MS } from './lyricClock';

describe('lyricClockAt', () => {
  it('carries on from the last report with the time since', () => {
    expect(lyricClockAt(10, 1000, 1100, undefined)).toBeCloseTo(10.1, 5);
    expect(lyricClockAt(10, 1000, 1250, undefined)).toBeCloseTo(10.25, 5);
  });

  it('does not run on without limit if the reports stop', () => {
    expect(lyricClockAt(10, 1000, 1000 + MAX_AHEAD_MS * 10, undefined)).toBeCloseTo(10 + MAX_AHEAD_MS / 1000, 5);
  });

  it('never reads a clock that has gone backwards in time', () => {
    expect(lyricClockAt(10, 1000, 900, undefined)).toBe(10);
  });

  it('keeps going when a report lands a little behind the clock', () => {
    // The clock had run to 10.3; the report says 10.0 plus almost nothing: late news, not a rewind.
    expect(lyricClockAt(10, 1000, 1010, 10.3)).toBe(10.3);
  });

  it('follows a real jump back (a seek), however small the gap to the old clock', () => {
    const behind = 10.3 - LATE_REPORT_SECONDS - 0.05;
    expect(lyricClockAt(behind, 1000, 1000, 10.3)).toBeCloseTo(behind, 5);
  });

  it('follows a jump forward at once', () => {
    expect(lyricClockAt(95, 5000, 5000, 10.3)).toBe(95);
  });
});
