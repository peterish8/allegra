import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../lib/cache.js';
import type { ChartEntry, ChartFeed } from '../providers/appleRss.js';
import type { UnifiedSong } from '../types.js';
import { TopChartService } from './topChart.js';

function song(id: string, title: string, artist: string): UnifiedSong {
  return { id, title, artist, artwork: '', streamUrl: `/api/stream/${id}`, duration: 200, hasLyrics: false, playCount: 0, source: 'Saavn' };
}

const ENTRIES: ChartEntry[] = [
  { title: 'Ashke', artist: 'Karan Aujla & MXRCI' },
  { title: 'Not In The Catalog', artist: 'Nobody' },
  { title: 'One Sun One Moon (From "Jailer 2")', artist: 'Anirudh Ravichander, Super Subu' },
  { title: 'Radhimaa (feat. Sai Smriti) [From "Think Indie"]', artist: 'Sai Abhyankkar, Nargis Teji' },
  { title: 'Antidote', artist: 'Karan Aujla' },
  { title: 'Straight Up', artist: 'Karan Aujla & MXRCI' },
  { title: 'One Name', artist: 'Anirudh Ravichander & Super Subu' }
];

const CATALOG: Record<string, UnifiedSong[]> = {
  'Ashke Karan Aujla': [song('cover', 'Ashke (Cover)', 'Someone Else'), song('ashke', 'Ashke', 'Karan Aujla, MXRCI')],
  'One Sun One Moon (From "Jailer 2") Anirudh Ravichander': [song('osom', 'One Sun One Moon (From "Jailer 2")', 'Anirudh Ravichander, Super Subu')],
  'Radhimaa (feat. Sai Smriti) [From "Think Indie"] Sai Abhyankkar': [song('radhimaa', 'Radhimaa (From "Think Indie")', 'Sai Abhyankkar, Nargis Teji, Asma Teji')],
  'Antidote Karan Aujla': [song('antidote', 'Antidote', 'Karan Aujla')],
  'Straight Up Karan Aujla': [song('straight', 'Straight Up', 'Karan Aujla, MXRCI')],
  'One Name Anirudh Ravichander': [song('one-name', 'One Name', 'Anirudh Ravichander, Super Subu')]
};

function setup(feed: ChartFeed | null, catalog: Record<string, UnifiedSong[]> = CATALOG) {
  const queries: string[] = [];
  let feeds = 0;
  const service = new TopChartService(
    { mostPlayedSongs: async () => { feeds += 1; return feed; } },
    { search: async (query: string) => { queries.push(query); return { results: catalog[query] ?? [], source: 'Saavn' as const }; } },
    new MemoryCacheStore()
  );
  return { service, queries, get feeds() { return feeds; } };
}

test('chart entries become playable catalog songs in chart order, unmatched ones skipped', async () => {
  const { service } = setup({ updatedAt: '2026-10-17T06:43:33.000Z', entries: ENTRIES });
  const chart = await service.get('IN');
  assert.equal(chart.available, true);
  assert.equal(chart.updatedAt, '2026-10-17T06:43:33.000Z');
  assert.deepEqual(chart.songs.map((item) => item.id), ['ashke', 'osom', 'radhimaa', 'antidote', 'straight', 'one-name']);
  assert.ok(chart.songs.every((item) => item.streamUrl.startsWith('/api/stream/')));
});

test('a built chart is cached; a failed feed is not', async () => {
  const built = setup({ updatedAt: null, entries: ENTRIES });
  await built.service.get('IN');
  await built.service.get('IN');
  assert.equal(built.feeds, 1);

  const failed = setup(null);
  assert.deepEqual(await failed.service.get('IN'), { storefront: 'IN', available: false, updatedAt: null, songs: [] });
  await failed.service.get('IN');
  assert.equal(failed.feeds, 2);
});

test('too few catalog matches leaves the chart unavailable rather than a stub', async () => {
  const { service } = setup({ updatedAt: null, entries: ENTRIES }, { 'Antidote Karan Aujla': CATALOG['Antidote Karan Aujla'] ?? [] });
  const chart = await service.get('IN');
  assert.equal(chart.available, false);
  assert.deepEqual(chart.songs, []);
});

test('a search that throws counts as no match, not a failed chart', async () => {
  const service = new TopChartService(
    { mostPlayedSongs: async () => ({ updatedAt: null, entries: ENTRIES }) },
    { search: async (query: string) => {
      if (query.startsWith('Ashke')) throw new Error('provider down');
      return { results: CATALOG[query] ?? [], source: 'Saavn' as const };
    } },
    new MemoryCacheStore()
  );
  const chart = await service.get('IN');
  assert.equal(chart.available, true);
  assert.deepEqual(chart.songs.map((item) => item.id), ['osom', 'radhimaa', 'antidote', 'straight', 'one-name']);
});
