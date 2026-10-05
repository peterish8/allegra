import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp, type AppOptions } from './app.js';
import { BLEND_COPY } from './routes/blends.js';
import { createServices } from './services.js';
import { BLEND_MAX_MEMBERS } from './shared/blendLimits.js';
import { POLICY_VERSION } from './shared/legal.js';
import { MemoryBlendStore } from './user/blendStore.js';
import { MemoryUserStore } from './user/store.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** Every provider call fails: Blends must still work from library data. */
const offline = (): Promise<Response> => Promise.resolve(jsonResponse({ success: false }));

const fakeAccountVerifier = {
  verify: async (token: string) =>
    token.startsWith('convex:') ? { userId: token.slice('convex:'.length), source: 'convex' as const } : null
};

const ASHA = 'Bearer convex:user_asha';
const RAVI = 'Bearer convex:user_ravi';
const MEERA = 'Bearer convex:user_meera';
const consent = { policyVersion: POLICY_VERSION };

function build(options: { enabled?: boolean; rateLimit?: AppOptions['rateLimit'] } = {}) {
  const services = createServices({
    jwtSecret: 'test-secret',
    fetchImpl: offline,
    saavnApiUrl: 'https://saavn.test/api',
    gaanaApiUrl: 'https://gaana.test/api',
    accountVerifier: fakeAccountVerifier,
    userStore: new MemoryUserStore(),
    blends: new MemoryBlendStore()
  });
  return createApp({
    version: 'test',
    jwtSecret: 'test-secret',
    services,
    blendEnabled: options.enabled ?? true,
    allowedOrigin: 'https://allegra.test',
    rateLimit: options.rateLimit ?? false
  });
}

type Server = ReturnType<typeof build>;
const as = (server: Server, auth: string) => ({
  get: (path: string) => request(server).get(path).set('Authorization', auth),
  post: (path: string, body: unknown = {}) => request(server).post(path).set('Authorization', auth).send(body as object),
  patch: (path: string, body: unknown) => request(server).patch(path).set('Authorization', auth).send(body as object)
});

async function createdBlend(server: Server) {
  const reply = await as(server, ASHA).post('/api/blends', { consent });
  assert.equal(reply.status, 201);
  return reply.body.data as { id: string; invite: { code: string; url: string; expiresAt: number } };
}

test('with BLEND_ENABLED off every Blend route answers 404', async () => {
  const server = build({ enabled: false });
  for (const reply of [
    await as(server, ASHA).post('/api/blends', { consent }),
    await as(server, ASHA).get('/api/blends'),
    await as(server, ASHA).get('/api/blends/x'),
    await request(server).get('/api/blend-invites/abcdefghjkmn')
  ]) {
    assert.equal(reply.status, 404);
    assert.equal(reply.body.success, false);
  }
});

test('guests are told to sign in everywhere except the invite preview', async () => {
  const server = build();
  const blend = await createdBlend(server);
  const session = await request(server).post('/api/auth/anon');
  const guest = `Bearer ${String(session.body.data.token)}`;
  for (const reply of [
    await as(server, guest).post('/api/blends', { consent }),
    await as(server, guest).get('/api/blends'),
    await as(server, guest).get(`/api/blends/${blend.id}`),
    await as(server, guest).post(`/api/blend-invites/${blend.invite.code}/accept`, { consent })
  ]) {
    assert.equal(reply.status, 403);
    assert.equal(reply.body.error, BLEND_COPY.signin);
  }
  assert.equal((await request(server).get(`/api/blend-invites/${blend.invite.code}`)).status, 200);
});

