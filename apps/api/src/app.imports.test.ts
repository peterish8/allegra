import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp, type AppOptions } from './app.js';
import { createServices } from './services.js';
import { IMPORT_SIGNIN } from './routes/imports.js';
import { MemoryUserStore } from './user/store.js';

const rawSong = {
  id: 'song-1',
  name: 'Tum Hi Ho',
  primaryArtists: 'Arijit Singh',
  language: 'hindi',
  duration: 262,
  image: [{ quality: '500x500', url: 'https://img/song.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const fakeAccountVerifier = {
  verify: async (token: string) =>
    token.startsWith('convex:') ? { userId: token.slice('convex:'.length), source: 'convex' as const } : null
};

const ACCOUNT = 'Bearer convex:user_import';

function build(options: { enabled?: boolean; rateLimit?: AppOptions['rateLimit'] } = {}) {
  let searches = 0;
  const fetchImpl = (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes('/search/')) {
      searches += 1;
      if (url.includes('Broken')) return Promise.reject(new DOMException('timed out', 'AbortError'));
      return Promise.resolve(jsonResponse({ success: true, data: { results: [rawSong] } }));
    }
    return Promise.resolve(jsonResponse({ success: true, data: rawSong }));
  };
  const services = createServices({
    jwtSecret: 'test-secret',
    fetchImpl,
    saavnApiUrl: 'https://saavn.test/api',
    gaanaApiUrl: 'https://gaana.test/api',
    accountVerifier: fakeAccountVerifier,
    userStore: new MemoryUserStore()
  });
  const server = createApp({
    version: 'test',
    jwtSecret: 'test-secret',
    services,
    importEnabled: options.enabled ?? true,
    rateLimit: options.rateLimit ?? false
  });
  return { server, searches: () => searches };
}

const match = (server: ReturnType<typeof build>['server'], tracks: unknown, auth = ACCOUNT) =>
  request(server).post('/api/import/match').set('Authorization', auth).send({ tracks });

test('import matching answers 404 while IMPORT_ENABLED is off', async () => {
  const { server } = build({ enabled: false });
  const reply = await match(server, [{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }]);
  assert.equal(reply.status, 404);
  assert.equal(reply.body.success, false);
  assert.equal((await request(server).post('/api/me/taste/import-seed').set('Authorization', ACCOUNT).send({ artists: [{ name: 'A', count: 1 }] })).status, 404);
});

test('a guest is told to sign in; no session is 401', async () => {
  const { server } = build();
  const session = await request(server).post('/api/auth/anon');
  const reply = await match(server, [{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }], `Bearer ${String(session.body.data.token)}`);
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, IMPORT_SIGNIN);
  assert.equal((await request(server).post('/api/import/match').send({ tracks: [] })).status, 401);
});

test('batches of 0 or 51 tracks, and over-long text, are refused', async () => {
  const { server } = build();
  assert.equal((await match(server, [])).status, 400);
  assert.equal((await match(server, Array.from({ length: 51 }, () => ({ title: 'A', artist: 'B' })))).status, 400);
  assert.equal((await match(server, [{ title: 'x'.repeat(201), artist: 'B' }])).status, 400);
  assert.equal((await match(server, [{ title: 'A', artist: 'B', durationSec: -1 }])).status, 400);
  assert.equal((await match(server, 'nope')).status, 400);
});

test('an exact title and lead artist come back as a Saavn snapshot; a repeat is served from the cache', async () => {
  const { server, searches } = build();
  const reply = await match(server, [{ title: 'Tum Hi Ho', artist: 'Arijit Singh', durationSec: 260 }]);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.data.results[0], {
    index: 0,
    confidence: 'exact',
    song: reply.body.data.results[0].song
  });
  assert.equal(reply.body.data.results[0].song.ref, 'saavn:song-1');
  const before = searches();
  const again = await match(server, [{ title: 'Tum Hi Ho', artist: 'Arijit Singh', durationSec: 260 }]);
  assert.equal(again.body.data.results[0].confidence, 'exact');
  assert.equal(searches(), before);
});

test('a provider timeout gives none for that track and the batch still succeeds', async () => {
  const { server } = build();
  const reply = await match(server, [{ title: 'Broken', artist: 'Nobody' }, { title: 'Tum Hi Ho', artist: 'Arijit Singh' }]);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.data.results.map((r: { confidence: string }) => r.confidence), ['none', 'exact']);
  assert.equal(reply.body.data.results[0].song, null);
});

test('the import bucket allows 30 requests a minute, then 429', async () => {
  const { server } = build({ rateLimit: { imports: { windowMs: 60_000, limit: 30 } } });
  for (let n = 0; n < 30; n++) assert.equal((await match(server, [{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }])).status, 200);
  assert.equal((await match(server, [{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }])).status, 429);
});

test('an import seed of 300 artists changes the taste by at most 25', async () => {
  const { server } = build();
  const before = await request(server).get('/api/me/taste').set('Authorization', ACCOUNT);
  const artists = Array.from({ length: 300 }, (_, n) => ({ name: `Artist ${n}`, count: 300 - n }));
  const reply = await request(server).post('/api/me/taste/import-seed').set('Authorization', ACCOUNT).send({ artists });
  assert.equal(reply.status, 200);
  assert.ok(reply.body.data.signals - (before.body.data.signals ?? 0) <= 25);
  assert.equal(reply.body.data.topArtists[0].name, 'Artist 0');
  assert.equal((await request(server).post('/api/me/taste/import-seed').set('Authorization', ACCOUNT).send({ artists: [] })).status, 400);
  assert.equal((await request(server).post('/api/me/taste/import-seed').set('Authorization', ACCOUNT).send({ artists: [{ name: 'A', count: 1.5 }] })).status, 400);
});

test('with learning off an import seed is a 204 and changes nothing', async () => {
  const { server } = build();
  await request(server).patch('/api/me/settings').set('Authorization', ACCOUNT).send({ personalization: false });
  const reply = await request(server).post('/api/me/taste/import-seed').set('Authorization', ACCOUNT).send({ artists: [{ name: 'A', count: 3 }] });
  assert.equal(reply.status, 204);
  assert.equal((await request(server).get('/api/me/taste').set('Authorization', ACCOUNT)).body.data.signals, 0);
});

test('Spotify routes follow IMPORT_ENABLED and the daily hook needs the server secret', async () => {
  assert.equal((await request(build({ enabled: false }).server).get('/api/spotify/status').set('Authorization', ACCOUNT)).status, 404);
  const { server } = build();
  const status = await request(server).get('/api/spotify/status').set('Authorization', ACCOUNT);
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.data, { configured: false, connected: false, dailyEnabled: false, playlists: [] });
  const daily = await request(server).post('/api/internal/spotify/daily').set('x-convex-server-secret', 'guess').send({ userId: 'user_import' });
  assert.equal(daily.status, 401);
});

test('account responses are never cacheable', async () => {
  const { server } = build();
  const reply = await request(server).get('/api/spotify/status').set('Authorization', ACCOUNT);
  assert.equal(reply.headers['cache-control'], 'no-store');
});
