const mockFetchJson = jest.fn();
jest.mock('../net/fetchWithTimeout', () => ({ fetchJson: (...a: unknown[]) => mockFetchJson(...a) }));
jest.mock('../account/config', () => ({ ALLEGRA_API_URL: 'https://api.test' }));
jest.mock('../account/allegraApi', () => ({ toPlayableAllegraSong: (s: { id: string }) => ({ id: s.id, title: 't', artist: 'a' }) }));
import { fetchSharedPlaylist } from './shareService';

const payload = { success: true, data: { code: 'ABCD2345', name: 'Road trip', ownerName: 'Mira', songs: [{ id: '1' }] } };
beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers().setSystemTime(new Date('2026-11-13T10:00:00Z')); });
afterEach(() => jest.useRealTimers());

// The scanner resolves a playlist for its card; opening the page right after must not ask the server again.
test('a playlist just resolved opens its page without a second request', async () => {
  mockFetchJson.mockResolvedValue(payload);
  const first = await fetchSharedPlaylist('CACHE001');
  const second = await fetchSharedPlaylist('CACHE001');
  expect(mockFetchJson).toHaveBeenCalledTimes(1);
  expect(second).toBe(first);
});

test('the answer is asked for again after a minute', async () => {
  mockFetchJson.mockResolvedValue(payload);
  await fetchSharedPlaylist('CACHE002');
  jest.setSystemTime(new Date('2026-11-13T10:01:01Z'));
  await fetchSharedPlaylist('CACHE002');
  expect(mockFetchJson).toHaveBeenCalledTimes(2);
});

test('a code the server does not know is not remembered', async () => {
  mockFetchJson.mockResolvedValue({ success: false });
  expect(await fetchSharedPlaylist('CACHE003')).toBeNull();
  await fetchSharedPlaylist('CACHE003');
  expect(mockFetchJson).toHaveBeenCalledTimes(2);
});
