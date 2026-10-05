import { SpotifyApiError, connectSpotify, fetchSpotifyStatus, fetchSpotifyPlaylists, syncSpotifyPlaylist, setSpotifyDailySync, disconnectSpotify } from './spotifyApi';

const response = (data: unknown, status = 200, headers?: Record<string, string>): Response => new Response(JSON.stringify({ success: true, data }), { status, headers });

describe('Spotify transfer API', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it('uses Allegra bearer auth, official OAuth return target, and checks every response shape', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response({ configured: true, connected: true, dailyEnabled: false, playlists: [] }))
      .mockResolvedValueOnce(response({ url: 'https://accounts.spotify.com/authorize?client_id=public' }))
      .mockResolvedValueOnce(response({ playlists: [{ id: 'source-1', name: 'Road', snapshotId: 'snapshot', total: 10 }] }))
      .mockResolvedValueOnce(response({ complete: true, added: 4, skipped: 2, reviewNeeded: 1, libraryId: 'lib-1' }))
      .mockResolvedValueOnce(response({ dailyEnabled: true }))
      .mockResolvedValueOnce(response({ disconnected: true }));
    global.fetch = fetchMock as unknown as typeof fetch;

    expect((await fetchSpotifyStatus('account-token')).connected).toBe(true);
    expect(await connectSpotify('account-token')).toEqual({ url: 'https://accounts.spotify.com/authorize?client_id=public' });
    expect((await fetchSpotifyPlaylists('account-token')).playlists[0]?.id).toBe('source-1');
    expect((await syncSpotifyPlaylist('account-token', 'source-1')).added).toBe(4);
    expect(await setSpotifyDailySync('account-token', true)).toEqual({ dailyEnabled: true });
    await disconnectSpotify('account-token');

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/spotify/status'), expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer account-token' }) }));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ returnTo: 'mobile' });
    expect(fetchMock.mock.calls[3]?.[0]).toContain('/api/spotify/sync');
  });

  it('rejects HTTP-success responses with an invalid sync contract', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ complete: true, added: '4', skipped: 0, reviewNeeded: 0, libraryId: 'lib-1' })) as unknown as typeof fetch;
    await expect(syncSpotifyPlaylist('token', 'source')).rejects.toThrow('invalid progress response');
  });

  it('surfaces 429 retry-after instead of retrying without a bound', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, error: 'Slow down' }), { status: 429, headers: { 'Retry-After': '7' } })) as unknown as typeof fetch;
    await expect(fetchSpotifyStatus('token')).rejects.toMatchObject<Partial<SpotifyApiError>>({ status: 429, retryAfterSeconds: 7 });
  });
});
