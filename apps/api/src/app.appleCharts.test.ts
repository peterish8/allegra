import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function app(fetchImpl: typeof fetch) {
  return createApp({ version: 'test', jwtSecret: 'test-secret', fetchImpl, rateLimit: false });
}

test('Apple songs chart is normalized, storefront scoped and publicly cacheable', async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    urls.push(String(input));
    assert.ok(init?.signal instanceof AbortSignal);
    return jsonResponse({ feed: {
      updated: 'Sat, 17 Oct 2026 06:43:33 +0000',
      results: [{
        id: 'song-1',
        name: 'A chart song',
        artistName: 'A real artist',
        artworkUrl100: 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg',
        releaseDate: '2026-10-17',
        genres: [{ name: 'Tamil' }, { name: 'Music' }],
        url: 'https://music.apple.com/in/album/a-chart-song/album-1?i=song-1'
      }]
    } });
  };

  const response = await request(app(fetchImpl)).get('/api/charts/apple');
  assert.equal(response.status, 200);
  assert.deepEqual(urls, ['https://rss.marketingtools.apple.com/api/v2/in/music/most-played/50/songs.json']);
  assert.equal(response.headers['cache-control'], 'public, max-age=300, s-maxage=3600, stale-while-revalidate=21600');
  assert.deepEqual(response.body, {
    success: true,
    data: {
      source: 'Apple Music',
      storefront: 'IN',
      type: 'songs',
      available: true,
      updatedAt: '2026-10-17T06:43:33.000Z',
      items: [{
        id: 'song-1', rank: 1, title: 'A chart song', artist: 'A real artist',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg',
        appleUrl: 'https://music.apple.com/in/album/a-chart-song/album-1?i=song-1',
        releaseDate: '2026-10-17', genres: ['Tamil', 'Music']
      }]
    }
  });
});

test('Apple playlists keep their official chart order and tolerate missing artist names', async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse({ feed: {
    results: [
      { id: 'playlist-1', name: 'Tamil Hits', kind: 'playlists', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/100x100SC.DN01.jpg', genres: [], url: 'https://music.apple.com/in/playlist/tamil-hits/pl.one' },
      { id: 'playlist-2', name: 'Not an Apple link', url: 'https://example.com/playlist' }
    ]
  } });

  const response = await request(app(fetchImpl)).get('/api/charts/apple?country=IN&type=playlists');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.available, true);
  assert.equal(response.body.data.items.length, 1);
  assert.deepEqual(response.body.data.items[0], {
    id: 'playlist-1', rank: 1, title: 'Tamil Hits', artist: null,
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/100x100SC.DN01.jpg',
    appleUrl: 'https://music.apple.com/in/playlist/tamil-hits/pl.one',
    releaseDate: null, genres: []
  });
});

test('Apple chart query is constrained and upstream failures return an empty feed', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return jsonResponse({ private: 'provider details' }, 503);
  };

  const invalid = await request(app(fetchImpl)).get('/api/charts/apple?country=../../example&type=albums');
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);

  const unavailable = await request(app(fetchImpl)).get('/api/charts/apple?type=playlists');
  assert.equal(unavailable.status, 200);
  assert.equal(unavailable.body.success, true);
  assert.deepEqual(unavailable.body.data, {
    source: 'Apple Music', storefront: 'IN', type: 'playlists', available: false, updatedAt: null, items: []
  });
  assert.equal(JSON.stringify(unavailable.body).includes('provider details'), false);
});
