import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { MemoryCacheStore } from './lib/cache.js';
import { songIdentity } from './lib/normalize.js';
import { createServices } from './services.js';
import { parseLightfmModel } from './services/lightfm.js';
import type { PreviewInputs, PreviewProfile, PreviewTrack, RecommendationPreviewSource } from './services/recommendationPreview.js';
import { previewInput } from './services/recommendationPreview.js';
import { RecommendationService, type RecommendationCatalog } from './services/recommendations.js';
import type { UnifiedSong } from './types.js';

function track(id: string, title: string, artist: string, language = 'tamil'): PreviewTrack {
  return { id, title, artist, language, duration: 200, popularity: 1000 };
}

function song(id: string, title: string, artist: string, language = 'tamil', playCount = 1000): UnifiedSong {
  return { id, title, artist, language, duration: 200, playCount, hasLyrics: false, source: 'Saavn', artwork: '', streamUrl: `/api/stream/${id}` };
}

const seeds = [track('s1', 'Seed One', 'Anirudh'), track('s2', 'Seed Two', 'Anirudh'), track('s3', 'Seed Three', 'Sid Sriram')];
const profile: PreviewProfile = {
  id: 'p1', title: 'Tamil Hip Hop', language: 'tamil', genre: 'hip hop',
  seeds, exclude: [...seeds, track('x1', 'Already There', 'Arivu')], hiddenCount: 1
};
const other: PreviewProfile = { ...profile, id: 'p2', title: 'No vector' };

// Suggestions for the first seed, in the current ranker's order: a Hindi song the language
// filter drops, another release of a visible track, three songs by one lead artist.
const suggestions = [
  song('a1', 'Alpha', 'Hiphop Tamizha'),
  song('a2', 'Bravo', 'Hiphop Tamizha'),
  song('a3', 'Charlie', 'Hiphop Tamizha'),
  song('h1', 'Hindi Hit', 'Arijit Singh', 'hindi'),
  song('x2', 'Already There', 'Arivu'),
  song('d1', 'Delta', 'Dhee'),
  song('e1', 'Echo', 'Santhosh Narayanan'),
  song('f1', 'Foxtrot', 'Yuvan Shankar Raja')
];

const catalog: RecommendationCatalog = {
  getSuggestions: async (id) => (id === 's1' ? suggestions : []),
  getArtist: async () => ({ songs: [] }),
  search: async () => ({ results: [] })
};

const key = (title: string, artist: string): string => songIdentity(song('', title, artist));
// The profile's taste prefers Foxtrot, then Echo, then Bravo over Alpha. Delta has no vector.
const model = parseLightfmModel({
  schemaVersion: 1, dimensions: 2, seed: 7, collectedAt: '2026-11-11T00:00:00.000Z',
  profiles: { p1: { bias: 0, vector: [1, 0] } },
  recordings: {
    [key('Alpha', 'Hiphop Tamizha')]: { bias: 0, vector: [0.1, 0] },
    [key('Bravo', 'Hiphop Tamizha')]: { bias: 0, vector: [0.3, 0] },
    [key('Charlie', 'Hiphop Tamizha')]: { bias: 0, vector: [0.2, 0] },
    [key('Echo', 'Santhosh Narayanan')]: { bias: 0, vector: [1, 0] },
    [key('Foxtrot', 'Yuvan Shankar Raja')]: { bias: 0, vector: [2, 0] }
  }
});

function app(inputs: PreviewInputs | (() => Promise<PreviewInputs>)) {
  const services = createServices({ jwtSecret: 'test-secret', fetchImpl: () => Promise.reject(new Error('offline')), saavnApiUrl: 'https://saavn.test/api', gaanaApiUrl: 'https://gaana.test/api' });
  const recommendations = new RecommendationService(catalog, new MemoryCacheStore());
  const source: RecommendationPreviewSource = { load: typeof inputs === 'function' ? inputs : async () => inputs };
  return {
    server: createApp({ version: 'test', jwtSecret: 'test-secret', services: { ...services, recommendations }, rateLimit: false, recommendationPreview: source }),
    recommendations
  };
}

const titles = (songs: readonly { title: string }[]): string[] => songs.map((row) => row.title);

