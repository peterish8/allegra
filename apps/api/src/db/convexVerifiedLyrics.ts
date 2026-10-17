import type { LyricsScript } from '../types.js';
import type {
  StoredLyricsVersion,
  StoredVerifiedLyrics,
  VerifiedLyricsSong,
  VerifiedLyricsStore,
  VerifiedLyricsSubmission
} from '../services/verifiedLyrics.js';
import type { ConvexGateway } from './convexGateway.js';

/** Convex-backed listener-synced lyrics; every operation is named in convexGateway.ts. */
export class ConvexVerifiedLyricsStore implements VerifiedLyricsStore {
  public constructor(private readonly convex: ConvexGateway) {}

  public async get(ref: string): Promise<StoredVerifiedLyrics | null> {
    return parseRow(await this.convex.query('verifiedLyrics:get', { ref }));
  }

  public async byMatchKey(matchKey: string): Promise<StoredVerifiedLyrics | null> {
    return parseRow(await this.convex.query('verifiedLyrics:byMatchKey', { matchKey }));
  }

  public async submit(song: VerifiedLyricsSong, version: VerifiedLyricsSubmission): Promise<{ readonly saved: boolean }> {
    const result = await this.convex.mutation('verifiedLyrics:submit', { song, version });
    return { saved: isRecord(result) && result.saved === true };
  }

  public async report(ref: string, script: LyricsScript, reporter: string): Promise<{ readonly found: boolean; readonly hidden: boolean }> {
    const result = await this.convex.mutation('verifiedLyrics:report', { ref, script, reporter });
    return { found: isRecord(result) && result.found === true, hidden: isRecord(result) && result.hidden === true };
  }

  public async setHidden(ref: string, script: LyricsScript, hidden: boolean): Promise<{ readonly found: boolean }> {
    const result = await this.convex.mutation('verifiedLyrics:setHidden', { ref, script, hidden });
    return { found: isRecord(result) && result.found === true };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScript(value: unknown): value is LyricsScript {
  return value === 'latin' || value === 'native';
}

function parseVersion(value: unknown): StoredLyricsVersion | null {
  if (!isRecord(value) || !isScript(value.script)) return null;
  const source = value.source;
  if (
    typeof value.language !== 'string' ||
    typeof value.lrc !== 'string' ||
    !isRecord(source) || typeof source.name !== 'string' ||
    typeof value.confidence !== 'number' ||
    typeof value.syncedBy !== 'string' ||
    typeof value.syncedAt !== 'number' ||
    !Array.isArray(value.reportedBy) ||
    typeof value.hidden !== 'boolean'
  ) return null;
  return {
    script: value.script,
    language: value.language,
    lrc: value.lrc,
    source: { name: source.name, ...(typeof source.url === 'string' ? { url: source.url } : {}) },
    confidence: value.confidence,
    syncedBy: value.syncedBy,
    syncedAt: value.syncedAt,
    reportedBy: value.reportedBy.filter((item): item is string => typeof item === 'string'),
    hidden: value.hidden
  };
}

function parseRow(value: unknown): StoredVerifiedLyrics | null {
  if (
    !isRecord(value) ||
    typeof value.ref !== 'string' ||
    typeof value.matchKey !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.artist !== 'string' ||
    typeof value.duration !== 'number' ||
    typeof value.updatedAt !== 'number' ||
    !Array.isArray(value.versions)
  ) return null;
  return {
    ref: value.ref,
    matchKey: value.matchKey,
    title: value.title,
    artist: value.artist,
    duration: value.duration,
    versions: value.versions.flatMap((item) => {
      const version = parseVersion(item);
      return version ? [version] : [];
    }),
    updatedAt: value.updatedAt
  };
}
