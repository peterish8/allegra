import { cleanSeconds, commitSeconds, shouldUseNativeScrubber, shouldUseNativeVolume } from './nativeScrubberProps';

describe('nativeScrubberProps', () => {
  it('cleans seconds to a step and rejects anything unusable', () => {
    expect(cleanSeconds(12.34, 0.1)).toBeCloseTo(12.3, 5);
    expect(cleanSeconds(215.456, 0.01)).toBeCloseTo(215.46, 5);
    expect(cleanSeconds(-3, 0.1)).toBe(0);
    expect(cleanSeconds(NaN, 0.1)).toBe(0);
    expect(cleanSeconds(Infinity, 0.1)).toBe(0);
    expect(cleanSeconds('9', 0.1)).toBe(0);
    expect(cleanSeconds(undefined, 0.1)).toBe(0);
  });

  it('is used only for the local player where the view exists', () => {
    expect(shouldUseNativeScrubber(true, 'song-1')).toBe(true);
    expect(shouldUseNativeScrubber(true, '')).toBe(false);
    expect(shouldUseNativeScrubber(true, undefined)).toBe(false);
    expect(shouldUseNativeScrubber(true, null)).toBe(false);
    expect(shouldUseNativeScrubber(false, 'song-1')).toBe(false);
  });

  it('moves the volume natively only with the view and a system volume', () => {
    expect(shouldUseNativeVolume(true, true)).toBe(true);
    expect(shouldUseNativeVolume(true, false)).toBe(false);
    expect(shouldUseNativeVolume(false, true)).toBe(false);
  });

  it('reads the place to seek to from a commit', () => {
    expect(commitSeconds({ nativeEvent: { seconds: 42.5 } }, 200)).toBe(42.5);
    expect(commitSeconds({ nativeEvent: { seconds: 250 } }, 200)).toBe(200);
    expect(commitSeconds({ nativeEvent: { seconds: 250 } }, 0)).toBe(250);
    expect(commitSeconds({ nativeEvent: { seconds: -1 } }, 200)).toBeNull();
    expect(commitSeconds({ nativeEvent: { seconds: NaN } }, 200)).toBeNull();
    expect(commitSeconds({ nativeEvent: {} }, 200)).toBeNull();
    expect(commitSeconds(undefined, 200)).toBeNull();
  });
});