test('the preview ranks the same playable candidates both ways, with the language filter, exclusions and artist cap', async () => {
  const { server, recommendations } = app({ profiles: [profile, other], model: { status: 'ready', model } });
  const response = await request(server).get('/api/recommendations/preview?profile=p1');
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  const data = response.body.data;

  // The left column is exactly what the Quick Picks service returns for this input.
  const input = previewInput(profile);
  const today = await recommendations.recommend(input.context, input.excludeIds, input.excludeSongs);
  assert.deepEqual(titles(data.current), titles(today!.songs));
  assert.deepEqual(titles(data.current), ['Alpha', 'Bravo', 'Delta', 'Echo', 'Foxtrot']);

  assert.equal(data.model.status, 'ready');
  assert.equal(data.model.seed, 7);
  // Reciprocal ranks with k = 10 over the six candidates; Charlie is the third Hiphop Tamizha song and is capped.
  assert.deepEqual(titles(data.lightfm), ['Bravo', 'Alpha', 'Foxtrot', 'Echo', 'Delta']);
  const candidates = new Set(titles(data.candidates));
  for (const row of [...data.current, ...data.lightfm]) {
    assert.ok(candidates.has(row.title));
    assert.equal(row.language, 'tamil');
    assert.match(row.streamUrl, /^\/api\/stream\//);
    assert.notEqual(row.title, 'Already There');
  }
  for (const column of [data.current, data.lightfm]) {
    assert.ok(column.filter((row: UnifiedSong) => row.artist === 'Hiphop Tamizha').length <= 2);
  }
  assert.deepEqual(data.coverage, { candidates: 6, withVectors: 5 });
  assert.equal(data.candidates.find((row: { title: string }) => row.title === 'Delta').score, null);
  assert.equal(data.candidates.find((row: { title: string }) => row.title === 'Foxtrot').lightfmRank, 3);
  assert.deepEqual(data.profile, { id: 'p1', title: 'Tamil Hip Hop', language: 'tamil', genre: 'hip hop', seeds: 3, hidden: 1 });
});

test('without a usable model or a profile vector the LightFM column falls back to today’s order', async () => {
  const unavailable = app({ profiles: [profile], model: { status: 'unavailable', detail: 'Unsupported model schema 2.' } });
  const missing = await request(unavailable.server).get('/api/recommendations/preview?profile=p1');
  assert.equal(missing.status, 200);
  assert.equal(missing.body.data.model.status, 'unavailable');
  assert.equal(missing.body.data.model.detail, 'Unsupported model schema 2.');
  assert.deepEqual(titles(missing.body.data.lightfm), titles(missing.body.data.current));
  assert.equal(missing.body.data.coverage.withVectors, 0);

  const noVector = app({ profiles: [other], model: { status: 'ready', model } });
  const fallback = await request(noVector.server).get('/api/recommendations/preview?profile=p2');
  assert.equal(fallback.body.data.model.status, 'no-profile-vector');
  assert.deepEqual(titles(fallback.body.data.lightfm), titles(fallback.body.data.current));
});

test('the preview lists its profiles and answers bad requests and missing inputs plainly', async () => {
  const { server } = app({ profiles: [profile, other], model: { status: 'ready', model } });
  const list = await request(server).get('/api/recommendations/preview/profiles');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data.profiles.map((row: { id: string; hasVector: boolean }) => [row.id, row.hasVector]), [['p1', true], ['p2', false]]);
  assert.equal((await request(server).get('/api/recommendations/preview')).status, 400);
  assert.equal((await request(server).get('/api/recommendations/preview?profile=nope')).status, 404);

  const broken = app(() => Promise.reject(new Error('ENOENT')));
  const unavailable = await request(broken.server).get('/api/recommendations/preview?profile=p1');
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.success, false);
});

test('both public recommendation URLs still return the shared Quick Picks shape', async () => {
  const raw = (id: string, name: string, artists: string) => ({
    id, name, primaryArtists: artists, duration: 200, language: 'tamil', playCount: 100,
    image: [{ quality: '500x500', url: `https://img.example/${id}.jpg` }],
    downloadUrl: [{ quality: '320kbps', url: `https://cdn.example/${id}.mp4` }]
  });
  const seed = raw('seed-1', 'Seed Song', 'Anirudh');
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const body = url.includes('/suggestions')
      ? { success: true, data: [raw('next-1', 'Next One', 'Dhee'), raw('next-2', 'Next Two', 'Sid Sriram')] }
      : url.includes('/songs') ? { success: true, data: [seed] } : { success: true, data: { results: [] } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const services = createServices({ jwtSecret: 'test-secret', fetchImpl, saavnApiUrl: 'https://saavn.test/api', gaanaApiUrl: 'https://gaana.test/api' });
  const server = createApp({ version: 'test', jwtSecret: 'test-secret', services, rateLimit: false });
  const token = (await request(server).post('/api/auth/anon')).body.data.token as string;
  const current = await request(server).get('/api/recommendations?songId=seed-1').set('Authorization', `Bearer ${token}`);
  const alias = await request(server).get('/api/ai/recommendations?songId=seed-1').set('Authorization', `Bearer ${token}`);
  assert.equal(current.status, 200);
  assert.deepEqual(Object.keys(current.body.data).sort(), ['provider', 'reasoning', 'songs']);
  assert.deepEqual(titles(current.body.data.songs), ['Next One', 'Next Two']);
  assert.equal(current.body.data.reasoning, "Because you've been playing Seed Song");
  assert.deepEqual(alias.body, current.body);
});

test('the preview route is absent unless configured, and never mounts or configures in production', async () => {
  const services = createServices({ jwtSecret: 'test-secret', fetchImpl: () => Promise.reject(new Error('offline')), saavnApiUrl: 'https://saavn.test/api', gaanaApiUrl: 'https://gaana.test/api' });
  const plain = createApp({ version: 'test', jwtSecret: 'test-secret', services, rateLimit: false });
  assert.equal((await request(plain).get('/api/recommendations/preview/profiles')).status, 404);

  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const source: RecommendationPreviewSource = { load: async () => ({ profiles: [profile], model: { status: 'ready', model } }) };
    const production = createApp({ version: 'test', jwtSecret: 'test-secret', services, rateLimit: false, recommendationPreview: source });
    assert.equal((await request(production).get('/api/recommendations/preview/profiles')).status, 404);
  } finally {
    process.env.NODE_ENV = previous;
  }

  const config = loadConfig({
    NODE_ENV: 'production', JWT_SECRET: 'test-only-secret-value', ALLEGRA_ORIGIN: 'https://app.example',
    SAAVN_API_URL: 'https://saavn.example/api', RECOMMENDATIONS_PREVIEW_DIR: 'output/recommendations/enriched'
  });
  assert.equal(config.recommendationPreviewDir, undefined);
  assert.equal(loadConfig({ RECOMMENDATIONS_PREVIEW_DIR: 'output/x' }).recommendationPreviewDir, 'output/x');
});
