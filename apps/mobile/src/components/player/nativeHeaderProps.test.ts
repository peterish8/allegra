import { headerActionOf, headerChipCount, headerHeight, headerPlayingKind, shouldUseNativeHeader } from './nativeHeaderProps';

describe('nativeHeaderProps', () => {
  it('reads the control that was used', () => {
    for (const action of ['back', 'together', 'playingOn'] as const) {
      expect(headerActionOf({ nativeEvent: { action } })).toBe(action);
    }
    expect(headerActionOf({ nativeEvent: { action: 'close' } })).toBeNull();
    expect(headerActionOf({ nativeEvent: { action: 7 } })).toBeNull();
    expect(headerActionOf(undefined)).toBeNull();
  });

  it('counts the chips that show', () => {
    expect(headerChipCount(null, null)).toBe(0);
    expect(headerChipCount(undefined, '')).toBe(0);
    // A room with nobody else in it still shows its chip (together = 0 is a count, not "absent").
    expect(headerChipCount(0, null)).toBe(1);
    expect(headerChipCount(3, 'Laptop')).toBe(2);
    expect(headerChipCount(null, 'Laptop')).toBe(1);
  });

  it('sizes the view: the stack plus the grabber slop above, and below when no chip reaches further', () => {
    expect(headerHeight(0)).toBe(41);
    expect(headerHeight(1)).toBe(65);
    expect(headerHeight(2)).toBe(101);
    expect(headerHeight(-1)).toBe(41);
  });

  it('picks the playing-on icon kind', () => {
    expect(headerPlayingKind('web')).toBe('web');
    expect(headerPlayingKind('android')).toBe('phone');
    expect(headerPlayingKind('ios')).toBe('phone');
    expect(headerPlayingKind(undefined)).toBe('phone');
  });

  it('is native only where the view exists', () => {
    expect(shouldUseNativeHeader(true)).toBe(true);
    expect(shouldUseNativeHeader(false)).toBe(false);
  });
});
