import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeSong, songIdentity } from '../../apps/api/src/lib/normalize.js';
import { SaavnProvider } from '../../apps/api/src/providers/saavn.js';
import { mapLimited, type Snapshot, type Track } from './collect.js';

interface Baseline {
  collectedAt: string;
  provider: string;
  cases: { pool: Record<string, Track> }[];
}

const { values } = parseArgs({ options: {
  base: { type: 'string', default: 'output/recommendations' },
  extra: { type: 'string', default: 'output/recommendations/enriched-catalog' },
  output: { type: 'string', default: 'output/recommendations/enriched' }
} });
const base = resolve(values.base!);
const extra = resolve(values.extra!);
const output = resolve(values.output!);
assert.ok(output !== base && output !== extra, 'Use a separate directory for the expanded snapshot.');

async function read<T>(dir: string, file: string): Promise<T> {
  return JSON.parse(await readFile(join(dir, file), 'utf8')) as T;
}

const [original, expanded, originalAudio, expandedAudio, baseline] = await Promise.all([
  read<Snapshot>(base, 'catalog.json'), read<Snapshot>(extra, 'catalog.json'),
  read<Record<string, string>>(base, 'audio-sources.json'), read<Record<string, string>>(extra, 'audio-sources.json'),
  read<Baseline>(base, 'baseline.json')
]);
assert.equal(original.collectedAt, baseline.collectedAt, 'Baseline belongs to a different catalog snapshot.');

const playlists = [...original.playlists];
const tracks = { ...original.tracks };
const audio = { ...originalAudio };
for (const playlist of expanded.playlists) {
  const members = new Set(playlist.tracks);
  const duplicate = playlists.some(existing => {
    const overlap = existing.tracks.filter(key => members.has(key)).length;
    return existing.id === playlist.id || overlap / (existing.tracks.length + members.size - overlap) >= 0.7;
  });
  if (duplicate) continue;
  playlists.push(playlist);
  for (const key of members) {
    if (expanded.tracks[key]) tracks[key] ??= expanded.tracks[key];
    if (expandedAudio[key]) audio[key] ??= expandedAudio[key];
  }
}
const playlistRecordings = Object.keys(tracks).length;
const candidates = new Map(baseline.cases.flatMap(item => Object.entries(item.pool)));
for (const [key, track] of candidates) tracks[key] ??= track;

const needAudio = [...candidates].filter(([key]) => !audio[key]);
const provider = new SaavnProvider({ baseUrl: baseline.provider, timeoutMs: 10000 });
const size = 20;
const batches = Array.from({ length: Math.ceil(needAudio.length / size) }, (_, index) =>
  needAudio.slice(index * size, (index + 1) * size));
const responses = await mapLimited(batches, 3, async batch => {
  const result = await provider.getSongsByIds(batch.map(([, track]) => track.id));
  return { batch, result };
});
for (const { batch, result } of responses) {
  if (!result.ok) continue;
  const expected = new Map(batch.map(([key, track]) => [track.id, key]));
  for (const raw of result.data) {
    const song = normalizeSong(raw, 'Saavn');
    if (!song) continue;
    const key = expected.get(song.id);
    if (!key || songIdentity(song) !== key || !tracks[key]) continue;
    const asset = raw.downloadUrl?.find(item => item.quality === '96kbps')?.url;
    if (asset) audio[key] = asset;
    const year = 'year' in raw ? Number(raw.year) : 0;
    if (year >= 1900 && year <= new Date().getUTCFullYear()) tracks[key].year ??= year;
  }
}

const info = {
  baseCollectedAt: original.collectedAt,
  additionalCollectedAt: expanded.collectedAt,
  originalPlaylists: original.playlists.length,
  addedPlaylists: playlists.length - original.playlists.length,
  playlistRecordings,
  baselineCandidates: candidates.size,
  candidateAudioSources: [...candidates.keys()].filter(key => audio[key]).length,
  audioRequests: batches.length,
  audioRequestFailures: responses.filter(({ result }) => !result.ok).length
};
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(join(output, 'catalog.json'), JSON.stringify({ ...original, playlists, tracks, expansion: info })),
  writeFile(join(output, 'baseline.json'), JSON.stringify(baseline)),
  writeFile(join(output, 'audio-sources.json'), JSON.stringify(audio))
]);
console.log(JSON.stringify({ ...info, recordings: Object.keys(tracks).length, audioSources: Object.keys(audio).length }, null, 2));
