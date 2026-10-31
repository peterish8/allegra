import { shouldLoadMoreHome } from './homePagination';

const state = {
  hasScrolled: true,
  hasContinuation: true,
  isLoading: false,
  distanceFromEnd: 120,
  nearEndThreshold: 300,
  searchActive: false,
  chipActive: false,
};

describe('shouldLoadMoreHome', () => {
  it('loads the next page after scrolling near the end', () => {
    expect(shouldLoadMoreHome(state)).toBe(true);
  });

  it('does not load on mount before the listener scrolls', () => {
    expect(shouldLoadMoreHome({ ...state, hasScrolled: false })).toBe(false);
  });

  it('waits until the end is near and a continuation exists', () => {
    expect(shouldLoadMoreHome({ ...state, distanceFromEnd: 500 })).toBe(false);
    expect(shouldLoadMoreHome({ ...state, hasContinuation: false })).toBe(false);
  });

  it('does not request duplicate or irrelevant pages', () => {
    expect(shouldLoadMoreHome({ ...state, isLoading: true })).toBe(false);
    expect(shouldLoadMoreHome({ ...state, searchActive: true })).toBe(false);
    expect(shouldLoadMoreHome({ ...state, chipActive: true })).toBe(false);
  });
});
