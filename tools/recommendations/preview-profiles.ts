import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Snapshot, Track } from './collect.js';

/**
 * Writes the playlist profiles the local Quick Picks preview can select. Each one is a
 * benchmark case: the playlist's visible tracks become the seeds and exclusions exactly as
 * `baseline.ts` passed them to the current ranker. Only public playlist data is used.
 */
interface BaselineCase {
  id: string;
  language: string;
  genre: string | null;
  hidden: string[];
  observed: string[];
}

const { values } = parseArgs({ options: { output: { type: 'string', default: 'output/recommendations/enriched' } } });
const output = values.output!;
const snapshot = JSON.parse(await readFile(join(output, 'catalog.json'), 'utf8')) as Snapshot;
const baseline = JSON.parse(await readFile(join(output, 'baseline.json'), 'utf8')) as { collectedAt: string; cases: BaselineCase[] };
const model = JSON.parse(await readFile(join(output, 'playlist-model.json'), 'utf8')) as { collectedAt: string };
if (model.collectedAt !== snapshot.collectedAt) throw new Error('The model belongs to a different catalog snapshot.');

// Same ordering as baseline.ts, so the seeds are the ones the captured baseline used.
function seeded(items: readonly string[], seed: string): string[] {
  const hash = (key: string): string => createHash('sha256').update(`quick-picks-v1:${seed}:${key}`).digest('hex');
  return items.map(item => ({ item, hash: hash(item) })).sort((a, b) => a.hash.localeCompare(b.hash)).map(({ item }) => item);
}

const playlists = new Map(snapshot.playlists.map(playlist => [playlist.id, playlist]));
const track = (key: string): Track => {
  const row = snapshot.tracks[key];
  if (!row) throw new Error(`Missing catalog track ${key}.`);
  return row;
};
const profiles = baseline.cases.map(item => {
  const playlist = playlists.get(item.id);
  if (!playlist) throw new Error(`Missing playlist ${item.id}.`);
  const matching = seeded(playlist.tracks.filter(key => track(key).language === playlist.language), playlist.id);
  const hidden = matching.slice(0, item.hidden.length);
  if (hidden.join('\n') !== item.hidden.join('\n')) throw new Error(`Seed order for ${item.id} no longer matches the baseline.`);
  return {
    id: item.id,
    title: playlist.title,
    language: item.language,
    genre: item.genre,
    seeds: matching.slice(hidden.length).map(track),
    exclude: item.observed.map(track),
    hiddenCount: hidden.length
  };
});

await writeFile(join(output, 'preview-profiles.json'), JSON.stringify({ collectedAt: snapshot.collectedAt, profiles }));
console.log(`${profiles.length} preview profiles written.`);
