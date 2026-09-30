import { getAllegraSongs, postListenSignal, toPlayableAllegraSong, type AllegraSong } from './allegraApi';

describe('Allegra listen signal response', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('accepts the API 204 response so a delivered taste event leaves the outbox', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(null, { status: 204 })) as typeof fetch;

    await expect(postListenSignal('token', {
      songId: 'song-1', songRef: 'saavn:song-1', seconds: 18, playedAt: '2026-09-30T00:00:00.000Z',
    })).resolves.toEqual({ outcome: 'sent', data: undefined });
  });
});

describe('account song stream URLs', () => {
  const song: AllegraSong = {
    id: 'song-1',
    title: 'A song',
    artist: 'An artist',
    artwork: '',
    streamUrl: '/api/stream/song-1',
    duration: 180,
    source: 'Saavn',
  };

  it('uses only the same-origin Allegra stream proxy path', () => {
    expect(toPlayableAllegraSong(song)?.streamUrl).toMatch(/^https:\/\/allegravibe\.vercel\.app\/api\/stream\/song-1$/);
    expect(toPlayableAllegraSong({ ...song, streamUrl: 'https://cdn.example/song.mp3' })).toBeNull();
    expect(toPlayableAllegraSong({ ...song, streamUrl: '/api/stream/../auth/me' })).toBeNull();
    expect(toPlayableAllegraSong({ ...song, streamUrl: '/api/stream/gaana%3Asong-1' })).toBeNull();
  });

  it('accepts a Gaana proxy only when its path carries the matching namespaced ref', () => {
    const gaana = { ...song, source: 'Gaana' as const, streamUrl: '/api/stream/gaana%3Asong-1' };
    expect(toPlayableAllegraSong(gaana)?.streamUrl).toMatch(/\/api\/stream\/gaana%3Asong-1$/);
    expect(toPlayableAllegraSong({ ...gaana, streamUrl: '/api/stream/other-id' })).toBeNull();
  });
});

describe('provider-aware catalog lookup', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends a namespaced Gaana ref so provider ids cannot collide', async () => {
    let requestedUrl = '';
    global.fetch = jest.fn(async input => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ success: true, data: [{
        id: 'song-1', title: 'A song', artist: 'An artist', artwork: '',
        streamUrl: '/api/stream/gaana%3Asong-1', duration: 180, source: 'Gaana',
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const songs = await getAllegraSongs('token', ['gaana:song-1']);

    expect(requestedUrl).toContain('/api/songs?ids=gaana%3Asong-1');
    expect(songs?.[0]?.source).toBe('Gaana');
  });
});
