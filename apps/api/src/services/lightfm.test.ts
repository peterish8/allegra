import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { songIdentity } from '../lib/normalize.js';
import type { UnifiedSong } from '../types.js';
import { blendWithLightfm, LightfmModelError, parseLightfmModel, scoreRecordings } from './lightfm.js';

// One real profile and 16 recordings from the trained JioSaavn model, with the scores Python's
// LightFM.predict() returned for them.
const parity = JSON.parse(await readFile(new URL('./lightfm.parity.json', import.meta.url), 'utf8')) as {
  parity: { profile: string; expected: Record<string, number> };
};

function song(title: string, artist: string): UnifiedSong {
  return { id: title, title, artist, artwork: '', streamUrl: `/api/stream/${title}`, duration: 200, hasLyrics: false, playCount: 0, source: 'Saavn' };
}

function factors(vector: number[], bias = 0): { bias: number; vector: number[] } {
  return { bias, vector };
}

test('TypeScript scores match Python LightFM predict() for the exported model', () => {
  const model = parseLightfmModel(parity);
  const expected = Object.entries(parity.parity.expected);
  const scores = scoreRecordings(model, parity.parity.profile, expected.map(([key]) => key));
  assert.ok(scores);
  assert.equal(scores.size, 16);
  for (const [key, value] of expected) {
    assert.ok(Math.abs(scores.get(key)! - value) <= 1e-6 + 1e-5 * Math.abs(value), `score for ${key}`);
  }
});

test('a model with the wrong schema, dimensions or a nonfinite factor is rejected whole', () => {
  const valid = { schemaVersion: 1, dimensions: 2, profiles: { p: factors([1, 0]) }, recordings: { r: factors([0, 1]) } };
  assert.doesNotThrow(() => parseLightfmModel(valid));
  assert.throws(() => parseLightfmModel({ ...valid, schemaVersion: 2 }), LightfmModelError);
  assert.throws(() => parseLightfmModel({ ...valid, dimensions: 0 }), LightfmModelError);
  assert.throws(() => parseLightfmModel({ ...valid, recordings: { r: factors([0]) } }), LightfmModelError);
  assert.throws(() => parseLightfmModel({ ...valid, recordings: { r: factors([0, Number.NaN]) } }), LightfmModelError);
  assert.throws(() => parseLightfmModel({ ...valid, profiles: { p: { bias: Infinity, vector: [1, 0] } } }), LightfmModelError);
  assert.throws(() => parseLightfmModel(JSON.parse('{"schemaVersion":1,"dimensions":2,"profiles":[],"recordings":{}}')), LightfmModelError);
});

test('an unknown profile has no scores and an unknown recording is simply left unscored', () => {
  const model = parseLightfmModel({ schemaVersion: 1, dimensions: 2, profiles: { p: factors([1, 0], 0.5) }, recordings: { a: factors([2, 0], 0.1) } });
  assert.equal(scoreRecordings(model, 'missing', ['a']), null);
  assert.deepEqual([...scoreRecordings(model, 'p', ['a', 'b', 'a'])!], [['a', 2.6]]);
});

test('the blend moves a LightFM favourite up by rank, and a song without a vector gets no LightFM credit', () => {
  const songs = ['one', 'two', 'three', 'four', 'five'].map((title) => song(title, `${title} artist`));
  const key = (index: number): string => songIdentity(songs[index]!);
  // LightFM prefers the fifth song most, ranks the first last and has no vector for the second.
  const scores = new Map([[key(0), 0.1], [key(2), 0.2], [key(3), 0.3], [key(4), 0.9]]);
  const blended = blendWithLightfm(songs, scores).map((row) => row.title);
  // LightFM order five, four, three, one, then the unscored two. Reciprocal ranks with k = 10:
  // one 1/10 + 1/13, five 1/14 + 1/10, four 1/13 + 1/11, three 2/12, two 1/11 + 1/14.
  assert.deepEqual(blended, ['one', 'five', 'four', 'three', 'two']);
  assert.deepEqual(blendWithLightfm(songs, new Map()).map((row) => row.title), songs.map((row) => row.title));
});
