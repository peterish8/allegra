const mockSetPlaylistQueue = jest.fn();
const mockSearch = jest.fn();

jest.mock('../../database/syncQueries', () => ({ removeOnlinePlaylistSong: jest.fn() }));
jest.mock('../MultiSourceSearchService', () => ({ searchMusic: (...args: unknown[]) => mockSearch(...args) }));
jest.mock('../stream/StreamService', () => ({ StreamService: { register: jest.fn() } }));
jest.mock('../stream/streamSong', () => ({ toStreamSong: (song: object) => song }));
jest.mock('./LibrarySync', () => ({ record: jest.fn() }));
jest.mock('../../store/onlineLibraryStore', () => ({ useOnlineLibraryStore: { getState: () => ({}) } }));
jest.mock('../../store/playerStore', () => ({
  prepareNextInQueue: jest.fn(),
  usePlayerStore: { getState: () => ({ setPlaylistQueue: mockSetPlaylistQueue, currentPlaylistId: null, playlistQueue: null }) },
}));

import { instantStreamSong, leadingPlayable, playList } from './onlineSongs';
import type { Song } from '../../types/song';

const local = (id: string): Song => ({ id, title: id, artist: 'a', audioUri: `file:///${id}.m4a` } as Song);
const online = (id: string): Song => ({ id: `stream:${id}`, title: id, artist: 'a' } as Song);

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch.mockReturnValue(new Promise(() => undefined));
});

test('songs already on the phone play at once, up to the first one that needs a lookup', () => {
  expect(leadingPlayable([local('a'), local('b'), online('c'), local('d')]).map(s => s.id)).toEqual(['a', 'b']);
  expect(leadingPlayable([local('a'), local('b')]).map(s => s.id)).toEqual(['a', 'b']);
  expect(leadingPlayable([online('c'), local('d')])).toEqual([]);
  expect(leadingPlayable([])).toEqual([]);
});

test('an online song tapped in a playlist starts at once from its catalog id, before any lookup', async () => {
  const songs = [local('before'), online('saavn:abc'), local('a'), online('saavn:def')];
  const started = playList('p1', songs, 1);
  // Queued on the same tick as the tap, through Allegra's stream route: the old song stops and this one starts.
  expect(mockSetPlaylistQueue).toHaveBeenCalledWith('p1', [
    expect.objectContaining({ id: 'stream:saavn:abc', audioUri: expect.stringMatching(/\/api\/stream\/abc$/) }),
    songs[2],
  ], 0);
  await expect(started).resolves.toBe(true);
});

test('an instant Gaana song names its whole ref on the stream route, and a bad id plays nothing', () => {
  expect(instantStreamSong(online('gaana:xyz'))?.audioUri).toMatch(/\/api\/stream\/gaana%3Axyz$/);
  expect(instantStreamSong(online('nonsense'))).toBeNull();
  expect(instantStreamSong(local('a'))?.audioUri).toBe('file:///a.m4a');
});

test('a downloaded song tapped in a list with online songs starts without waiting on the network', async () => {
  const songs = [online('x'), local('a'), local('b'), online('c')];
  const started = playList('p1', songs, 1);
  // Queued on the same tick as the tap: no lookup stands in front of it.
  expect(mockSetPlaylistQueue).toHaveBeenCalledWith('p1', [songs[1], songs[2]], 0);
  await expect(started).resolves.toBe(true);
});
