const mockRows = new Map<string, unknown>();
const mockAccount = jest.fn();
jest.mock('../database/generatedPlaylistQueries', () => ({
  readQuickPicks: async (scope: string) => mockRows.get(scope),
  writeQuickPicks: async (row: { scope: string }) => { mockRows.set(row.scope, JSON.parse(JSON.stringify(row))); },
  bookmarkQuickPicks: async (scope: string, saved: boolean) => { mockRows.set(scope, { ...(mockRows.get(scope) as object), saved }); },
}));
jest.mock('../database/listenLogQueries', () => ({ listensSince: async () => [] }));
jest.mock('../services/account/allegraApi', () => ({ ...jest.requireActual('../services/account/allegraApi'), getRecommendations: (...args: unknown[]) => mockAccount(...args) }));
jest.mock('../services/stream/homeFeed', () => ({ buildHomeFeed: async () => ({ quickPicks: [] }) }));
jest.mock('../services/stream/officialSearch', () => ({ searchOfficial: jest.fn() }));
jest.mock('../services/stream/recommend', () => ({ recommendFor: jest.fn() }));
jest.mock('./songsStore', () => ({ useSongsStore: { getState: () => ({ songs: [] }) } }));
jest.mock('./streamHistoryStore', () => ({ useStreamHistoryStore: { getState: () => ({ plays: [] }) } }));
jest.mock('./luvsPreferencesStore', () => ({ useLuvsPreferencesStore: { getState: () => ({ preferredLanguages: [] }) } }));
jest.mock('./onlineLibraryStore', () => ({ useOnlineLibraryStore: { getState: () => ({ likedRefs: new Set() }) } }));
jest.mock('./playlistStore', () => ({ usePlaylistStore: { getState: () => ({ likedSongIds: new Set() }) } }));
import { useQuickPicksStore } from './quickPicksStore';
const apiSong = { id: 'abc', title: 'Song', artist: 'Artist', artwork: '', streamUrl: '/api/stream/abc', duration: 120, source: 'Saavn' };
beforeEach(() => { mockRows.clear(); mockAccount.mockReset(); mockAccount.mockResolvedValue([apiSong]); useQuickPicksStore.setState({ entries: {}, hydrated: {}, loading: {}, errors: {} }); });
test('Account caches stay separate and a saved identity survives a later revision', async () => {
  const store = useQuickPicksStore.getState();
  await store.refresh('account-a', 'token-a', true);
  await store.save('account-a', true);
  await store.refresh('account-a', 'token-a', true);
  await store.refresh('account-b', 'token-b', true);
  expect(useQuickPicksStore.getState().entries['account-a']).toMatchObject({ saved: true, revision: 2, scope: 'account-a' });
  expect(useQuickPicksStore.getState().entries['account-b']).toMatchObject({ saved: false, revision: 1, scope: 'account-b' });
});
test('An unavailable provider keeps the last complete revision', async () => {
  const store = useQuickPicksStore.getState();
  await store.refresh('offline-case', 'token', true);
  const previous = useQuickPicksStore.getState().entries['offline-case'];
  mockAccount.mockResolvedValue([]);
  await store.refresh('offline-case', 'token', true);
  expect(useQuickPicksStore.getState().entries['offline-case']).toBe(previous);
  expect(useQuickPicksStore.getState().errors['offline-case']).toMatch(/Keeping your last picks/);
});
test('Concurrent opens share one request and do not duplicate the playlist', async () => {
  let deliver!: (rows: typeof apiSong[]) => void;
  mockAccount.mockReturnValue(new Promise(resolve => { deliver = resolve; }));
  const first = useQuickPicksStore.getState().refresh('concurrent', 'token', true);
  const second = useQuickPicksStore.getState().refresh('concurrent', 'token', true);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(mockAccount).toHaveBeenCalledTimes(1);
  deliver([apiSong]);
  await Promise.all([first, second]);
  expect(useQuickPicksStore.getState().entries.concurrent?.revision).toBe(1);
});
