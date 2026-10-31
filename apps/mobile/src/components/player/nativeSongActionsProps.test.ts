import {
  likeLabelOf,
  shouldUseNativeSongActions,
  songActionCount,
  songActionOf,
  songActionsWidth,
} from './nativeSongActionsProps';

describe('nativeSongActionsProps', () => {
  it('reads the button that was used', () => {
    for (const action of ['fullscreen', 'more', 'like'] as const) {
      expect(songActionOf({ nativeEvent: { action } })).toBe(action);
    }
  });

  it('ignores anything it does not know', () => {
    expect(songActionOf({ nativeEvent: { action: 'share' } })).toBeNull();
    expect(songActionOf({ nativeEvent: { action: 1 } })).toBeNull();
    expect(songActionOf({ nativeEvent: {} })).toBeNull();
    expect(songActionOf(undefined)).toBeNull();
  });

  it('counts the buttons shown and sizes the cluster', () => {
    expect(songActionCount(false, false)).toBe(1);
    expect(songActionCount(true, false)).toBe(2);
    expect(songActionCount(false, true)).toBe(2);
    expect(songActionCount(true, true)).toBe(3);
    expect(songActionsWidth(0)).toBe(0);
    expect(songActionsWidth(1)).toBe(38);
    expect(songActionsWidth(2)).toBe(86);
    expect(songActionsWidth(3)).toBe(134);
  });

  it('words the like button like the React Native one', () => {
    expect(likeLabelOf(false, false)).toBe('Like');
    expect(likeLabelOf(true, false)).toBe('Unlike');
    expect(likeLabelOf(true, true)).toBe('Saving to Liked songs, tap to cancel');
    expect(likeLabelOf(false, true)).toBe('Saving to Liked songs, tap to cancel');
  });

  it('is native only where the view exists', () => {
    expect(shouldUseNativeSongActions(true)).toBe(true);
    expect(shouldUseNativeSongActions(false)).toBe(false);
  });
});
