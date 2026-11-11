import { songIdentity } from '../lib/normalize.js';
import type { UnifiedSong } from '../types.js';

/**
 * Scores catalog candidates with factors exported by `tools/recommendations/benchmark.py`.
 * The model is trained offline on Linux; the API only takes dot products. A LightFM score for
 * one profile is `profile · recording + profile bias + recording bias`, which matches
 * `LightFM.predict()` with the item features the trainer used.
 */
export const LIGHTFM_SCHEMA_VERSION = 1;
const MAX_DIMENSIONS = 256;
/** Reciprocal-rank constant used by the benchmark's blend. */
const BLEND_K = 10;

export interface LightfmFactors {
  readonly bias: number;
  readonly vector: Float64Array;
}

export interface LightfmModel {
  readonly dimensions: number;
  readonly seed: number | null;
  readonly collectedAt: string | null;
  readonly profiles: ReadonlyMap<string, LightfmFactors>;
  /** Keyed by Allegra's recording identity (`songIdentity`). */
  readonly recordings: ReadonlyMap<string, LightfmFactors>;
}

export class LightfmModelError extends Error {}

/** Validates an exported artifact. Anything malformed or nonfinite rejects the whole model. */
export function parseLightfmModel(raw: unknown): LightfmModel {
  const record = asObject(raw, 'model');
  if (record.schemaVersion !== LIGHTFM_SCHEMA_VERSION) {
    throw new LightfmModelError(`Unsupported model schema ${String(record.schemaVersion)}.`);
  }
  const dimensions = record.dimensions;
  if (typeof dimensions !== 'number' || !Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_DIMENSIONS) {
    throw new LightfmModelError('Model dimensions must be a positive integer.');
  }
  return {
    dimensions,
    seed: typeof record.seed === 'number' && Number.isFinite(record.seed) ? record.seed : null,
    collectedAt: typeof record.collectedAt === 'string' ? record.collectedAt : null,
    profiles: parseFactorTable(record.profiles, dimensions, 'profiles'),
    recordings: parseFactorTable(record.recordings, dimensions, 'recordings')
  };
}

function parseFactorTable(raw: unknown, dimensions: number, name: string): Map<string, LightfmFactors> {
  const table = new Map<string, LightfmFactors>();
  for (const [key, value] of Object.entries(asObject(raw, name))) {
    const entry = asObject(value, `${name}.${key}`);
    const { bias, vector } = entry;
    if (typeof bias !== 'number' || !Number.isFinite(bias)) throw new LightfmModelError(`${name}.${key} has a nonfinite bias.`);
    if (!Array.isArray(vector) || vector.length !== dimensions) throw new LightfmModelError(`${name}.${key} has the wrong vector length.`);
    const factors = new Float64Array(dimensions);
    vector.forEach((factor: unknown, index) => {
      if (typeof factor !== 'number' || !Number.isFinite(factor)) throw new LightfmModelError(`${name}.${key} has a nonfinite factor.`);
      factors[index] = factor;
    });
    table.set(key, { bias, vector: factors });
  }
  return table;
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new LightfmModelError(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

/** The full LightFM score for each key that has a vector. Null when the profile has none. */
export function scoreRecordings(model: LightfmModel, profileId: string, keys: readonly string[]): Map<string, number> | null {
  const profile = model.profiles.get(profileId);
  if (!profile) return null;
  const scores = new Map<string, number>();
  for (const key of keys) {
    const recording = model.recordings.get(key);
    if (!recording || scores.has(key)) continue;
    let score = profile.bias + recording.bias;
    for (let index = 0; index < model.dimensions; index++) score += profile.vector[index]! * recording.vector[index]!;
    scores.set(key, score);
  }
  return scores;
}

/**
 * Blends the current order with the LightFM order by reciprocal rank, as the benchmark's
 * `blend_same_pool` does. Using ranks keeps the two scorers' scales apart. A song with no
 * vector gets no LightFM credit: on the model side it ranks after every scored song, in its
 * current order, so the model cannot promote a recording it knows nothing about.
 */
export function blendWithLightfm(songs: readonly UnifiedSong[], scores: ReadonlyMap<string, number>): UnifiedSong[] {
  const modelOrder = songs
    .map((song, index) => ({ index, score: scores.get(songIdentity(song)) }))
    .sort((left, right) => (left.score === undefined ? 1 : 0) - (right.score === undefined ? 1 : 0)
      || (right.score ?? 0) - (left.score ?? 0)
      || left.index - right.index);
  const modelRank = new Map<number, number>();
  modelOrder.forEach((row, rank) => modelRank.set(row.index, rank));
  return songs
    .map((song, index) => {
      const lightfm = modelRank.get(index)!;
      return { song, index, blended: 1 / (BLEND_K + index) + 1 / (BLEND_K + lightfm) };
    })
    .sort((left, right) => right.blended - left.blended || left.index - right.index)
    .map((row) => row.song);
}
