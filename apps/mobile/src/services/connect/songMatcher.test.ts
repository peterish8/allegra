import { getAllegraSongById, matchConnectSong, matchEach } from './songMatcher';
import type { Song } from '../../types/song';
import type { SongSnapshot } from '@shared/songRef';

const snapshot: SongSnapshot = {
  ref: 'saavn:abc',
  title: 'Naatu Naatu',
  artist: 'Rahul Sipligunj',
  artwork: 'https://img.example/cover.jpg',
  duration: 220,
};

const local = (overrides: Partial<Song> = {}): Song => ({
  id: 'download-1',
  title: snapshot.title,
  artist: snapshot.artist,
  gradientId: 'dynamic',
  duration: 220,
  dateCreated: '2026-01-01T00:00:00.000Z',
  dateModified: '2026-01-01T00:00:00.000Z',
  playCount: 0,
  lyrics: [],
  audioUri: 'file:///music/naatu.mp3',
  originId: snapshot.ref,
  ...overrides,
});

const catalog = {
  id: 'abc',
  title: snapshot.title,
  artist: snapshot.artist,
  artwork: snapshot.artwork,
  streamUrl: '/api/stream/abc',
  duration: 220,
  source: 'Saavn' as const,
};

describe('Connect song matching', () => {
  it('uses an exact downloaded origin before the network', async () => {
    const result = await matchConnectSong(snapshot, {
      localSongs: () => [local()],
      getCatalogSong: jest.fn(),
      searchCatalog: async () => [],
      token: () => 'token',
    });

    expect(result).toEqual({ kind: 'local', song: local() });
  });

  it('resolves an exact account catalog row to its API proxy stream', async () => {
    const getCatalogSong = jest.fn(async () => catalog);
    const result = await matchConnectSong(snapshot, {
      localSongs: () => [],
      getCatalogSong,
      searchCatalog: async () => [],
      token: () => 'token',
    });

    expect(result?.kind).toBe('catalog');
    expect(getCatalogSong).toHaveBeenCalledWith('saavn:abc', 'token');
    if (result?.kind === 'catalog') {
      expect(result.song.id).toBe('abc');
      expect(result.song.streamUrl).toContain('/api/stream/abc');
    }
  });

  it('looks up Gaana by namespaced ref and accepts only that exact provider row', async () => {
    const gaanaSnapshot: SongSnapshot = { ...snapshot, ref: 'gaana:abc' };
    const gaanaSong = { ...catalog, source: 'Gaana' as const, streamUrl: '/api/stream/gaana%3Aabc' };
    const getCatalogSong = jest.fn(async () => gaanaSong);
    const result = await matchConnectSong(gaanaSnapshot, {
      localSongs: () => [],
      getCatalogSong,
      searchCatalog: async () => [],
      token: () => 'token',
    });

    expect(getCatalogSong).toHaveBeenCalledWith('gaana:abc', 'token');
    expect(result?.kind).toBe('catalog');
    if (result?.kind === 'catalog') expect(result.song.source).toBe('Gaana');
  });

  it('rejects a wrong or non-proxy account row and requires a recording match', async () => {
    const wrong = { ...catalog, id: 'different', streamUrl: 'https://cdn.example/audio.mp3' };
    const result = await matchConnectSong(snapshot, {
      localSongs: () => [],
      getCatalogSong: async () => wrong,
      searchCatalog: async () => [{
        id: 'different', title: 'Naatu Naatu slowed', artist: snapshot.artist,
        highResArt: '', downloadUrl: 'https://cdn.example/audio.mp3', source: 'Saavn',
      }],
      token: () => 'token',
    });

    expect(result).toBeNull();
  });

  it('answers each queued song in its place, with a gap for one unavailable here', async () => {
    const missing: SongSnapshot = { ...snapshot, ref: 'saavn:missing', title: 'Not in any catalog' };
    const second: SongSnapshot = { ...snapshot, ref: 'saavn:second', title: 'Second song' };
    const matched = await matchEach([snapshot, missing, second], {
      localSongs: () => [local()],
      getCatalogSong: async ref => ref === 'saavn:second' ? { ...catalog, id: 'second', streamUrl: '/api/stream/second', title: 'Second song' } : null,
      searchCatalog: async () => [],
      token: () => 'token',
    });

    expect(matched.map(match => match?.kind ?? null)).toEqual(['local', null, 'catalog']);
    expect(matched[0]?.song.id).toBe('download-1');
    expect(matched[2]?.song.id).toBe('second');
  });

  it('stops looking songs up once a newer queue has replaced this one', async () => {
    let lookups = 0;
    const matched = await matchEach([snapshot, { ...snapshot, ref: 'saavn:second', title: 'Second song' }], {
      localSongs: () => [],
      getCatalogSong: async () => { lookups += 1; return null; },
      searchCatalog: async () => [],
      token: () => 'token',
    }, 1, () => lookups === 0);

    expect(lookups).toBe(1);
    expect(matched).toEqual([null, null]);
  });
});

describe('provider-aware Connect catalog lookup', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('matches the bare id together with the requested source', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [
      { id: 'abc', title: 'Saavn row', artist: 'Artist', artwork: '', streamUrl: '/api/stream/abc', duration: 220, source: 'Saavn' },
      { id: 'abc', title: 'Gaana row', artist: 'Artist', artwork: '', streamUrl: '/api/stream/gaana%3Aabc', duration: 220, source: 'Gaana' },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

    await expect(getAllegraSongById('gaana:abc', 'token')).resolves.toMatchObject({ source: 'Gaana', title: 'Gaana row' });
  });
});
