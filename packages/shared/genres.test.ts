import assert from 'node:assert/strict';
import test from 'node:test';

import { genrePersonalNote, genreSearchQuery, normalizeMusicGenreIds, recommendArtistNames, recommendGenres } from './genres.ts';

test('genre picks lead the recommendations and listening fills them in by artist and language', () => {
  const genres = recommendGenres({
    genres: ['electronic', 'not-a-genre', 'electronic'],
    topArtists: [{ name: 'Taylor Swift', score: 5 }],
    languages: [{ name: 'english', score: 2 }]
  });

  assert.equal(genres[0]?.id, 'electronic');
  assert.equal(genres[1]?.id, 'pop');
  assert.equal(genres.length, 6);
});

test('genre ids are normalized, deduplicated, and limited to the supported catalogue', () => {
  assert.deepEqual(normalizeMusicGenreIds([' POP ', 'pop', 'unknown']), ['pop']);
});

test('artist suggestions follow selected genres and use a starter set for new listeners', () => {
  assert.deepEqual(recommendArtistNames({ genres: ['electronic'] }), ['Calvin Harris', 'David Guetta', 'Alan Walker', 'Marshmello', 'Martin Garrix']);
  assert.deepEqual(recommendArtistNames(null).slice(0, 6), ['Arijit Singh', 'Shreya Ghoshal', 'Pritam', 'Mithoon', 'Tanishk Bagchi', 'Vishal-Shekhar']);
  assert.deepEqual(recommendArtistNames(null, 0), []);
});

test('genre card searches include matching listener cues', () => {
  const pop = recommendGenres({
    topArtists: [{ name: 'Taylor Swift', score: 5 }],
    languages: [{ name: 'english', score: 2 }]
  }).find((genre) => genre.id === 'pop');

  assert.ok(pop);
  assert.equal(genreSearchQuery(pop, { topArtists: [{ name: 'Taylor Swift', score: 5 }], languages: [{ name: 'english', score: 2 }] }), 'pop hits songs Taylor Swift english');
  assert.equal(genrePersonalNote(pop, { topArtists: [{ name: 'Taylor Swift', score: 5 }] }), 'With Taylor Swift');
});
