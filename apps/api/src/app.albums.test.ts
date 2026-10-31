import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const asset = (url: string) => [{ quality: '500x500', url }];
const track = (id: string, name: string, artists: string[], albumId = '81429928', albumName = 'Baththa (Original Motion Picture Soundtrack)') => ({
  id, name, duration: 200, language: 'tamil',
  album: { id: albumId, name: albumName },
  artists: { primary: artists.map((artist) => ({ name: artist })) },
  image: asset('https://img/c.jpg'),
  downloadUrl: [{ quality: '320kbps', url: `https://cdn.example/${id}.mp4` }]
});

/** The shape the live Saavn API returned on 2026-10-11 for this album (trimmed to what we read). */
const ALBUM = {
  id: '81429928', name: 'Baththa (Original Motion Picture Soundtrack)', year: '2026', language: 'tamil', songCount: 4,
  artists: { primary: [{ name: 'Sai Abhyankkar' }] }, image: asset('https://img/album.jpg'),
  songs: [
    track('jBo2jQ-u', 'Magale', ['Sai Abhyankkar', 'Harini']),
    track('bhasn3eS', 'Ooroda Oththa Don', ['Sai Abhyankkar', 'Vangal Pulla Vicky']),
    { ...track('nostream', 'No Stream', ['Sai Abhyankkar']), downloadUrl: [] },
    track('OZhkDTdR', 'Baththa Lacrimosa', ['Sai Abhyankkar', 'The Indian Choral Ensemble'])
  ]
};

function fakeSaavn(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input));
  if (!url.href.startsWith('https://saavn.test/api/')) return Promise.resolve(json({ success: false }, 404));
  const path = url.pathname.replace('/api/', '');
  if (path === 'albums') {
    return Promise.resolve(url.searchParams.get('id') === '81429928' ? json({ success: true, data: ALBUM }) : json({ success: false, message: 'not found' }, 404));
  }
  if (path === 'search/albums') {
    return Promise.resolve(json({ success: true, data: { results: [
      { id: '81429928', name: 'Baththa (Original Motion Picture Soundtrack)', year: '2026', language: 'tamil', artists: { primary: [{ name: 'Sai Abhyankkar' }] }, image: asset('https://img/album.jpg') },
      { id: '80304913', name: 'Magale (From &quot;Baththa&quot;)', year: 2026, artists: { primary: [{ name: 'Sai Abhyankkar' }, { name: 'Harini' }] }, image: [] },
      { name: 'No id' }
    ] } }));
  }
  if (path === 'search/songs') {
    return Promise.resolve(json({ success: true, data: { results: [track('OZhkDTdR', 'Baththa Lacrimosa', ['Sai Abhyankkar'])] } }));
  }
  return Promise.resolve(json({ success: false }, 404));
}

const app = () => createApp({
  version: 'test', jwtSecret: 'test-secret', saavnApiUrl: 'https://saavn.test/api', gaanaApiUrl: 'https://gaana.test/api',
  fetchImpl: fakeSaavn as typeof fetch, rateLimit: false
});

test('a searched song carries its album id', async () => {
  const reply = await request(app()).get('/api/search?q=baththa');
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.equal(reply.body.data.results[0].albumId, '81429928');
});

test('GET /api/albums/:id returns the whole album in track order, playable rows only', async () => {
  const reply = await request(app()).get('/api/albums/81429928');
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  const album = reply.body.data;
  assert.equal(album.name, 'Baththa (Original Motion Picture Soundtrack)');
  assert.equal(album.artist, 'Sai Abhyankkar');
  assert.equal(album.year, '2026');
  assert.equal(album.songCount, 4, 'the catalog count');
  assert.deepEqual(album.songs.map((song: { id: string }) => song.id), ['jBo2jQ-u', 'bhasn3eS', 'OZhkDTdR']);
  assert.ok(album.songs.every((song: { streamUrl: string; albumId: string }) => song.streamUrl.startsWith('/api/stream/') && song.albumId === '81429928'));
});

test('GET /api/search/albums returns albums with ids and decoded names', async () => {
  const reply = await request(app()).get('/api/search/albums?q=baththa');
  assert.equal(reply.status, 200);
  const results = reply.body.data.results as { id: string; name: string; artist: string; artwork: string | null; year: string | null }[];
  assert.deepEqual(results.map((album) => album.id), ['81429928', '80304913'], 'a row with no id is dropped');
  assert.equal(results[1]?.name, 'Magale (From "Baththa")');
  assert.equal(results[1]?.artist, 'Sai Abhyankkar, Harini');
  assert.equal(results[1]?.artwork, null);
});

test('a bad or unknown album id is refused in the standard envelope', async () => {
  const bad = await request(app()).get('/api/albums/..%2F..%2Fsecret');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.success, false);
  const missing = await request(app()).get('/api/albums/999');
  assert.ok(missing.status === 404 || missing.status === 502, `status ${missing.status}`);
  assert.equal(missing.body.success, false);
  assert.equal(typeof missing.body.error, 'string');
});
