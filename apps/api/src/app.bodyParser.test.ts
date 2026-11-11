import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';

test('API rejects compressed request bodies at every JSON and OAuth form parser', async () => {
  const app = createApp({ version: 'test', rateLimit: false });
  const jsonBody = gzipSync(Buffer.from(JSON.stringify({ redirect_uris: ['https://client.example/callback'] })));
  for (const path of ['/api/ai/dj/transcribe', '/api/lyrics/sync', '/api/lyrics/paste', '/api/oauth/register']) {
    const response = await request(app).post(path).set('Content-Type', 'application/json').set('Content-Encoding', 'gzip').send(jsonBody);
    assert.equal(response.status, 415, `${path} must reject compressed JSON`);
  }

  const formBody = gzipSync(Buffer.from('grant_type=authorization_code&code=unused'));
  const token = await request(app).post('/api/oauth/token')
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .set('Content-Encoding', 'gzip')
    .send(formBody);
  assert.equal(token.status, 415, 'the route-specific OAuth urlencoded parser must reject compression');
});

test('small uncompressed OAuth registration requests remain compatible', async () => {
  const response = await request(createApp({ version: 'test', rateLimit: false }))
    .post('/api/oauth/register')
    .send({ redirect_uris: ['https://client.example/callback'], client_name: 'Fixture client' });
  // RFC 7591 registration keeps its documented 201 shape (an OAuth route, not a { success, data } route).
  assert.equal(response.status, 201);
  assert.equal(response.body.client_name, 'Fixture client');
  assert.deepEqual(response.body.redirect_uris, ['https://client.example/callback']);
});
