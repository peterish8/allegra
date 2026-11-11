const mockState = {
  membership: new Set<string>(['download-stale']),
  songs: [
    { id: 'download-keep', title: 'Keep', artist: 'Artist', duration: 180, originId: 'saavn:keep' },
    { id: 'download-stale', title: 'Removed', artist: 'Artist', duration: 180, originId: 'saavn:stale' },
    { id: 'download-live', title: 'Live', artist: 'Artist', duration: 180, originId: 'saavn:live' },
  ],
  outbox: [{ id: 1, kind: 'op', body: JSON.stringify({ op: 'unlike', ref: 'saavn:keep', at: 1 }), createdAt: 1, accountUserId: null }],
  meta: new Map<string, string>([['account', 'listener'], ['rev:listener', '2']]),
  events: [] as string[],
  failMembership: false,
};

const mockGetLibraryChanges = jest.fn();
const mockPostLibraryOps = jest.fn();
type MockPostReply = { outcome: 'sent' | 'offline' | 'refused'; data: Record<string, never> };
const mockPostPlay = jest.fn(async (_token: string, _body: unknown): Promise<MockPostReply> => ({ outcome: 'sent', data: {} }));
const mockPostListenSignal = jest.fn(async (_token: string, _body: unknown) => ({ outcome: 'sent' as const, data: {} }));
const mockGetMeta = jest.fn(async (key: string) => mockState.meta.get(key) ?? null);
const mockSetMeta = jest.fn(async (key: string, value: string) => {
  mockState.events.push(`cursor:${value}`);
  mockState.meta.set(key, value);
});
const mockSetMembership = jest.fn(async (_playlistId: string, songId: string, present: boolean) => {
  if (mockState.failMembership) throw new Error('SQLite write failed');
  mockState.events.push(`membership:${songId}:${present}`);
  if (present) mockState.membership.add(songId);
  else mockState.membership.delete(songId);
});
const mockPeekOutbox = jest.fn(async (kind: string, limit?: number, owner?: string) =>
  mockState.outbox.filter(entry => entry.kind === kind && (kind !== 'play' || entry.accountUserId === owner)).slice(0, limit ?? 100));
const mockReadOutbox = jest.fn(async (_kind?: string) => [...mockState.outbox]);
const mockRemoveOutbox = jest.fn(async (ids: readonly number[], owner?: string) => {
  mockState.outbox = mockState.outbox.filter((entry) => !ids.includes(entry.id) || (owner !== undefined && entry.accountUserId !== owner));
});
const mockEnqueueOutbox = jest.fn(async (kind: string, body: unknown, owner?: string) => {
  mockState.outbox.push({ id: Math.max(0, ...mockState.outbox.map(entry => entry.id)) + 1, kind, body: JSON.stringify(body), createdAt: Date.now(), accountUserId: owner ?? null });
});
const mockUpdateOutboxBody = jest.fn(async (id: number, body: unknown, owner?: string) => {
  const row = mockState.outbox.find(entry => entry.id === id && (owner === undefined || entry.accountUserId === owner));
  if (row) row.body = JSON.stringify(body);
});
const mockFetchPlaylists = jest.fn(async () => undefined);
const mockFetchSongs = jest.fn(async () => undefined);
const mockLoadOnlineLibrary = jest.fn(async () => undefined);

jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('convex/server', () => ({ makeFunctionReference: jest.fn(() => 'library:myRev') }));
jest.mock('../../database/syncQueries', () => ({
  getMeta: (...args: unknown[]) => mockGetMeta(...args as [string]),
  setMeta: (...args: unknown[]) => mockSetMeta(...args as [string, string]),
  peekOutbox: (kind: string, limit?: number, owner?: string) => mockPeekOutbox(kind, limit, owner),
  readOutbox: (kind: string) => mockReadOutbox(kind),
  removeOutbox: (...args: unknown[]) => mockRemoveOutbox(...args as [readonly number[], string?]),
  getOutboxStuckSince: jest.fn(async () => null),
  clearOutboxStuck: jest.fn(async () => undefined),
  markOutboxStuck: jest.fn(async (now: number) => now),
  getLocalSongs: jest.fn(async () => [...mockState.songs]),
  getLocalPlaylists: jest.fn(async () => [{ id: 'default_liked', name: 'Liked songs', isDefault: true, songIds: [...mockState.membership] }]),
  getOnlineLikes: jest.fn(async () => []),
  getOnlinePlaylistSongs: jest.fn(async () => []),
  setPlaylistMembership: (...args: unknown[]) => mockSetMembership(...args as [string, string, boolean]),
  setOriginId: jest.fn(async () => undefined),
  removeOnlineLike: jest.fn(async () => undefined),
  deletePlaylistRaw: jest.fn(async () => undefined),
  removeOnlinePlaylistSong: jest.fn(async () => undefined),
  upsertOnlineLike: jest.fn(async () => undefined),
  upsertPlaylistRaw: jest.fn(async () => undefined),
  upsertOnlinePlaylistSong: jest.fn(async () => undefined),
  enqueueOutbox: (...args: unknown[]) => mockEnqueueOutbox(...args as [string, unknown, string?]),
  updateOutboxBody: (...args: unknown[]) => mockUpdateOutboxBody(...args as [number, unknown, string?]),
}));
jest.mock('../account/allegraApi', () => ({
  getLibraryChanges: (...args: unknown[]) => mockGetLibraryChanges(...args),
  getAllegraSongs: jest.fn(async () => []),
  postPlay: (...args: unknown[]) => mockPostPlay(...args as [string, unknown]),
  postListenSignal: (...args: unknown[]) => mockPostListenSignal(...args as [string, unknown]),
}));
jest.mock('./opsApi', () => ({ postLibraryOps: (...args: unknown[]) => mockPostLibraryOps(...args) }));
jest.mock('./syncHealth', () => ({ setStuckSince: jest.fn() }));
jest.mock('../../store/onlineLibraryStore', () => ({
  useOnlineLibraryStore: { getState: () => ({ load: mockLoadOnlineLibrary, bumpPlaylists: jest.fn() }) },
}));
jest.mock('../../store/syncStore', () => ({ useSyncStore: { getState: () => ({ set: jest.fn() }) } }));
jest.mock('../../store/playlistStore', () => ({ usePlaylistStore: { getState: () => ({ fetchPlaylists: mockFetchPlaylists }) } }));
jest.mock('../../store/songsStore', () => ({ useSongsStore: { getState: () => ({ fetchSongs: mockFetchSongs }) } }));
jest.mock('../MultiSourceSearchService', () => ({ searchMusic: jest.fn(async () => []) }));

import { attach, detach, recordPlay } from './LibrarySync';

const liveLike = (ref: string, title: string, rev: number) => ({
  kind: 'like' as const,
  ref: ref as `saavn:${string}`,
  liked: true,
  likedAt: rev,
  rev,
  song: { ref: ref as `saavn:${string}`, title, artist: 'Artist', artwork: 'https://img.example/cover.jpg', duration: 180 },
});

async function runSync(): Promise<void> {
  const watch = { onUpdate: jest.fn(() => jest.fn()), localQueryResult: jest.fn(() => null) };
  await attach({ userId: 'listener', getToken: () => 'token' }, { watchQuery: jest.fn(() => watch) } as never);
  await jest.runOnlyPendingTimersAsync();
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockState.membership = new Set(['download-stale']);
  mockState.outbox = [{ id: 1, kind: 'op', body: JSON.stringify({ op: 'unlike', ref: 'saavn:keep', at: 1 }), createdAt: 1, accountUserId: null }];
  mockState.meta = new Map([['account', 'listener'], ['rev:listener', '2']]);
  mockState.events = [];
  mockState.failMembership = false;
  mockPostLibraryOps.mockResolvedValue({ outcome: 'offline' });
  mockPostPlay.mockReset().mockResolvedValue({ outcome: 'sent', data: {} });
  mockPostListenSignal.mockReset().mockResolvedValue({ outcome: 'sent', data: {} });
});

afterEach(() => {
  detach();
  jest.useRealTimers();
});

