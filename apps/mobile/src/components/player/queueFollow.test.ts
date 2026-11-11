import { shouldFollowQueueIndex } from './queueFollow';

describe('Up Next follows playback when the listener is idle', () => {
  const base = {
    open: true,
    panelDragging: false,
    listDragging: false,
    lastInteractionAt: 1_000,
    now: 5_000,
    rowVisible: true,
  };

  it('follows after scrolling has settled and the playing row is visible', () => {
    expect(shouldFollowQueueIndex(base)).toBe(true);
  });

  it('leaves the list under the listener during a drag or momentum scroll', () => {
    expect(shouldFollowQueueIndex({ ...base, listDragging: true })).toBe(false);
    expect(shouldFollowQueueIndex({ ...base, panelDragging: true })).toBe(false);
  });

  it('waits for a quiet period after interaction and ignores rows hidden by the filter', () => {
    expect(shouldFollowQueueIndex({ ...base, now: 2_500 })).toBe(false);
    expect(shouldFollowQueueIndex({ ...base, rowVisible: false })).toBe(false);
    expect(shouldFollowQueueIndex({ ...base, open: false })).toBe(false);
  });
});
