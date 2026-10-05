import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../lib/cache.js';
import type { ArtistProfile, UnifiedSong } from '../types.js';
import { ARTIST_FACTS, ArtistFactsService, factsFromProfile } from './artistFacts.js';

const song = (language?: string): UnifiedSong => ({
  id: 'x', title: 't', artist: 'a', artwork: '', streamUrl: '', duration: 1, hasLyrics: false, playCount: 0, source: 'Saavn',
  ...(language ? { language } : {})
});

function profile(followerCount: number | null, extra: Partial<ArtistProfile> = {}): ArtistProfile {
  return {
    id: '1', name: 'Arijit Singh', image: null, isVerified: true, followerCount, bio: null,
    songs: [], albums: [], similar: [], ...extra
  } as ArtistProfile;
}

test('popularity is log10(1 + followers) / 7, clamped', () => {
  assert.equal(factsFromProfile('a', profile(0)).popularity, 0);
  assert.ok(Math.abs(factsFromProfile('a', profile(10_000)).popularity - Math.log10(10_001) / 7) < 1e-12);
  assert.ok(Math.abs(factsFromProfile('a', profile(10_000)).popularity - 0.57) < 0.01);
  assert.equal(factsFromProfile('a', profile(10_000_000)).popularity, 1);
  assert.equal(factsFromProfile('a', profile(null)).popularity, ARTIST_FACTS.fallbackPopularity);
});

test('language is the most common, ties alphabetical, absent when none', () => {
  assert.equal(factsFromProfile('a', profile(1, { songs: [song('Hindi'), song('tamil'), song('hindi')] })).language, 'hindi');
  assert.equal(factsFromProfile('a', profile(1, { songs: [song('tamil'), song('hindi')] })).language, 'hindi');
  assert.equal('language' in factsFromProfile('a', profile(1, { songs: [song()] })), false);
});

test('similar artists are keyed and capped at 10', () => {
  const similar = Array.from({ length: 14 }, (_, n) => ({ id: String(n), name: ` Artist ${n} `, image: null }));
  const facts = factsFromProfile('a', profile(1, { similar } as Partial<ArtistProfile>));
  assert.equal(facts.similar.length, 10);
  assert.equal(facts.similar[0], 'artist 0');
});

function fakeCatalog(behaviour: (name: string) => Promise<ArtistProfile>) {
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    get calls() { return calls; },
    get maxInFlight() { return maxInFlight; },
    getArtist: async (name: string) => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await behaviour(name);
      } finally {
        inFlight -= 1;
      }
    }
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a second call within 30 days is served from the cache', async () => {
  const catalog = fakeCatalog(async () => profile(1_000_000));
  const service = new ArtistFactsService(catalog, new MemoryCacheStore());
  await service.facts(['Arijit Singh']);
  const again = await service.facts(['arijit singh']);
  assert.equal(catalog.calls, 1);
  assert.ok((again.get('arijit singh')?.popularity ?? 0) > 0.8);
});

test('a failed lookup falls back and the fallback is cached', async () => {
  const catalog = fakeCatalog(async () => { throw new Error('not found'); });
  const service = new ArtistFactsService(catalog, new MemoryCacheStore());
  const facts = await service.facts(['nobody']);
  assert.deepEqual(facts.get('nobody'), { key: 'nobody', popularity: 0.5, similar: [] });
  await service.facts(['nobody']);
  assert.equal(catalog.calls, 1);
});

test('the budget returns fallbacks for unfinished lookups without caching them', async () => {
  const catalog = fakeCatalog(async (name) => {
    if (name === 'slow') await delay(300);
    return profile(10);
  });
  const cache = new MemoryCacheStore();
  const service = new ArtistFactsService(catalog, cache);
  const started = Date.now();
  const facts = await service.facts(['fast', 'slow'], 50);
  assert.ok(Date.now() - started < 250);
  assert.equal(facts.get('slow')?.popularity, 0.5);
  assert.ok((facts.get('fast')?.popularity ?? 0) < 0.5);
  assert.equal(await cache.get('artist-facts:slow'), null);
});

test('no more than four lookups run at once', async () => {
  const catalog = fakeCatalog(async () => { await delay(5); return profile(1); });
  const service = new ArtistFactsService(catalog, new MemoryCacheStore());
  await service.facts(Array.from({ length: 20 }, (_, n) => `artist ${n}`));
  assert.equal(catalog.calls, 20);
  assert.ok(catalog.maxInFlight <= 4);
});
