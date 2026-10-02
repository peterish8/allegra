import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';
import { createServices } from './services.js';
import { POLICY_VERSION } from './shared/legal.js';
import { MemoryUserStore } from './user/store.js';

const rawSong = {
  id: 'song-1',
  name: 'Tum Hi Ho',
  primaryArtists: 'Arijit Singh, Mithoon',
  language: 'hindi',
  duration: 240,
  image: [{ quality: '500x500', url: 'https://img/song.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.includes('/songs/') || url.includes('/songs?')) return Promise.resolve(jsonResponse({ success: true, data: rawSong }));
  return Promise.resolve(jsonResponse({ success: true, data: { results: [rawSong] } }));
}

/** Stands in for Convex Auth: `convex:<userId>` is a signed-in account. */
const fakeAccountVerifier = {
  verify: async (token: string) =>
    token.startsWith('convex:') ? { userId: token.slice('convex:'.length), source: 'convex' as const } : null
};

function build() {
  const store = new MemoryUserStore();
  const services = createServices({
    jwtSecret: 'test-secret',
    fetchImpl: fakeFetch,
    saavnApiUrl: 'https://saavn.test/api',
    gaanaApiUrl: 'https://gaana.test/api',
    accountVerifier: fakeAccountVerifier,
    userStore: store
  });
  return { server: createApp({ version: 'test', jwtSecret: 'test-secret', services, rateLimit: false }), store };
}

const ACCOUNT = 'Bearer convex:user_asha';

test('agreeing to the policies is recorded with the version and the server time', async () => {
  const { server } = build();
  const before = Date.now();

  const stale = await request(server).post('/api/me/consent').set('Authorization', ACCOUNT).send({ policyVersion: '2020-01-01' });
  assert.equal(stale.status, 400);
  assert.equal((await request(server).get('/api/auth/me').set('Authorization', ACCOUNT)).body.data.consent, undefined);

  const agreed = await request(server).post('/api/me/consent').set('Authorization', ACCOUNT).send({ policyVersion: POLICY_VERSION });
  assert.equal(agreed.status, 200);
  assert.equal(agreed.body.data.consent.policyVersion, POLICY_VERSION);
  assert.ok(Date.parse(agreed.body.data.consent.at) >= before);

  const me = await request(server).get('/api/auth/me').set('Authorization', ACCOUNT);
  assert.deepEqual(me.body.data.consent, agreed.body.data.consent);

  assert.equal((await request(server).post('/api/me/consent').send({ policyVersion: POLICY_VERSION })).status, 401);
});

test('the export holds the profile, the library and the share links', async () => {
  const { server } = build();
  await request(server).post('/api/me/consent').set('Authorization', ACCOUNT).send({ policyVersion: POLICY_VERSION });
  await request(server).post('/api/me/liked').set('Authorization', ACCOUNT).send({ songId: 'song-1' });
  const playlist = await request(server).post('/api/libraries').set('Authorization', ACCOUNT).send({ name: 'Late night' });
  const shared = await request(server).post(`/api/libraries/${playlist.body.data.id}/share`).set('Authorization', ACCOUNT);

  const exported = await request(server).get('/api/me/export').set('Authorization', ACCOUNT);
  assert.equal(exported.status, 200);
  const data = exported.body.data;
  assert.equal(data.profile.userId, 'user_asha');
  assert.equal(data.profile.consent.policyVersion, POLICY_VERSION);
  assert.equal(data.library.complete, true);
  assert.equal(data.complete, true);
  assert.deepEqual(data.library.changes.map((change: { kind: string }) => change.kind).sort(), ['like', 'playlist']);
  assert.deepEqual(data.shares.map((share: { code: string }) => share.code), [shared.body.data.code]);
  assert.deepEqual(data.devices, []);

  assert.equal((await request(server).get('/api/me/export')).status, 401);
});

test('deleting an account erases the profile, the library and the share links, and can be repeated', async () => {
  const { server, store } = build();
  await request(server).post('/api/me/liked').set('Authorization', ACCOUNT).send({ songId: 'song-1' });
  const playlist = await request(server).post('/api/libraries').set('Authorization', ACCOUNT).send({ name: 'Late night' });
  const shared = await request(server).post(`/api/libraries/${playlist.body.data.id}/share`).set('Authorization', ACCOUNT);
  const code = shared.body.data.code as string;
  assert.equal((await request(server).get(`/api/shared/${code}`)).status, 200);

  assert.equal((await request(server).delete('/api/me')).status, 401);
  assert.equal((await request(server).delete('/api/me').set('Authorization', ACCOUNT)).status, 204);

  assert.equal(await store.get('user_asha'), null);
  assert.equal(await store.getShare(code), null);
  assert.equal((await request(server).get(`/api/shared/${code}`)).status, 404);

  // The same person signing in again starts empty: nothing of the old library comes back.
  const again = await request(server).get('/api/libraries').set('Authorization', ACCOUNT);
  assert.deepEqual(again.body.data, []);
  assert.deepEqual((await request(server).get('/api/me/liked').set('Authorization', ACCOUNT)).body.data, []);

  assert.equal((await request(server).delete('/api/me').set('Authorization', ACCOUNT)).status, 204);
});

test('a guest can erase their session data too', async () => {
  const { server, store } = build();
  const guest = (await request(server).post('/api/auth/anon')).body.data as { token: string; userId: string };
  assert.ok(await store.get(guest.userId));

  assert.equal((await request(server).delete('/api/me').set('Authorization', `Bearer ${guest.token}`)).status, 204);
  assert.equal(await store.get(guest.userId), null);
  // The token no longer belongs to anyone.
  assert.equal((await request(server).get('/api/auth/me').set('Authorization', `Bearer ${guest.token}`)).status, 401);
});

test('anyone with the link can report a shared playlist; a dead link cannot be reported', async () => {
  const { server, store } = build();
  const playlist = await request(server).post('/api/libraries').set('Authorization', ACCOUNT).send({ name: 'Late night' });
  const code = (await request(server).post(`/api/libraries/${playlist.body.data.id}/share`).set('Authorization', ACCOUNT)).body.data.code as string;

  const filed = await request(server).post(`/api/shared/${code}/report`).send({ reason: 'copyright', details: '  The cover is my photograph.  ', contact: 'me@example.com' });
  assert.equal(filed.status, 201);
  assert.deepEqual(filed.body.data, { received: true });
  assert.deepEqual(store.reports, [{ code, reason: 'copyright', details: 'The cover is my photograph.', contact: 'me@example.com' }]);

  assert.equal((await request(server).post(`/api/shared/${code}/report`).send({ reason: 'because' })).status, 400);
  assert.equal((await request(server).post('/api/shared/zzzzzzzz/report').send({ reason: 'abuse' })).status, 404);
  assert.equal(store.reports.length, 1);
});

test('switching personalisation off erases what was learned and stops recording plays', async () => {
  const { server } = build();
  await request(server).post('/api/me/recently-played').set('Authorization', ACCOUNT).send({ songId: 'song-1', playDuration: 200 });
  const learned = await request(server).get('/api/me/taste').set('Authorization', ACCOUNT);
  assert.ok(learned.body.data.signals > 0);
  assert.equal((await request(server).get('/api/me/recently-played').set('Authorization', ACCOUNT)).body.data.length, 1);

  const off = await request(server).patch('/api/me/settings').set('Authorization', ACCOUNT).send({ personalization: false });
  assert.equal(off.body.data.personalization, false);
  assert.equal((await request(server).get('/api/me/taste').set('Authorization', ACCOUNT)).body.data.signals, 0);
  assert.deepEqual((await request(server).get('/api/me/recently-played').set('Authorization', ACCOUNT)).body.data, []);

  // Plays, listening time and likes still work, but teach nothing and leave no history.
  assert.equal((await request(server).post('/api/me/recently-played').set('Authorization', ACCOUNT).send({ songId: 'song-1', playDuration: 200 })).status, 201);
  assert.equal((await request(server).post('/api/me/taste/signal').set('Authorization', ACCOUNT).send({ songId: 'song-1', seconds: 200 })).status, 204);
  assert.equal((await request(server).post('/api/me/liked').set('Authorization', ACCOUNT).send({ songId: 'song-1' })).status, 201);
  assert.equal((await request(server).get('/api/me/taste').set('Authorization', ACCOUNT)).body.data.signals, 0);
  assert.deepEqual((await request(server).get('/api/me/recently-played').set('Authorization', ACCOUNT)).body.data, []);
  assert.equal((await request(server).get('/api/me/liked').set('Authorization', ACCOUNT)).body.data.length, 1);

  // Back on: listening is learned from again.
  await request(server).patch('/api/me/settings').set('Authorization', ACCOUNT).send({ personalization: true });
  await request(server).post('/api/me/recently-played').set('Authorization', ACCOUNT).send({ songId: 'song-1', playDuration: 200 });
  assert.ok((await request(server).get('/api/me/taste').set('Authorization', ACCOUNT)).body.data.signals > 0);
});
