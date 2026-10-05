import assert from 'node:assert/strict';
import test from 'node:test';

import { identityKey } from './identity';

test('artist names keep their word order rather than merging distinct artists', () => {
  assert.notEqual(identityKey('Song', 'John Paul'), identityKey('Song', 'Paul John'));
});

test('credited artist order is immaterial while different names and release versions remain distinct', () => {
  assert.equal(identityKey('Song', 'A feat. B'), identityKey('Song', 'B, A'));
  assert.notEqual(identityKey('Song', 'A feat. B'), identityKey('Song', 'A, C'));
  assert.notEqual(identityKey('Song (Live)', 'A'), identityKey('Song', 'A'));
  assert.notEqual(identityKey('Song - Remix', 'A'), identityKey('Song', 'A'));
});

test('film labels and canonically equivalent Unicode do not split the same recording', () => {
  assert.equal(identityKey('Song (From "Film")', 'A'), identityKey('Song', 'A'));
  assert.equal(identityKey('Caf\u00e9', 'A'), identityKey('Cafe\u0301', 'A'));
  assert.ok(identityKey('தமிழ் பாடல்', 'கலைஞர்').startsWith('தமிழ் பாடல்|'));
});
