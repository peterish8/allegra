import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { songIdentity } from '../lib/normalize.js';
import { artistKey, creditedArtists } from '../shared/identity.js';
import type { UnifiedSong } from '../types.js';
import { blendWithLightfm, parseLightfmModel, scoreRecordings, type LightfmModel } from './lightfm.js';
import type { RecommendationService, TasteContext } from './recommendations.js';

/**
 * Local side-by-side preview of Quick Picks and the LightFM blend. Development only: the
 * profiles are public benchmark playlists, not Allegra accounts, and the model is a local
 * file under the ignored `output/` directory.
 */
export interface PreviewTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly language: string;
  readonly duration: number;
  readonly popularity: number;
}

export interface PreviewProfile {
  readonly id: string;
  readonly title: string;
  readonly language: string;
  readonly genre: string | null;
  /** Visible same-language tracks, in the benchmark's seed order. */
  readonly seeds: readonly PreviewTrack[];
  /** Every visible track; never recommended back. */
  readonly exclude: readonly PreviewTrack[];
  readonly hiddenCount: number;
}

export type PreviewModel =
  | { readonly status: 'ready'; readonly model: LightfmModel }
  | { readonly status: 'unavailable'; readonly detail: string };

export interface PreviewInputs {
  readonly profiles: readonly PreviewProfile[];
  readonly model: PreviewModel;
}

export interface RecommendationPreviewSource {
  load(): Promise<PreviewInputs>;
}

/** Reads `preview-profiles.json` and `playlist-model.json` once. A bad model still serves profiles. */
export function filePreviewSource(directory: string): RecommendationPreviewSource {
  let loaded: Promise<PreviewInputs> | null = null;
  return {
    load: () => {
      loaded ??= (async () => {
        const profiles = parseProfiles(JSON.parse(await readFile(join(directory, 'preview-profiles.json'), 'utf8')));
        let model: PreviewModel;
        try {
          model = { status: 'ready', model: parseLightfmModel(JSON.parse(await readFile(join(directory, 'playlist-model.json'), 'utf8'))) };
        } catch (error) {
          model = { status: 'unavailable', detail: error instanceof Error ? error.message : 'The model could not be read.' };
        }
        return { profiles, model };
      })();
      // A missing profiles file is retried on the next request rather than cached.
      loaded.catch(() => { loaded = null; });
      return loaded;
    }
  };
}

export function parseProfiles(raw: unknown): PreviewProfile[] {
  const profiles = (raw as { profiles?: unknown } | null)?.profiles;
  if (!Array.isArray(profiles)) throw new Error('Preview profiles are missing.');
  return profiles.map((value: unknown) => {
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.language !== 'string') throw new Error('A preview profile is malformed.');
    return {
      id: row.id,
      title: row.title,
      language: row.language,
      genre: typeof row.genre === 'string' ? row.genre : null,
      seeds: parseTracks(row.seeds),
      exclude: parseTracks(row.exclude),
      hiddenCount: typeof row.hiddenCount === 'number' ? row.hiddenCount : 0
    };
  });
}

function parseTracks(raw: unknown): PreviewTrack[] {
  if (!Array.isArray(raw)) throw new Error('Preview tracks are missing.');
  return raw.map((value: unknown) => {
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.artist !== 'string') throw new Error('A preview track is malformed.');
    return {
      id: row.id,
      title: row.title,
      artist: row.artist,
      language: typeof row.language === 'string' ? row.language : '',
      duration: typeof row.duration === 'number' ? row.duration : 0,
      popularity: typeof row.popularity === 'number' ? row.popularity : 0
    };
  });
}

function playable(track: PreviewTrack): UnifiedSong {
  return {
    id: track.id, title: track.title, artist: track.artist, language: track.language, duration: track.duration,
    playCount: track.popularity, hasLyrics: false, source: 'Saavn', artwork: '', streamUrl: `/api/stream/${encodeURIComponent(track.id)}`
  };
}

