import assert from 'node:assert/strict';
import test from 'node:test';

import { artistKey, creditedArtists, identityKey } from './identity.ts';

test('bracketed release trailers and artist order share one recording identity', () => {
  assert.equal(
    identityKey('Please Please Please (From "Short n Sweet")', 'Sabrina Carpenter, Amy Allen'),
    identityKey('Please Please Please', 'Amy Allen Sabrina Carpenter')
  );
});

test('identity lowercases and trims while preserving accents and Unicode letters', () => {
  assert.equal(identityKey('  CHALÉYA!! ', ' ARIJIT SINGH '), 'chaléya|arijit singh');
  assert.equal(identityKey('  चा\n लेया  ', ' गायक '), 'चा लेया|गायक');
});

test('a featured credit in a bracketed trailer is removed but a remaster suffix remains distinct', () => {
  assert.equal(identityKey('Song (feat. X)', 'A'), identityKey('Song', 'A'));
  assert.equal(identityKey('Song - Remastered 2011', 'A'), 'song remastered 2011|a');
  assert.notEqual(identityKey('Song - Remastered 2011', 'A'), identityKey('Song', 'A'));
});

test('credited artists split the API separators and keep first spelling and order', () => {
  assert.deepEqual(creditedArtists('A, B & C feat. D ft. E x F'), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.deepEqual(creditedArtists('A, a, B, b'), ['A', 'B']);
});

test('empty artist credits produce no names', () => {
  assert.deepEqual(creditedArtists(''), []);
  assert.deepEqual(creditedArtists(' , & feat. '), []);
});

test('artist keys trim and lowercase names', () => {
  assert.equal(artistKey('  ARIJIT Singh  '), 'arijit singh');
  assert.equal(artistKey(''), '');
});
