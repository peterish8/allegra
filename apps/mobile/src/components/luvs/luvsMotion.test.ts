import { equaliserMotionMode } from './luvsMotion';

describe('equaliser motion policy', () => {
  it('loops only while playing when Reduce Motion is off', () => {
    expect(equaliserMotionMode(true, false)).toBe('loop');
  });

  it('keeps the bars static while playing with Reduce Motion on', () => {
    expect(equaliserMotionMode(true, true)).toBe('static');
  });

  it('settles when playback stops with Reduce Motion off', () => {
    expect(equaliserMotionMode(false, false)).toBe('settle');
  });

  it('keeps the bars static when playback stops with Reduce Motion on', () => {
    expect(equaliserMotionMode(false, true)).toBe('static');
  });
});
