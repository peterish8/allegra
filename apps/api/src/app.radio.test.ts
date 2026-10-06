import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';

const raw = (id: string, name: string, artist: string, playCount = 0) => ({
  id,
  name,
  primaryArtists: artist,
  language: 'hindi',
  duration: 200,
  playCount,
  image: [{ quality: '500x500', url: 'https://img/song.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
});

const ok = (data: unknown): Response => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input));
  const path = url.pathname.replace(/^\/api\//, '');
  if (path === 'search/songs') {
    // Provider relevance order: the exact title first, a more-played loose match after it.
    return Promise.resolve(ok({ results: [raw('kes', 'Kesariya', 'Arijit Singh', 10), raw('ach', 'Achyutam Keshavam', 'Vikram', 900)] }));
  }
  if (path === 'songs/seed/suggestions') return Promise.resolve(ok([raw('sim1', 'Tum Hi Ho', 'Arijit Singh'), raw('sim2', 'Raabta', 'Pritam')]));
  if (path === 'songs/seed') return Promise.resolve(ok([raw('seed', 'Kesariya', 'Arijit Singh')]));
  if (path === 'search/artists') return Promise.resolve(ok({ results: [{ id: 'a1', name: url.searchParams.get('query') }] }));
  if (path === 'artists') return Promise.resolve(ok({ id: 'a1', name: 'Arijit Singh', topSongs: [raw('art1', 'Channa Mereya', 'Arijit Singh')] }));
  return Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 404 }));
}

const app = () => createApp({ version: 'test', jwtSecret: 'test-secret', saavnApiUrl: 'https://saavn.test/api', gaanaApiUrl: 'https://gaana.test/api', fetchImpl: fakeFetch, rateLimit: false });

test('suggest keeps the provider’s relevance order and lets the edge cache it', async () => {
  const reply = await request(app()).get('/api/search/suggest?q=kes');
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.data.results.map((song: { id: string }) => song.id), ['kes', 'ach']);
  assert.match(String(reply.headers['cache-control']), /s-maxage=600/);
});

test('full search no longer reorders by play count', async () => {
  const reply = await request(app()).get('/api/search?q=kes');
  assert.deepEqual(reply.body.data.results.map((song: { id: string }) => song.id), ['kes', 'ach']);
  assert.equal(reply.headers['cache-control'], 'no-store');
});

test('suggest needs a query', async () => {
  assert.equal((await request(app()).get('/api/search/suggest')).status, 400);
});

test('a guest radio is similar songs and the seed artist, never cached by the edge', async () => {
  const reply = await request(app()).get('/api/radio/seed');
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.data.candidates.map((candidate: { song: { id: string }; source: string }) => [candidate.song.id, candidate.source]), [
    ['sim1', 'similar'],
    ['sim2', 'similar'],
    ['art1', 'artist']
  ]);
  assert.equal(reply.body.data.taste, null);
  assert.equal(reply.headers['cache-control'], 'no-store');
});

test('a listener’s skips and late finishes teach taste by how the song ended', async () => {
  const server = app();
  const token = String((await request(server).post('/api/auth/anon')).body.data.token);
  const signal = (songId: string, seconds: number, exit: string, exitPositionSec: number) => request(server)
    .post('/api/me/taste/signal').set('Authorization', `Bearer ${token}`)
    .send({ songRef: `saavn:${songId}`, song: { ref: `saavn:${songId}`, title: songId, artist: songId === 'early' ? 'Skipped Artist' : 'Finished Artist', artwork: '', duration: 200 }, seconds, exit, exitPositionSec });

  assert.equal((await signal('late', 190, 'skipped', 190)).status, 204);
  assert.equal((await signal('early', 20, 'skipped', 20)).status, 204);

  const taste = await request(server).get('/api/me/taste').set('Authorization', `Bearer ${token}`);
  const scores = new Map((taste.body.data.topArtists as { name: string; score: number }[]).map((artist) => [artist.name, artist.score]));
  assert.ok((scores.get('Finished Artist') ?? 0) > 0);
  assert.ok((scores.get('Skipped Artist') ?? 0) <= 0);
});
