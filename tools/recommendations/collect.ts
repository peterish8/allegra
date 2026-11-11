import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { decodeHtml } from '../../apps/api/src/lib/decodeHtml.js';
import { normalizeSong, songIdentity } from '../../apps/api/src/lib/normalize.js';
import type { SaavnSong } from '../../apps/api/src/providers/saavn.js';

const strata = {
  hindi: ['indie', 'film', 'classical', 'hip hop', 'acoustic', 'dance', 'ghazal', 'devotional'],
  tamil: ['indie', 'film', 'classical', 'hip hop', 'acoustic', 'dance', 'folk', 'devotional'],
  telugu: ['indie', 'film', 'classical', 'dance', 'folk', 'devotional'],
  malayalam: ['indie', 'film', 'acoustic', 'folk', 'dance'],
  kannada: ['indie', 'film', 'folk', 'devotional'],
  punjabi: ['indie', 'hip hop', 'pop', 'folk', 'dance'],
  bengali: ['indie', 'film', 'folk', 'classical'],
  marathi: ['indie', 'film', 'folk', 'devotional'],
  english: ['indie', 'rock', 'pop', 'jazz', 'electronic', 'acoustic']
};

const genreNames: Record<string, RegExp> = {
  indie: /\bindie\b/i,
  film: /\b(film|cinema|soundtracks?|movies?|bollywood|kollywood|tollywood)\b/i,
  classical: /\b(classical|carnatic|hindustani)\b/i,
  'hip hop': /\b(hip[ -]?hop|rap)\b/i,
  acoustic: /\b(acoustic|unplugged)\b/i,
  dance: /\b(dance|party|club)\b/i,
  ghazal: /\bghazals?\b/i,
  devotional: /\b(devotional|bhakti|bhajans?)\b/i,
  folk: /\bfolk\b/i,
  pop: /\bpop\b/i,
  rock: /\brock\b/i,
  jazz: /\bjazz\b/i,
  electronic: /\b(electronic|edm|house|techno)\b/i
};

export interface Track {
  id: string;
  title: string;
  artist: string;
  language: string;
  duration: number;
  popularity: number;
  year?: number;
  album?: string;
}

export interface Playlist {
  id: string;
  title: string;
  genre: string | null;
  language: string;
  tracks: string[];
}

export interface Snapshot {
  collectedAt: string;
  provider: string;
  tracks: Record<string, Track>;
  playlists: Playlist[];
}

type PlaylistSummary = { id: string | number; name: string; songCount?: number };
type RawSong = SaavnSong & { readonly year?: string | number };

