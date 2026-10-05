import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';
import { createServices } from './services.js';
import { currentWeight } from './shared/blendDecay.js';
import { MemoryUserStore } from './user/store.js';
import { MemoryTasteTally, type TasteTally } from './user/tasteTally.js';

const rawSong = {
  id: 'song-1',
  name: 'Tum Hi Ho',
  primaryArtists: 'Arijit Singh',
  language: 'hindi',
  duration: 240,
  image: [{ quality: '500x500', url: 'https://img/song.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
};

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  const body = url.includes('/songs') ? { success: true, data: rawSong } : { success: true, data: { results: [rawSong] } };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

const fakeAccountVerifier = {
  verify: async (token: string) =>
    token.startsWith('convex:') ? { userId: token.slice('convex:'.length), source: 'convex' as const } : null
};

const ACCOUNT = 'Bearer convex:user_tally';
const USER = 'user_tally';
const snapshot = { ref: 'saavn:song-1', title: 'Tum Hi Ho', artist: 'Arijit Singh', artwork: 'https://img/song.jpg', duration: 240 };

function build(tally: TasteTally = new MemoryTasteTally()) {
  const services = createServices({
    jwtSecret: 'test-secret',
    fetchImpl: fakeFetch,
    saavnApiUrl: 'https://saavn.test/api',
    gaanaApiUrl: 'https://gaana.test/api',
    accountVerifier: fakeAccountVerifier,
    userStore: new MemoryUserStore(),
    tally
  });
  return { server: createApp({ version: 'test', jwtSecret: 'test-secret', services, rateLimit: false }), tally };
}

async function weightOf(tally: TasteTally): Promise<number> {
  const [row] = await tally.top(USER, 200);
  return row ? currentWeight(row.score, Date.now()) : 0;
}

test('a listen signal with playedAt raises the tally once, even when delivered twice', async () => {
  const { server, tally } = build();
  const playedAt = new Date(Date.now() - 60_000).toISOString();
  const send = () => request(server).post('/api/me/taste/signal').set('Authorization', ACCOUNT)
    .send({ songRef: snapshot.ref, song: snapshot, seconds: 120, playedAt });
  assert.equal((await send()).status, 204);
  const first = await weightOf(tally);
  assert.ok(Math.abs(first - 2) < 0.01, `two minutes heard, got ${first}`);
  const stored = (await tally.top(USER, 1))[0]?.score;
  assert.equal((await send()).status, 204);
  assert.equal((await tally.top(USER, 1))[0]?.score, stored);
});

test('a failing tally never fails the listen signal', async () => {
  const broken: TasteTally = {
    record: () => Promise.reject(new Error('down')),
    bonus: () => Promise.reject(new Error('down')),
    seed: () => Promise.reject(new Error('down')),
    top: () => Promise.reject(new Error('down')),
    clear: () => Promise.reject(new Error('down'))
  };
  const { server } = build(broken);
  const reply = await request(server).post('/api/me/taste/signal').set('Authorization', ACCOUNT)
    .send({ songRef: snapshot.ref, song: snapshot, seconds: 120, playedAt: new Date().toISOString() });
  assert.equal(reply.status, 204);
  assert.equal((await request(server).post('/api/me/liked').set('Authorization', ACCOUNT).send({ songId: 'song-1' })).status, 201);
});

test('a native like adds the bonus once, unlike removes it, and a playlist add adds five', async () => {
  const { server, tally } = build();
  assert.equal((await request(server).post('/api/me/liked').set('Authorization', ACCOUNT).send({ songId: 'song-1' })).status, 201);
  assert.ok(Math.abs((await weightOf(tally)) - 10) < 0.01);
  await request(server).delete('/api/me/liked/song-1').set('Authorization', ACCOUNT);
  assert.equal(await weightOf(tally), 0);

  const playlist = await request(server).post('/api/libraries').set('Authorization', ACCOUNT).send({ name: 'Mine' });
  const added = await request(server).post(`/api/libraries/${playlist.body.data.id}/songs`).set('Authorization', ACCOUNT).send({ songId: 'song-1' });
  assert.ok(added.status < 300);
  assert.ok(Math.abs((await weightOf(tally)) - 5) < 0.01);
});

test('turning learning off clears the tally and the export lists it in whole minutes', async () => {
  const { server, tally } = build();
  await request(server).post('/api/me/taste/signal').set('Authorization', ACCOUNT)
    .send({ songRef: snapshot.ref, song: snapshot, seconds: 200, playedAt: new Date().toISOString() });
  const exported = await request(server).get('/api/me/export').set('Authorization', ACCOUNT);
  assert.equal(exported.status, 200);
  assert.deepEqual(exported.body.data.tally, [{ title: 'Tum Hi Ho', artist: 'Arijit Singh', minutes: 3 }]);

  await request(server).patch('/api/me/settings').set('Authorization', ACCOUNT).send({ personalization: false });
  assert.deepEqual(await tally.top(USER, 200), []);
  await request(server).post('/api/me/taste/signal').set('Authorization', ACCOUNT)
    .send({ songRef: snapshot.ref, song: snapshot, seconds: 200, playedAt: new Date().toISOString() });
  assert.deepEqual(await tally.top(USER, 200), []);
});
