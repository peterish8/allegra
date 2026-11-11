import { planLyricsSwap } from './lyricsSwap';

const base = { sameObject: false, expanded: true };

describe('planLyricsSwap', () => {
  it('fades to another song while the bar is open', () => {
    expect(planLyricsSwap({ ...base, shownId: 'a', currentId: 'b' })).toBe('fade');
  });

  it('swaps at once while the bar is closed', () => {
    expect(planLyricsSwap({ ...base, shownId: 'a', currentId: 'b', expanded: false })).toBe('cut');
  });

  it('refreshes the same song when its object changed (lyrics landed, or a skip away and back)', () => {
    expect(planLyricsSwap({ ...base, shownId: 'a', currentId: 'a', sameObject: false })).toBe('refresh');
  });

  it('does nothing when nothing changed', () => {
    expect(planLyricsSwap({ ...base, shownId: 'a', currentId: 'a', sameObject: true })).toBe('none');
  });

  it('treats no song on both sides as the same song', () => {
    expect(planLyricsSwap({ ...base, shownId: null, currentId: undefined })).toBe('refresh');
    expect(planLyricsSwap({ ...base, shownId: null, currentId: null, sameObject: true })).toBe('none');
  });
});