test('create needs consent to the current policies and returns the Blend with its invite link', async () => {
  const server = build();
  const stale = await as(server, ASHA).post('/api/blends', { consent: { policyVersion: '2020-01-01' } });
  assert.equal(stale.status, 400);
  assert.equal(stale.body.code, 'consent');
  assert.equal((await as(server, ASHA).post('/api/blends', { consent, name: 'x'.repeat(61) })).status, 400);
  const blend = await createdBlend(server);
  assert.equal(blend.invite.code.length, 12);
  assert.equal(blend.invite.url, `https://allegra.test/blend/join/${blend.invite.code}`);
  const list = await as(server, ASHA).get('/api/blends');
  assert.deepEqual(list.body.data.map((row: { id: string }) => row.id), [blend.id]);
  assert.equal(list.body.data[0].members[0].isYou, true);
  assert.equal(list.body.data[0].members[0].initials.length > 0, true);
});

test('create replays a bounded Idempotency-Key and rejects reuse for a different name', async () => {
  const server = build();
  const key = 'create-blend-request-123';
  const first = await request(server).post('/api/blends').set('Authorization', ASHA).set('Idempotency-Key', key).send({ consent, name: 'Road trip' });
  const replay = await request(server).post('/api/blends').set('Authorization', ASHA).set('Idempotency-Key', key).send({ consent, name: 'Road trip' });
  assert.equal(first.status, 201);
  assert.equal(replay.body.data.id, first.body.data.id);
  assert.equal(replay.body.data.invite.code, first.body.data.invite.code);
  assert.equal((await as(server, ASHA).get('/api/blends')).body.data.length, 1);
  const mismatch = await request(server).post('/api/blends').set('Authorization', ASHA).set('Idempotency-Key', key).send({ consent, name: 'Different' });
  assert.equal(mismatch.status, 400);
});

test('the invite preview shows the inviter; unknown, malformed and expired-by-regeneration codes are the same notfound', async () => {
  const server = build();
  const blend = await createdBlend(server);
  const preview = await request(server).get(`/api/blend-invites/${blend.invite.code}`);
  assert.deepEqual(preview.body.data, { inviterName: 'Listener', memberCount: 1, full: false });
  const regenerated = await as(server, ASHA).post(`/api/blends/${blend.id}/invite`, { regenerate: true });
  assert.notEqual(regenerated.body.data.code, blend.invite.code);
  const replies = await Promise.all(['zzzzzzzzzzzz', 'NOT-A-CODE', blend.invite.code].map((code) => request(server).get(`/api/blend-invites/${code}`)));
  for (const reply of replies) {
    assert.equal(reply.status, 404);
    assert.equal(reply.body.error, BLEND_COPY.notfound);
  }
  const reused = await as(server, ASHA).post(`/api/blends/${blend.id}/invite`);
  assert.equal(reused.body.data.code, regenerated.body.data.code);
});

test('accepting joins; the old link says expired; a full Blend and a stranger are refused', async () => {
  const server = build();
  const blend = await createdBlend(server);
  const joined = await as(server, RAVI).post(`/api/blend-invites/${blend.invite.code}/accept`, { consent });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.data.memberCount, 2);
  // Fill the rest of the seats, whatever the cap is.
  for (let n = 3; n <= BLEND_MAX_MEMBERS; n++) {
    assert.equal((await as(server, `Bearer convex:user_extra${n}`).post(`/api/blend-invites/${blend.invite.code}/accept`, { consent })).status, 200);
  }
  const full = await as(server, MEERA).post(`/api/blend-invites/${blend.invite.code}/accept`, { consent });
  assert.equal(full.status, 409);
  assert.equal(full.body.code, 'full');
  assert.equal(full.body.error, BLEND_COPY.full);

  const fresh = await as(server, ASHA).post(`/api/blends/${blend.id}/invite`, { regenerate: true });
  await as(server, RAVI).post(`/api/blends/${blend.id}/leave`);
  const expired = await as(server, MEERA).post(`/api/blend-invites/${blend.invite.code}/accept`, { consent });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.code, 'expired');
  assert.equal((await as(server, MEERA).post(`/api/blend-invites/${fresh.body.data.code}/accept`, { consent })).status, 200);
  assert.equal((await as(server, MEERA).post('/api/blend-invites/zzzzzzzzzzzz/accept', { consent })).status, 404);
});

