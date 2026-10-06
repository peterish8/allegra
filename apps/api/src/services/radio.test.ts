import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedSong } from '../types.js';
import { RadioService, type RadioCatalog } from './radio.js';

function song(id: string, title: string, artist: string, language = 'hindi'): UnifiedSong {
  return { id, title, artist, album: 'A', artwork: '', streamUrl: `/api/stream/${id}`, duration: 200, hasLyrics: false, playCount: 0, source: 'Saavn', language };
}

const seed = song('seed', 'Kesariya', 'Pritam, Arijit Singh');

function fakeCatalog(overrides: Partial<RadioCatalog> = {}): RadioCatalog {
  return {
    getSong: async () => seed,
    getSuggestions: async () => [song('a', 'Tum Hi Ho', 'Arijit Singh'), seed, song('es', 'Despacito', 'Luis Fonsi', 'spanish')],
    getArtist: async (name) => ({
      songs: name === 'Pritam'
        ? [song('p1', 'Tum Se Hi', 'Pritam'), song('p2', 'Ilahi', 'Pritam')]
        : [song(`t-${name}`, `Hit by ${name}`, name)]
    }),
    ...overrides
  };
}

test('a guest gets similar songs and the seed artist, in the seed language, without the seed', async () => {
  const pool = await new RadioService(fakeCatalog()).pool('seed', { taste: null, languages: [] });
  assert.deepEqual(pool.candidates.map((candidate) => [candidate.song.id, candidate.source, candidate.rank]), [
    ['a', 'similar', 0],
    ['p1', 'artist', 0],
    ['p2', 'artist', 1]
  ]);
  assert.equal(pool.taste, null);
});

test('a listener’s favourite artists add taste candidates, skipping the seed’s own artists', async () => {
  const taste = { artists: [{ name: 'Arijit Singh', score: 9 }, { name: 'Shreya Ghoshal', score: 5 }, { name: 'Nobody', score: 0 }], languages: ['hindi'] };
  const pool = await new RadioService(fakeCatalog()).pool('seed', { taste, languages: [] });
  const tasteIds = pool.candidates.filter((candidate) => candidate.source === 'taste').map((candidate) => candidate.song.id);
  assert.deepEqual(tasteIds, ['t-Shreya Ghoshal']);
  assert.deepEqual(pool.taste, taste);
});

test('the language setting is a hard filter', async () => {
  const pool = await new RadioService(fakeCatalog({
    getSong: async () => song('seed', 'Kesariya', 'Pritam', ''),
    getSuggestions: async () => [song('ta', 'Tamil Song', 'X', 'tamil'), song('hi', 'Hindi Song', 'Y', 'hindi')]
  })).pool('seed', { taste: null, languages: ['tamil'] });
  assert.ok(pool.candidates.every((candidate) => candidate.song.language === 'tamil'));
});

test('a failing source leaves a smaller pool, never an error', async () => {
  const pool = await new RadioService(fakeCatalog({
    getSong: async () => { throw new Error('down'); },
    getArtist: async () => { throw new Error('down'); }
  })).pool('seed', { taste: null, languages: [] });
  assert.deepEqual(pool.candidates.map((candidate) => candidate.song.id), ['a', 'es']);
});
