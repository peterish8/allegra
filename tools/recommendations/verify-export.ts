import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

interface Factors {
  bias: number;
  vector: number[];
}

interface PlaylistModel {
  schemaVersion: number;
  dimensions: number;
  profiles: Record<string, Factors>;
  recordings: Record<string, Factors>;
  parity: { profile: string; expected: Record<string, number> };
}

const path = process.argv[2] ?? 'output/recommendations/playlist-model.json';
const model = JSON.parse(await readFile(path, 'utf8')) as PlaylistModel;
assert.equal(model.schemaVersion, 1);
assert.equal(model.dimensions, 32);
for (const entry of [...Object.values(model.profiles), ...Object.values(model.recordings)]) {
  assert.equal(entry.vector.length, model.dimensions);
  assert.ok(Number.isFinite(entry.bias) && entry.vector.every(Number.isFinite));
}

const profile = model.profiles[model.parity.profile];
assert.ok(profile);
const examples = Object.entries(model.parity.expected);
assert.ok(examples.length > 0);
for (const [key, expected] of examples) {
  const track = model.recordings[key];
  assert.ok(track);
  const score = profile.vector.reduce((sum, factor, index) => sum + factor * track.vector[index]!,
    profile.bias + track.bias);
  assert.ok(Math.abs(expected - score) <= 1e-6 + 1e-5 * Math.abs(expected), `Score mismatch for ${key}`);
}
console.log(`${examples.length} exported scores match Python LightFM.`);