async function collect(): Promise<void> {
  const { values } = parseArgs({ options: {
    output: { type: 'string', default: 'output/recommendations' },
    provider: { type: 'string', default: 'https://saavn.sumit.co/api' },
    'playlists-per-query': { type: 'string', default: '2' }
  } });
  const perQuery = Number(values['playlists-per-query']);
  if (!Number.isInteger(perQuery) || perQuery < 1 || perQuery > 4) throw new Error('Choose 1–4 playlists per query.');
  const root = new URL(values.provider!);
  if (root.protocol !== 'https:' || root.username || root.password || root.search || root.hash) {
    throw new Error('Expected a public HTTPS JioSaavn API base URL.');
  }
  let failures = 0;
  async function read<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const url = new URL(`${root.href.replace(/\/$/, '')}/${path}`);
    url.search = new URLSearchParams(params).toString();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (response.ok) {
          const body = await response.json() as { data?: T };
          return body.data ?? null;
        }
        if (response.status < 500 && response.status !== 429) break;
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('Retry-After'));
          if (retryAfter > 10) break;
          await new Promise(resolve => setTimeout(resolve, Math.max(2, retryAfter || 0) * 1000));
        }
      } catch {
        // Retry transient provider or transport errors within the request budget.
      }
      await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt));
    }
    failures++;
    return null;
  }

  const queries = Object.entries(strata).flatMap(([language, genres]) =>
    genres.map(genre => ({ language, genre })));
  const summaries = await mapLimited(queries, 4, async ({ language, genre }) => {
    const result = await read<{ results?: PlaylistSummary[] }>('search/playlists', { query: `${language} ${genre}`, limit: '8' });
    return (result?.results ?? [])
      .filter(item => item.id && item.name && (item.songCount === undefined || Number(item.songCount) >= 10))
      .sort((a, b) => Number(genreNames[genre]!.test(b.name)) - Number(genreNames[genre]!.test(a.name)))
      .slice(0, perQuery).map(item => ({ id: String(item.id), genre, language }));
  });
  const sources = [...new Map(summaries.flat().map(item => [item.id, item])).values()];
  console.log(`Found ${sources.length} playlists across ${queries.length} language/genre queries.`);

  const rows = await mapLimited(sources, 4, async source => ({ source, detail: await read<{
    name?: string; description?: string; songs?: RawSong[];
  }>('playlists', { id: source.id, limit: '40', page: '1' }) }));

  const tracks: Snapshot['tracks'] = {};
  const audio: Record<string, string> = {};
  const playlists: Playlist[] = [];
  for (const { source, detail } of rows) {
    if (!detail?.name || !Array.isArray(detail.songs)) continue;
    const title = decodeHtml(detail.name);
    const text = `${title} ${decodeHtml(detail.description ?? '')}`;
    const genres = Object.keys(genreNames).filter(genre => genreNames[genre]!.test(text));
    const genre = genres.includes(source.genre) ? source.genre : genres.length === 1 ? genres[0]! : null;
    const playlistTracks = new Map<string, { song: Track; audioUrl: string | undefined }>();
    for (const raw of detail.songs) {
      const song = normalizeSong(raw, 'Saavn');
      if (!song?.language || song.duration < 45 || !song.artist || song.artist === 'Unknown Artist') continue;
      const key = songIdentity(song);
      const year = Number(raw.year);
      const audioUrl = raw.downloadUrl?.find(asset => asset.quality === '96kbps')?.url;
      playlistTracks.set(key, { song: {
        id: song.id, title: song.title, artist: song.artist, language: song.language.toLowerCase(),
        duration: song.duration, popularity: song.playCount ?? 0,
        ...(song.album ? { album: song.album } : {}),
        ...(year >= 1900 && year <= new Date().getUTCFullYear() ? { year } : {})
      }, audioUrl });
    }
    const keys = [...playlistTracks.keys()];
    if (keys.length < 10) continue;
    const similar = playlists.some(prior => {
      const overlap = prior.tracks.filter(key => playlistTracks.has(key)).length;
      return overlap / (prior.tracks.length + keys.length - overlap) >= 0.7;
    });
    if (similar) continue;
    const language = [...new Set([...playlistTracks.values()].map(item => item.song.language))]
      .map(name => ({ name, count: [...playlistTracks.values()].filter(item => item.song.language === name).length }))
      .sort((a, b) => b.count - a.count)[0]!.name;
    playlists.push({ id: source.id, title, genre, language, tracks: keys });
    for (const [key, item] of playlistTracks) {
      if (!tracks[key] || item.song.popularity > tracks[key]!.popularity) tracks[key] = item.song;
      if (item.audioUrl && !audio[key]) audio[key] = item.audioUrl;
    }
  }

  const snapshot: Snapshot = { collectedAt: new Date().toISOString(), provider: root.href, tracks, playlists };
  await mkdir(values.output!, { recursive: true });
  await writeFile(join(values.output!, 'catalog.json'), JSON.stringify(snapshot));
  await writeFile(join(values.output!, 'audio-sources.json'), JSON.stringify(audio));
  console.log(JSON.stringify({ playlists: playlists.length, recordings: Object.keys(tracks).length,
    memberships: playlists.reduce((sum, item) => sum + item.tracks.length, 0),
    taggedPlaylists: playlists.filter(item => item.genre !== null).length, failures }));
  if (playlists.length < 20 || Object.keys(tracks).length < 500) {
    throw new Error('Too little live catalog data for the benchmark. Inspect provider availability and retry.');
  }
}

export async function mapLimited<T, R>(inputs: readonly T[], limit: number, work: (input: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, async () => {
    while (next < inputs.length) {
      const index = next++;
      results[index] = await work(inputs[index]!);
    }
  }));
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await collect();
}
