import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';

const app = () => createApp({
  version: 'test', jwtSecret: 'test-secret', saavnApiUrl: 'https://saavn.test/api', gaanaApiUrl: 'https://gaana.test/api',
  fetchImpl: (async () => { throw new Error('no network in this test'); }) as typeof fetch,
  rateLimit: {
    djTurn: { windowMs: 60_000, limit: 1 },
    djTranscribe: { windowMs: 60_000, limit: 1 },
    djSpeak: { windowMs: 60_000, limit: 1 }
  }
});

test('using up the DJ turn bucket does not block speak or transcribe', async () => {
  const server = app();
  // An empty body fails validation (400), but still counts against the turn bucket.
  assert.equal((await request(server).post('/api/ai/dj/turn').send({})).status, 400);
  assert.equal((await request(server).post('/api/ai/dj/turn').send({})).status, 429);

  const speak = await request(server).post('/api/ai/dj/speak').send({});
  assert.equal(speak.status, 400);
  assert.equal(speak.body.success, false);
  assert.equal((await request(server).post('/api/ai/dj/transcribe').send({})).status, 400);
});

test('the DJ turn bucket returns the standard 429 once used up', async () => {
  const server = app();
  await request(server).post('/api/ai/dj/turn').send({});
  const limited = await request(server).post('/api/ai/dj/turn').send({});
  assert.equal(limited.status, 429);
  assert.equal(limited.body.success, false);
  assert.equal(limited.body.data, null);
  assert.equal(typeof limited.body.error, 'string');
});

test('speak and transcribe each have their own bucket', async () => {
  const server = app();
  await request(server).post('/api/ai/dj/speak').send({});
  assert.equal((await request(server).post('/api/ai/dj/speak').send({})).status, 429);
  assert.equal((await request(server).post('/api/ai/dj/transcribe').send({})).status, 400);
  assert.equal((await request(server).post('/api/ai/dj/transcribe').send({})).status, 429);
});
