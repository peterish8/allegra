import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogService } from './catalog.js';
import { MemoryCacheStore } from '../lib/cache.js';
import { homeRegion } from '../routes/catalog.js';
import type { UnifiedSong } from '../types.js';
import type { GaanaProvider } from '../providers/gaana.js';
import type { SaavnProvider } from '../providers/saavn.js';

const song = (id: string, language: string): UnifiedSong => ({ id, title: `Song ${id}`, artist: `Artist ${id}`, language, duration: 200, source: 'Saavn' } as unknown as UnifiedSong);

/** A catalog whose search answers from a table, so the shelves can be checked without a provider. */
function catalogWith(answers: (query: string) => UnifiedSong[]) {
  const service = new CatalogService({ saavn: {} as SaavnProvider, gaana: {} as GaanaProvider, cache: new MemoryCacheStore() });
  const asked: string[] = [];
  Object.assign(service, { search: async (query: string) => { asked.push(query); return { results: answers(query), total: 0, page: 0 }; } });
  return { service, asked };
}

test('the Top 10 region: asked for, else from India geo headers, never outside India', () => {
  assert.equal(homeRegion('TN', undefined, undefined)?.language, 'tamil');
  assert.equal(homeRegion('in-kl', undefined, undefined)?.name, 'Kerala');
  assert.equal(homeRegion('TS', undefined, undefined)?.code, 'TG', 'old Telangana code still works');
  assert.equal(homeRegion('IN', 'IN', 'TN'), null, 'IN asks for the all-India chart, even from Tamil Nadu');
  assert.equal(homeRegion(undefined, 'IN', 'WB')?.language, 'bengali');
  assert.equal(homeRegion('auto', 'IN', 'PB')?.language, 'punjabi');
  assert.equal(homeRegion(undefined, 'US', 'CA'), null, 'a US "CA" is not a state of India');
  assert.equal(homeRegion('ZZ', 'IN', 'TN'), null, 'an unknown code falls back to all India');
});

test('a regional chart replaces Top 10, in that language, and the other shelves lose its songs', async () => {
  const tamil = Array.from({ length: 12 }, (_, i) => song(`t${i}`, 'tamil'));
  const { service, asked } = catalogWith((query) => (query === 'top tamil songs' ? [...tamil, song('h1', 'hindi')] : query.includes('romantic') ? [tamil[0]!, song('r1', 'hindi')] : [song(`d-${query}`, 'hindi')]));
  const home = await service.getHome([], { region: 'TN', regionName: 'Tamil Nadu', language: 'tamil' });
  assert.equal(home.trending.length, 10);
  assert.ok(home.trending.every((row) => row.language === 'tamil'));
  assert.deepEqual(home.chart, { region: 'TN', regionName: 'Tamil Nadu', language: 'tamil' });
  assert.ok(!home.madeForYou.some((row) => row.id === 't0'), 'a charted song is not repeated below');
  assert.ok(asked.includes('top tamil songs'));
});

test('a thin regional chart keeps the all-India shelves', async () => {
  const { service } = catalogWith((query) => (query === 'top rajasthani songs' ? [song('r1', 'rajasthani')] : [song(`d-${query}`, 'hindi')]));
  const home = await service.getHome([], { region: 'RJ', regionName: 'Rajasthan', language: 'rajasthani' });
  assert.equal(home.chart, undefined);
  assert.equal(home.trending[0]?.id, 'd-top songs');
});

test('the listener’s languages shape the shelves', async () => {
  const { service, asked } = catalogWith((query) => [song(`x-${query}`, query.includes('tamil') ? 'tamil' : 'english')]);
  await service.getHome(['tamil', 'english']);
  assert.ok(asked.includes('romantic tamil hits') && asked.includes('english party songs'));
});
