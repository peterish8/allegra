import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';
import { MemoryCacheStore } from './lib/cache.js';
import { createServices } from './services.js';
import { TopChartService } from './services/topChart.js';
import type { ChartFeed } from './providers/appleRss.js';
import type { UnifiedSong } from './types.js';

function song(id: string, title: string): UnifiedSong {
  return { id, title, artist: 'Karan Aujla', artwork: '', streamUrl: `/api/stream/${id}`, duration: 200, hasLyrics: false, playCount: 0, source: 'Saavn' };
}

const TITLES = ['Ashke', 'Antidote', 'Straight Up', 'Softly', 'Wavy'];

function app(feed: ChartFeed | null) {
  const storefronts: string[] = [];
  const topChart = new TopChartService(
    { mostPlayedSongs: async (storefront) => { storefronts.push(storefront); return feed; } },
    { search: async (query: string) => ({ results: TITLES.filter((title) => query.startsWith(title)).map((title) => song(title.toLowerCase(), title)), source: 'Saavn' as const }) },
    new MemoryCacheStore()
  );
  const services = { ...createServices({ jwtSecret: 'test-secret' }), topChart };
  return { server: createApp({ version: 'test', jwtSecret: 'test-secret', services, rateLimit: false }), storefronts };
}

test('GET /api/charts/top answers playable songs in the envelope and is edge cacheable', async () => {
  const { server, storefronts } = app({ updatedAt: '2026-10-17T06:43:33.000Z', entries: TITLES.map((title) => ({ title, artist: 'Karan Aujla' })) });
  const response = await request(server).get('/api/charts/top');
  assert.equal(response.status, 200);
  assert.deepEqual(storefronts, ['IN']);
  assert.equal(response.headers['cache-control'], 'public, max-age=300, s-maxage=3600, stale-while-revalidate=21600');
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.available, true);
  assert.deepEqual(response.body.data.songs.map((item: UnifiedSong) => item.id), ['ashke', 'antidote', 'straight up', 'softly', 'wavy']);
  // Listeners never see where the chart came from.
  assert.equal(JSON.stringify(response.body).toLowerCase().includes('apple'), false);
});

test('a chart that cannot be built is an empty success that is not cached; a bad country is a 400', async () => {
  const { server, storefronts } = app(null);
  const unavailable = await request(server).get('/api/charts/top?country=in');
  assert.equal(unavailable.status, 200);
  assert.equal(unavailable.headers['cache-control'], 'no-store');
  assert.deepEqual(unavailable.body, { success: true, data: { storefront: 'IN', available: false, updatedAt: null, songs: [] } });

  const invalid = await request(server).get('/api/charts/top?country=../../example');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.success, false);
  assert.deepEqual(storefronts, ['IN']);
});
