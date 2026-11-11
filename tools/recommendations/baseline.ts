import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CatalogService } from '../../apps/api/src/catalog/catalog.js';
import { MemoryCacheStore } from '../../apps/api/src/lib/cache.js';
import { songIdentity } from '../../apps/api/src/lib/normalize.js';
import { GaanaProvider } from '../../apps/api/src/providers/gaana.js';
import { SaavnProvider } from '../../apps/api/src/providers/saavn.js';
import { RecommendationService } from '../../apps/api/src/services/recommendations.js';
import { artistKey, creditedArtists } from '../../apps/api/src/shared/identity.js';
import type { UnifiedSong } from '../../apps/api/src/types.js';
import { mapLimited, type Playlist, type Snapshot, type Track } from './collect.js';

const { values } = parseArgs({ options: {
  output: { type: 'string', default: 'output/recommendations' },
  cases: { type: 'string', default: '48' },
  provider: { type: 'string' }
} });
const output = values.output!;
const count = Number(values.cases);
if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Choose 1–100 benchmark cases.');
const snapshot = JSON.parse(await readFile(join(output, 'catalog.json'), 'utf8')) as Snapshot;

function stableOrder(seed: string, key: string): string {
  return createHash('sha256').update(`quick-picks-v1:${seed}:${key}`).digest('hex');
}

function seeded<T>(items: readonly T[], seed: string, key: (item: T) => string): T[] {
  return items.map(item => ({ item, hash: stableOrder(seed, key(item)) }))
    .sort((a, b) => a.hash.localeCompare(b.hash)).map(({ item }) => item);
}

// Interleave strata before taking the requested number of test playlists.
const groups = new Map<string, Playlist[]>();
for (const playlist of seeded(snapshot.playlists, 'cases', item => item.id)) {
  if (playlist.tracks.filter(key => snapshot.tracks[key]?.language === playlist.language).length < 10) continue;
  const group = `${playlist.language}:${playlist.genre ?? 'unknown'}`;
  const rows = groups.get(group) ?? [];
  rows.push(playlist);
  groups.set(group, rows);
}
const ordered: Playlist[] = [];
for (let index = 0; ordered.length < count; index++) {
  const layer = [...groups.values()].flatMap(group => group.slice(index, index + 1));
  if (!layer.length) break;
  ordered.push(...seeded(layer, `layer:${index}`, item => item.id));
}

class CapturePool extends MemoryCacheStore {
  songs: readonly UnifiedSong[] = [];

  override async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (key.startsWith('recommend:') && value && typeof value === 'object' && 'songs' in value && Array.isArray(value.songs)) {
      this.songs = value.songs as UnifiedSong[];
    }
    await super.set(key, value, ttlSeconds);
  }
}

function playable(track: Track): UnifiedSong {
  return { id: track.id, title: track.title, artist: track.artist, language: track.language,
    duration: track.duration, playCount: track.popularity, hasLyrics: false, source: 'Saavn', artwork: '',
    streamUrl: `/api/stream/${encodeURIComponent(track.id)}` };
}

function toTrack(song: UnifiedSong): Track {
  return { id: song.id, title: song.title, artist: song.artist, language: song.language?.toLowerCase() ?? '',
    duration: song.duration, popularity: song.playCount ?? 0 };
}

let requests = 0;
let errors = 0;
const fetchImpl: typeof fetch = async (...args) => {
  requests++;
  try {
    const response = await fetch(...args);
    if (!response.ok) errors++;
    return response;
  } catch (error) {
    errors++;
    throw error;
  }
};
const provider = values.provider ?? snapshot.provider;
const catalog = new CatalogService({
  saavn: new SaavnProvider({ baseUrl: provider, fetchImpl, timeoutMs: 9000 }),
  gaana: new GaanaProvider({ baseUrl: 'https://example.invalid/api' }),
  cache: new MemoryCacheStore()
});

const cases = await mapLimited(ordered.slice(0, count), 2, async playlist => {
  const matching = seeded(playlist.tracks.filter(key => snapshot.tracks[key]!.language === playlist.language),
    playlist.id, key => key);
  const hidden = matching.slice(0, Math.ceil(matching.length / 4));
  const hiddenSet = new Set(hidden);
  const observed = playlist.tracks.filter(key => !hiddenSet.has(key));
  const context = matching.slice(hidden.length).map(key => playable(snapshot.tracks[key]!));
  const exclude = observed.map(key => playable(snapshot.tracks[key]!));
  const scores = new Map<string, { name: string; score: number }>();
  for (const song of context) {
    const name = creditedArtists(song.artist)[0] ?? song.artist;
    const key = artistKey(name);
    const score = scores.get(key);
    scores.set(key, { name, score: (score?.score ?? 0) + 1 });
  }
  const favoriteArtists = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 3);
  const cache = new CapturePool();
  const service = new RecommendationService(catalog, cache);
  const start = performance.now();
  const old = await service.recommend({ seeds: context.slice(0, 4), favoriteArtists,
    favoriteLanguages: [playlist.language], languages: [playlist.language] },
  new Set(exclude.map(song => song.id)), exclude);
  const ms = performance.now() - start;
  const seen = new Set(observed);
  const pool = Object.fromEntries(cache.songs.flatMap(song => {
    const key = songIdentity(song);
    return !seen.has(key) && song.streamUrl ? [[key, toTrack(song)]] : [];
  }));
  return { id: playlist.id, language: playlist.language, genre: playlist.genre, hidden, observed,
    pool, old: old?.songs.map(songIdentity) ?? [], ms };
});

const baseline = { collectedAt: snapshot.collectedAt, provider, cases, requests, errors };
await writeFile(join(output, 'baseline.json'), JSON.stringify(baseline));
console.log(JSON.stringify({ cases: cases.length, empty: cases.filter(item => item.old.length === 0).length,
  poolRows: cases.reduce((sum, item) => sum + Object.keys(item.pool).length, 0), requests, errors }));
if (cases.length < Math.min(count, 20) || cases.filter(item => item.old.length > 0).length < cases.length * 0.8) {
  throw new Error('The current ranker did not produce enough live baseline cases. Inspect provider failures.');
}
