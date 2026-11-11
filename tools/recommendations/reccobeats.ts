import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { artistKey, creditedArtists, identityKey } from '../../apps/api/src/shared/identity.js';
import type { Snapshot, Track } from './collect.js';

const origin = 'https://api.reccobeats.com/v1/';
const normalizedAttributes = ['acousticness', 'danceability', 'energy', 'instrumentalness',
  'liveness', 'speechiness', 'valence'] as const;
type Attribute = typeof normalizedAttributes[number] | 'bpm' | 'key' | 'mode' | 'loudness';

export interface TrackMatch {
  id: string;
  trackTitle: string;
  durationMs: number;
  artists: { name: string }[];
  isrc?: string;
}

type Match = { id: string; durationDelta: number };
type Lookup = { status: 'no_match' | 'ambiguous' | 'unavailable' }
  | { status: 'matched'; match: Match; features?: Partial<Record<Attribute, number>>; featuresFetched?: true };

function presentationTitle(title: string): string {
  return title.replace(/\s+[-–—]\s+from\s+["“'].*$/iu, '').trim();
}

export function matchRecording(track: Track, candidates: readonly TrackMatch[]): Lookup {
  const title = identityKey(presentationTitle(track.title), '');
  const lead = artistKey(creditedArtists(track.artist)[0] ?? track.artist);
  const allowedDelta = Math.max(2, Math.min(5, track.duration * 0.02));
  const recordings = new Map<string, Match>();
  for (const candidate of candidates) {
    if (!/^[0-9a-f-]{36}$/i.test(candidate.id) || typeof candidate.trackTitle !== 'string' ||
      identityKey(presentationTitle(candidate.trackTitle), '') !== title ||
      !Array.isArray(candidate.artists) || !candidate.artists.some(artist => typeof artist?.name === 'string' && artistKey(artist.name) === lead)) continue;
    const delta = Math.abs(track.duration - candidate.durationMs / 1000);
    if (!Number.isFinite(delta) || delta > allowedDelta) continue;
    const recording = (typeof candidate.isrc === 'string' && candidate.isrc.trim().toUpperCase()) || candidate.id;
    const previous = recordings.get(recording);
    if (!previous || delta < previous.durationDelta) recordings.set(recording, { id: candidate.id, durationDelta: delta });
  }
  const [best, other] = [...recordings.values()].sort((a, b) => a.durationDelta - b.durationDelta);
  if (!best) return { status: 'no_match' };
  if (other && other.durationDelta - best.durationDelta <= 1.5) return { status: 'ambiguous' };
  return { status: 'matched', match: best };
}

function audioFeatures(row: Record<string, unknown>): Partial<Record<Attribute, number>> {
  const output: Partial<Record<Attribute, number>> = {};
  for (const name of normalizedAttributes) {
    const value = row[name];
    if (typeof value === 'number' && value >= 0 && value <= 1) output[name] = value;
  }
  if (typeof row.tempo === 'number' && row.tempo >= 40 && row.tempo <= 250) output.bpm = row.tempo;
  if (typeof row.key === 'number' && Number.isInteger(row.key) && row.key >= 0 && row.key < 12) output.key = row.key;
  if (row.mode === 0 || row.mode === 1) output.mode = row.mode;
  if (typeof row.loudness === 'number' && row.loudness >= -60 && row.loudness <= 6) output.loudness = row.loudness;
  return output;
}

class RateLimited extends Error {}

async function enrich(): Promise<void> {
  const { values } = parseArgs({ options: {
    output: { type: 'string', default: 'output/recommendations/enriched' },
    limit: { type: 'string', default: '240' }
  } });
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 600) throw new Error('Choose 1–600 tracks per snapshot.');
  const output = values.output!;
  const snapshot = JSON.parse(await readFile(join(output, 'catalog.json'), 'utf8')) as Snapshot;
  const baseline = JSON.parse(await readFile(join(output, 'baseline.json'), 'utf8')) as {
    collectedAt: string; cases: { pool: Record<string, Track> }[];
  };
  assert.equal(baseline.collectedAt, snapshot.collectedAt);
  const candidates = new Set(baseline.cases.flatMap(item => Object.keys(item.pool)));
  const path = join(output, 'reccobeats.json');
  const previous = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return '{}';
  });
  const saved = JSON.parse(previous) as { collectedAt?: string; tracks?: Record<string, Lookup> };
  const rows = saved.collectedAt === snapshot.collectedAt ? (saved.tracks ?? {}) : {};
  const keys = [...new Set([...Object.keys(rows), ...chooseTracks(snapshot, candidates, limit)])].slice(0, limit);
  let requests = 0;
  let failures = 0;
  let nextRequest = 0;
  let limited = false;

  async function get<T>(path: string, params: Record<string, string>): Promise<T | null> {
    await setTimeout(Math.max(0, nextRequest - Date.now()));
    nextRequest = Date.now() + 1550;
    const url = new URL(path, origin);
    url.search = new URLSearchParams(params).toString();
    requests++;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (response.status === 429) {
        const retry = response.headers.get('Retry-After');
        throw new RateLimited(`ReccoBeats paused the run with HTTP 429${retry ? ` (Retry-After ${retry})` : ''}.`);
      }
      if (response.ok) return await response.json() as T;
    } catch (error) {
      if (error instanceof RateLimited) throw error;
    }
    failures++;
    return null;
  }

  async function save(): Promise<void> {
    await writeFile(`${path}.tmp`, JSON.stringify({ collectedAt: snapshot.collectedAt, provider: origin,
      requests, failures, rateLimited: limited, tracks: rows }));
    await rename(`${path}.tmp`, path);
  }

  async function attachPending(): Promise<void> {
    const pending = Object.entries(rows).filter((entry): entry is [string, Extract<Lookup, { status: 'matched' }>] =>
      entry[1].status === 'matched' && !entry[1].featuresFetched && !entry[1].features);
    const ids = [...new Set(pending.map(([, row]) => row.match.id))];
    for (let start = 0; start < ids.length; start += 40) {
      const batch = ids.slice(start, start + 40);
      const response = await get<{ content?: Record<string, unknown>[] }>('audio-features', { ids: batch.join(',') });
      if (!Array.isArray(response?.content)) continue;
      const byId = new Map(response.content.map(item => [item.id, audioFeatures(item)]));
      for (const [, row] of pending) {
        if (!batch.includes(row.match.id)) continue;
        row.featuresFetched = true;
        const features = byId.get(row.match.id);
        if (features && Object.keys(features).length) row.features = features;
      }
      await save();
    }
  }

  try {
    await attachPending();
    for (const [index, key] of keys.entries()) {
      if (rows[key] && rows[key].status !== 'unavailable') continue;
      const track = snapshot.tracks[key]!;
      const title = presentationTitle(track.title);
      const lead = creditedArtists(track.artist)[0] ?? track.artist;
      if (title.length < 3 || lead.length < 3) continue;
      const result = await get<{ content?: TrackMatch[] }>('track/search', { searchText: title, artist: lead, size: '8' });
      rows[key] = result && Array.isArray(result.content) ? matchRecording(track, result.content) : { status: 'unavailable' };
      if ((index + 1) % 25 === 0) {
        await attachPending();
        await save();
        console.log(`Searched ${index + 1} of ${keys.length} recordings.`);
      }
    }
    await attachPending();
  } catch (error) {
    if (!(error instanceof RateLimited)) throw error;
    limited = true;
    console.log(error.message);
  } finally {
    await save();
  }
  const finished = Object.entries(rows).filter(([, row]) => row.status === 'matched' && row.features);
  console.log(JSON.stringify({ lookedUp: Object.keys(rows).length, tracksWithFeatures: finished.length,
    candidateTracksWithFeatures: finished.filter(([key]) => candidates.has(key)).length, requests, failures, limited }));
}

function chooseTracks(snapshot: Snapshot, candidates: ReadonlySet<string>, limit: number): string[] {
  const groups = new Map<string, string[]>();
  const order = Object.keys(snapshot.tracks).map(key => ({ key, hash: createHash('sha256').update(key).digest('hex') }));
  for (const { key } of order.sort((a, b) => a.hash.localeCompare(b.hash))) {
    const track = snapshot.tracks[key]!;
    const lane = `${candidates.has(key) ? 'candidate' : 'catalog'}:${track.language}`;
    const keys = groups.get(lane) ?? [];
    keys.push(key);
    groups.set(lane, keys);
  }
  const result: string[] = [];
  for (let index = 0; result.length < limit; index++) {
    const round = [...groups.values()].flatMap(keys => keys.slice(index, index + 1));
    if (!round.length) break;
    result.push(...round);
  }
  return result.slice(0, limit);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await enrich();