describe('LibrarySync full resync', () => {
  it('fetches every page, replaces stale synced rows, preserves pending local edits and advances last', async () => {
    mockGetLibraryChanges
      .mockResolvedValueOnce({ outcome: 'sent', data: { rev: 4, changes: [liveLike('saavn:keep', 'Keep', 3)], more: true, resync: true } })
      .mockResolvedValueOnce({ outcome: 'sent', data: { rev: 8, changes: [liveLike('saavn:live', 'Live', 7)], more: false, resync: true } });

    await runSync();

    expect(mockGetLibraryChanges).toHaveBeenCalledTimes(2);
    expect(mockGetLibraryChanges).toHaveBeenLastCalledWith('token', 4, 500, true);
    expect(mockState.membership).toEqual(new Set(['download-live']));
    expect(mockState.outbox).toHaveLength(1);
    expect(mockRemoveOutbox).not.toHaveBeenCalled();
    expect(mockState.meta.get('rev:listener')).toBe('8');
    const cursorEvent = mockState.events.indexOf('cursor:8');
    expect(cursorEvent).toBeGreaterThan(mockState.events.indexOf('membership:download-live:true'));
    expect(mockState.events).toContain('membership:download-stale:false');
    expect(mockState.events).not.toContain('membership:download-keep:true');
  });

  it('does not persist the cursor when local reconciliation fails', async () => {
    mockState.failMembership = true;
    mockGetLibraryChanges.mockResolvedValue({
      outcome: 'sent',
      data: { rev: 8, changes: [liveLike('saavn:live', 'Live', 7)], more: false, resync: true },
    });

    await runSync();

    expect(mockState.meta.get('rev:listener')).toBe('2');
    expect(mockSetMeta).not.toHaveBeenCalled();
    expect(mockState.outbox).toHaveLength(1);
  });
});

describe('play history account ownership', () => {
  it('keeps A offline plays for A, waits for B first-sync choice, and ignores stale A request completion', async () => {
    mockState.outbox = [];
    mockState.meta = new Map([['account', 'account-a'], ['rev:account-a', '0']]);
    const watch = { onUpdate: jest.fn(() => jest.fn()), localQueryResult: jest.fn(() => null) };
    const convex = { watchQuery: jest.fn(() => watch) } as never;
    await attach({ userId: 'account-a', getToken: () => 'token-a' }, convex);
    await jest.advanceTimersByTimeAsync(0);

    const track = { ref: 'saavn:track-a' as const, title: 'A song', artist: 'Artist', artwork: '', duration: 180 };
    recordPlay(track.ref, 20, track, '2026-10-01T00:00:00.000Z');
    await Promise.resolve();
    mockPostPlay.mockResolvedValueOnce({ outcome: 'offline', data: {} });
    await jest.advanceTimersByTimeAsync(1500);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(mockState.outbox[0]?.accountUserId).toBe('account-a');
    expect(mockState.outbox).toHaveLength(1);

    let finishARequest!: () => void;
    mockPostPlay.mockImplementationOnce(async (token: string) => {
      expect(token).toBe('token-a');
      return await new Promise<{ outcome: 'sent'; data: Record<string, never> }>(resolve => {
        finishARequest = () => resolve({ outcome: 'sent', data: {} });
      });
    });
    detach();
    await attach({ userId: 'account-a', getToken: () => 'token-a' }, convex);
    await jest.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(mockPostPlay).toHaveBeenCalledTimes(2);
    expect(mockState.outbox[0]?.accountUserId).toBe('account-a');

    await attach({ userId: 'account-b', getToken: () => 'token-b' }, convex);
    await jest.advanceTimersByTimeAsync(0);
    finishARequest();
    for (let index = 0; index < 40; index += 1) await Promise.resolve();

    expect(mockPostPlay).toHaveBeenCalledTimes(2);
    expect(mockPostListenSignal).not.toHaveBeenCalled();
    expect(mockState.outbox).toHaveLength(1);
    expect(mockState.outbox[0]?.accountUserId).toBe('account-a');
    expect(mockRemoveOutbox).not.toHaveBeenCalledWith(expect.anything(), 'account-b');

    await attach({ userId: 'account-a', getToken: () => 'token-a' }, convex);
    await jest.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 40; index += 1) await Promise.resolve();
    expect(mockPostPlay.mock.calls.at(-1)?.[0]).toBe('token-a');
    expect(mockPostListenSignal.mock.calls.at(-1)?.[0]).toBe('token-a');
    expect(mockState.outbox).toHaveLength(0);
  });
});
