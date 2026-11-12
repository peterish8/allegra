import React from 'react';
const mockSlots: unknown[] = [];
let mockCursor = 0;
let mockPending: (() => void)[] = [];
type EffectSlot = { deps: unknown[]; cleanup?: () => void };
jest.mock('react', () => ({ ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const i = mockCursor++;
    if (!(i in mockSlots)) mockSlots[i] = initial;
    return [mockSlots[i], (next: unknown) => { mockSlots[i] = typeof next === 'function' ? next(mockSlots[i]) : next; }];
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const i = mockCursor++;
    const old = mockSlots[i] as EffectSlot | undefined;
    if (!old || deps.some((d, j) => d !== old.deps[j])) mockPending.push(() => {
      old?.cleanup?.(); mockSlots[i] = { deps, cleanup: effect() };
    });
  },
}));
jest.mock('react-native', () => ({ ActivityIndicator: 'Spinner', ScrollView: 'Scroll', View: 'View', StyleSheet: { create: (s: unknown) => s } }));
jest.mock('../../ui', () => ({ CollectionCard: 'CollectionCard', Button: 'Button', Text: 'Text', Signal: { ink: 'white' }, Space: { md: 16, sm: 8 } }));
jest.mock('../allegra/home', () => ({ SectionHeading: 'Heading' }));
jest.mock('../library/SavedQuickPicks', () => ({ SavedQuickPicks: 'Saved', useSavedQuickPicks: () => ({}) }));
const mockAlbums = jest.fn();
const mockArtists = jest.fn();
jest.mock('../../services/search/catalogSearch', () => ({ searchAlbums: (...args: unknown[]) => mockAlbums(...args) }));
jest.mock('../../services/ytmusic/YTMusicClient', () => ({ YTMusicClient: { searchArtists: (...args: unknown[]) => mockArtists(...args) } }));
jest.mock('../../store/playlistStore', () => ({ usePlaylistStore: (select: (s: unknown) => unknown) => select({ playlists: [] }) }));
jest.mock('../../utils/navigationService', () => ({ navigationRef: { navigate: jest.fn() } }));
import { SearchCategoryResults } from './SearchCategoryResults';
import type { SearchCategory } from '../../store/searchSessionStore';
function render(query: string, category: SearchCategory) {
  mockCursor = 0;
  const node = SearchCategoryResults({ query, category });
  const pending = mockPending; mockPending = []; pending.forEach(run => run());
  return node;
}
function labels(node: React.ReactNode): string[] {
  return React.Children.toArray(node).flatMap(child => {
    if (typeof child === 'string') return [child];
    if (!React.isValidElement<{ children?: React.ReactNode; title?: string; label?: string }>(child)) return [];
    return [child.props.title ?? '', child.props.label ?? '', ...labels(child.props.children)];
  });
}
beforeEach(() => { jest.useFakeTimers(); mockSlots.length = 0; mockCursor = 0; mockPending = []; jest.clearAllMocks(); });
afterEach(() => { for (const slot of mockSlots) (slot as EffectSlot | undefined)?.cleanup?.(); jest.useRealTimers(); });
test('An older album request cannot replace the selected artist category', async () => {
  let albumArrived!: (value: unknown[]) => void;
  mockAlbums.mockReturnValue(new Promise(resolve => { albumArrived = resolve; }));
  mockArtists.mockResolvedValue([{ kind: 'artist', browseId: 'new', title: 'Active artist' }]);
  render('old-query', 'Albums');
  await jest.advanceTimersByTimeAsync(350);
  render('new-query', 'Artists');
  await jest.advanceTimersByTimeAsync(350);
  albumArrived([{ id: 'old', name: 'Wrong album', artist: 'Old artist' }]);
  await Promise.resolve(); await Promise.resolve();
  const shown = labels(render('new-query', 'Artists'));
  expect(shown).toContain('Active artist');
  expect(shown).not.toContain('Wrong album');
});
test('Failed album search offers retry and successful empty search has a different message', async () => {
  mockAlbums.mockRejectedValue(new Error('offline'));
  render('failed-query', 'Albums');
  await jest.advanceTimersByTimeAsync(350);
  expect(labels(render('failed-query', 'Albums'))).toContain('Retry results');
  mockAlbums.mockResolvedValue([]);
  render('empty-query', 'Albums');
  await jest.advanceTimersByTimeAsync(350);
  const empty = labels(render('empty-query', 'Albums'));
  expect(empty).toContain('No albums match this search.');
  expect(empty).not.toContain('Retry results');
});
