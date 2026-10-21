import { footerActionOf, footerSleepLabel, shouldUseNativeFooter } from './nativeFooterProps';

describe('nativeFooterProps', () => {
  it('reads the control that was used', () => {
    for (const action of ['queue', 'output', 'timer', 'lyrics', 'lyricsLong'] as const) {
      expect(footerActionOf({ nativeEvent: { action } })).toBe(action);
    }
  });

  it('ignores anything it does not know', () => {
    expect(footerActionOf({ nativeEvent: { action: 'share' } })).toBeNull();
    expect(footerActionOf({ nativeEvent: { action: 3 } })).toBeNull();
    expect(footerActionOf({ nativeEvent: {} })).toBeNull();
    expect(footerActionOf(undefined)).toBeNull();
  });

  it('is native only where the view exists', () => {
    expect(shouldUseNativeFooter(true)).toBe(true);
    expect(shouldUseNativeFooter(false)).toBe(false);
  });

  it('shows a sleep label only with a timer', () => {
    expect(footerSleepLabel(true, '12 min')).toBe('12 min');
    expect(footerSleepLabel(true, null)).toBe('');
    expect(footerSleepLabel(true, undefined)).toBe('');
    expect(footerSleepLabel(false, '12 min')).toBe('');
  });
});