/** The taste input the benchmark's baseline gave the current ranker for this playlist. */
export function previewInput(profile: PreviewProfile): { context: TasteContext; excludeIds: Set<string>; excludeSongs: UnifiedSong[] } {
  const seeds = profile.seeds.map(playable);
  const counts = new Map<string, { name: string; score: number }>();
  for (const song of seeds) {
    const name = creditedArtists(song.artist)[0] ?? song.artist;
    const key = artistKey(name);
    counts.set(key, { name, score: (counts.get(key)?.score ?? 0) + 1 });
  }
  const excludeSongs = profile.exclude.map(playable);
  return {
    context: {
      seeds: seeds.slice(0, 4),
      favoriteArtists: [...counts.values()].sort((a, b) => b.score - a.score).slice(0, 3),
      favoriteLanguages: [profile.language],
      languages: [profile.language]
    },
    excludeIds: new Set(excludeSongs.map((song) => song.id)),
    excludeSongs
  };
}

export type PreviewModelStatus = 'ready' | 'unavailable' | 'no-profile-vector';

export interface PreviewComparison {
  readonly provider: string;
  readonly reasoning: string;
  readonly model: { readonly status: PreviewModelStatus; readonly seed: number | null; readonly collectedAt: string | null; readonly detail?: string };
  readonly current: readonly UnifiedSong[];
  readonly lightfm: readonly UnifiedSong[];
  readonly candidates: readonly {
    readonly id: string;
    readonly title: string;
    readonly artist: string;
    readonly currentRank: number;
    readonly lightfmRank: number;
    readonly score: number | null;
  }[];
  readonly coverage: { readonly candidates: number; readonly withVectors: number };
}

/** Both shelves from one candidate pool. Without a usable model, the LightFM side repeats today's order. */
export async function comparePreview(
  recommendations: RecommendationService,
  profile: PreviewProfile,
  model: PreviewModel
): Promise<PreviewComparison | null> {
  const { context, excludeIds, excludeSongs } = previewInput(profile);
  // Filled by the rerank callback, which sees the candidates after the shared exclusions.
  const ranking: { scores: Map<string, number> | null; order: readonly UnifiedSong[] } = { scores: null, order: [] };
  const comparison = await recommendations.compare(context, excludeIds, excludeSongs, (candidates) => {
    ranking.scores = model.status === 'ready' ? scoreRecordings(model.model, profile.id, candidates.map(songIdentity)) : null;
    ranking.order = ranking.scores ? blendWithLightfm(candidates, ranking.scores) : candidates;
    return ranking.order;
  });
  if (!comparison) return null;
  const scored: ReadonlyMap<string, number> = ranking.scores ?? new Map<string, number>();
  const status: PreviewModelStatus = model.status === 'unavailable' ? 'unavailable' : ranking.scores ? 'ready' : 'no-profile-vector';
  const blendedRank = new Map(ranking.order.map((song, index) => [songIdentity(song), index + 1]));
  return {
    provider: comparison.provider,
    reasoning: comparison.reasoning,
    model: {
      status,
      seed: model.status === 'ready' ? model.model.seed : null,
      collectedAt: model.status === 'ready' ? model.model.collectedAt : null,
      ...(model.status === 'unavailable' ? { detail: model.detail } : {})
    },
    current: comparison.current,
    lightfm: comparison.reranked,
    candidates: comparison.candidates.map((song, index) => {
      const key = songIdentity(song);
      return {
        id: song.id,
        title: song.title,
        artist: song.artist,
        currentRank: index + 1,
        lightfmRank: blendedRank.get(key) ?? index + 1,
        score: scored.get(key) ?? null
      };
    }),
    coverage: { candidates: comparison.candidates.length, withVectors: comparison.candidates.filter((song) => scored.has(songIdentity(song))).length }
  };
}
