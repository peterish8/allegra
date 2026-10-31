import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogService } from './catalog.js';
import { MemoryCacheStore } from '../lib/cache.js';
import { isCompilationAlbum } from '../lib/normalize.js';
import type { UnifiedSong } from '../types.js';
import type { GaanaProvider } from '../providers/gaana.js';
import type { SaavnProvider } from '../providers/saavn.js';

const song = (id: string, title: string, artist: string, album: string): UnifiedSong =>
  ({ id, title, artist, album, artwork: `${album}.jpg`, streamUrl: `/api/stream/${id}`, duration: 240, hasLyrics: false, playCount: 0, source: 'Saavn' });

function catalogWith(answers: Record<string, UnifiedSong[]>) {
  const service = new CatalogService({ saavn: {} as SaavnProvider, gaana: {} as GaanaProvider, cache: new MemoryCacheStore() });
  Object.assign(service, { search: async (query: string) => ({ results: answers[query] ?? [], source: 'Saavn' }) });
  return service;
}

test('compilations are recognised, including "… Classics" and decade sets', () => {
  for (const album of ['Romantic Classics Hits', 'Best Of Arijit Singh - Collection Of Romantic Songs', 'Party Classics', '2010s Party', '90s Love']) {
    assert.equal(isCompilationAlbum(album), true, album);
  }
  for (const album of ['Aashiqui 2', 'Citylights', 'Daaru Party', 'Four Me']) {
    assert.equal(isCompilationAlbum(album), false, album);
  }
});

test('a shelf shows each song on its own release, never a compilation cover', async () => {
  const service = catalogWith({
    'romantic hits': [
      song('c1', 'Tum Hi Ho (From "Aashiqui 2")', 'Arijit Singh', 'Best Of Arijit Singh - Collection Of Romantic Songs'),
      song('c2', 'Nobody Has This', 'Someone', 'Romantic Classics Hits'),
      song('o1', 'Muskurane (Romantic)', 'Arijit Singh', 'Citylights'),
      // A playlist album no compilation word catches: the recording's own single is found among its releases.
      song('drive', 'Pal Pal Dil Ke Paas- Title Track', 'Arijit Singh', 'Arijit Singh Drive Mix')
    ],
    'Pal Pal Dil Ke Paas- Title Track Arijit Singh': [
      { ...song('drive', 'Pal Pal Dil Ke Paas- Title Track', 'Arijit Singh', 'Arijit Singh Drive Mix'), variants: [song('single', 'Pal Pal Dil Ke Paas- Title Track', 'Arijit Singh', 'Pal Pal Dil Ke Paas')] }
    ],
    'Tum Hi Ho (From "Aashiqui 2") Arijit Singh': [
      song('c1b', 'Tum Hi Ho', 'Arijit Singh', 'Romantic Classics Hits'),
      song('cover', 'Tum Hi Ho', 'A Cover Singer', 'Aashiqui 2 Covers'),
      song('own', 'Tum Hi Ho', 'Arijit Singh', 'Aashiqui 2')
    ]
  });
  const home = await service.getHome();
  assert.deepEqual(home.madeForYou.map((row) => row.id), ['own', 'o1', 'single']);
  assert.equal(home.madeForYou.find((row) => row.id === 'single')?.variants, undefined, 'a swapped row carries no variants');
  assert.ok(home.madeForYou.every((row) => !isCompilationAlbum(row.album)));
});

test('with no name to go on, a shelf takes the earliest release, and drops mashups', async () => {
  const dance = { ...song('dance', 'Apna Bana Le', 'Arijit Singh', 'Dil Se Dance'), artwork: 'https://c.saavncdn.com/1/Dil-Se-Dance-Hindi-2026-20260301120000-500x500.jpg' };
  const film = { ...song('film', 'Apna Bana Le', 'Arijit Singh', 'Bhediya'), artwork: 'https://c.saavncdn.com/2/Bhediya-Hindi-2022-20221125-500x500.jpg' };
  const service = catalogWith({
    'romantic hits': [dance, song('mash', 'Romantic Mashup', 'DJ Someone', 'Romantic Mashup')],
    'Apna Bana Le Arijit Singh': [{ ...dance, variants: [film] }]
  });
  const home = await service.getHome();
  assert.deepEqual(home.madeForYou.map((row) => row.id), ['film']);
});