test('a non-member asking for a Blend gets notfound, never forbidden', async () => {
  const server = build();
  const blend = await createdBlend(server);
  for (const reply of [
    await as(server, RAVI).get(`/api/blends/${blend.id}`),
    await as(server, RAVI).post(`/api/blends/${blend.id}/invite`),
    await as(server, RAVI).post(`/api/blends/${blend.id}/leave`),
    await as(server, RAVI).patch(`/api/blends/${blend.id}`, { name: 'Mine now' })
  ]) {
    assert.equal(reply.status, 404);
    assert.equal(reply.body.error, BLEND_COPY.notfound);
  }
});

test('a Blend opens with a build even when every provider is down; rename and leave work', async () => {
  const server = build();
  const blend = await createdBlend(server);
  await as(server, RAVI).post(`/api/blend-invites/${blend.invite.code}/accept`, { consent });
  const detail = await as(server, ASHA).get(`/api/blends/${blend.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.state, 'not_enough');
  assert.equal(detail.body.data.members.length, 2);
  assert.equal(detail.body.data.pairs.length, 1);
  assert.match(detail.body.data.builtFor, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(Array.isArray(detail.body.data.stories), true);

  const renamed = await as(server, ASHA).patch(`/api/blends/${blend.id}`, { name: 'Road trip' });
  assert.equal(renamed.body.data.name, 'Road trip');
  assert.equal((await as(server, ASHA).patch(`/api/blends/${blend.id}`, { name: '' })).status, 400);
  assert.deepEqual((await as(server, RAVI).post(`/api/blends/${blend.id}/leave`)).body.data, { left: true });
  assert.equal((await as(server, RAVI).get(`/api/blends/${blend.id}`)).status, 404);
});

test('the invite preview uses the lookup bucket', async () => {
  const server = build({ rateLimit: { lookup: { windowMs: 60_000, limit: 2 } } });
  const blend = await createdBlend(server);
  assert.equal((await request(server).get(`/api/blend-invites/${blend.invite.code}`)).status, 200);
  assert.equal((await request(server).get(`/api/blend-invites/${blend.invite.code}`)).status, 200);
  assert.equal((await request(server).get(`/api/blend-invites/${blend.invite.code}`)).status, 429);
});

test('learning off reaches the Blend; the export lists Blends; deleting the account leaves them', async () => {
  const server = build();
  const blend = await createdBlend(server);
  await as(server, RAVI).post(`/api/blend-invites/${blend.invite.code}/accept`, { consent });
  await as(server, RAVI).patch('/api/me/settings', { personalization: false });
  const detail = await as(server, ASHA).get(`/api/blends/${blend.id}`);
  assert.equal(detail.body.data.members.find((member: { userId: string }) => member.userId === 'user_ravi').learning, false);

  await as(server, RAVI).patch('/api/me/profile', { displayName: 'Ravi K' });
  const exported = await as(server, RAVI).get('/api/me/export');
  assert.equal(exported.body.data.blends.length, 1);
  assert.equal(exported.body.data.blends[0].name, 'Our Blend');
  assert.ok(exported.body.data.blends[0].members.includes('Ravi K'));

  assert.equal((await request(server).delete('/api/me').set('Authorization', ASHA)).status, 204);
  const after = await as(server, RAVI).get('/api/blends');
  assert.equal(after.body.data[0].memberCount, 1);
});

test('a listener in 20 Blends is told about the limit', async () => {
  const server = build();
  for (let n = 0; n < 20; n++) assert.equal((await as(server, ASHA).post('/api/blends', { consent, name: `B${n}` })).status, 201);
  const reply = await as(server, ASHA).post('/api/blends', { consent });
  assert.equal(reply.status, 409);
  assert.equal(reply.body.code, 'limit');
  assert.equal(reply.body.error, BLEND_COPY.limit);
});
