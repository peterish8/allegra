import { createHash } from 'node:crypto';
import type { CacheStore } from '../lib/cache.js';
import type { LyricsSourcesResponse, LyricsSyncResult } from '../shared/lyricSync.js';
import { matchKey, parseSongRef } from '../shared/songRef.js';
import type { LyricsScript, UnifiedSong } from '../types.js';
import type { LyricsService } from './lyrics.js';
import type { VerifiedLyricsStore, VerifiedLyricsSubmission } from './verifiedLyrics.js';

export interface LyricSource {
  readonly origin: 'provider' | 'site';
  readonly source: { readonly name: string; readonly url?: string };
  readonly script: LyricsScript;
  readonly language: string;
  readonly lines: readonly string[];
  readonly synced: boolean;
}

export class LyricSyncInputError extends Error {}
const TTL = 86_400;
export const SYNC_CONFIDENCE = 0.7;
const MAX_WORDS = 3000;
const MAX_TEXT = 24_000;
const CANDIDATE_VERSION = 'v1';

export function validLyricsRef(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 80) return false;
  const parsed = parseSongRef(value);
  return parsed !== null && `${parsed.source}:${parsed.id}` === value;
}

export function lyricsScript(value: unknown): value is LyricsScript {
  return value === 'latin' || value === 'native';
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new LyricSyncInputError('Choose a lyric version and try again.');
  return value as Record<string, unknown>;
}

export function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).every(key => keys.includes(key));
}

function candidateId(ref: string, source: LyricSource): string {
  return createHash('sha256').update(JSON.stringify([CANDIDATE_VERSION, ref, source.origin, source.source.name, source.source.url ?? '', source.script, source.language, source.lines])).digest('hex');
}

/** Uses server catalog metadata and server words only. Cached candidates can be rebuilt on a cold instance. */
export class LyricSyncService {
  public constructor(
    private readonly catalog: Pick<{ getSong(ref: string): Promise<UnifiedSong> }, 'getSong'>,
    private readonly lyrics: Pick<LyricsService, 'sources' | 'forgetVerified'>,
    private readonly store: VerifiedLyricsStore,
    private readonly cache: CacheStore
  ) {}

  private async song(ref: string): Promise<UnifiedSong> {
    if (!validLyricsRef(ref)) throw new LyricSyncInputError('Choose a catalog song.');
    const song = await this.catalog.getSong(ref);
    if (!Number.isFinite(song.duration) || song.duration <= 0 || song.duration > 7200) throw new LyricSyncInputError('This recording has no usable duration.');
    return song;
  }

  private async candidates(ref: string, song: UnifiedSong): Promise<Array<{ id: string; value: LyricSource }>> {
    const sources = await this.lyrics.sources(song.title, song.artist, song.duration, {
      ref, ...(song.album ? { album: song.album } : {}), ...(song.language ? { language: song.language } : {})
    });
    const result: Array<{ id: string; value: LyricSource }> = [];
    const seen = new Set<string>();
    for (const value of sources) {
      const words = value.lines.flatMap(line => line.split(/\s+/u));
      if (!value.lines.length || words.length > MAX_WORDS || value.lines.join('\n').length > MAX_TEXT) continue;
      const id = candidateId(ref, value);
      if (seen.has(id)) continue;
      seen.add(id);
      // Cache failure does not change the candidate: submit can reconstruct the same ID.
      await this.cache.set(`lyric-candidate:${CANDIDATE_VERSION}:${ref}:${id}`, value, TTL).catch(() => undefined);
      result.push({ id, value });
    }
    return result;
  }

  public async sources(ref: string): Promise<LyricsSourcesResponse> {
    const song = await this.song(ref);
    const candidates = await this.candidates(ref, song);
    return {
      song: { ref, title: song.title, artist: song.artist, duration: song.duration },
      candidates: candidates.map(({ id, value }) => ({ id, origin: value.origin, source: value.origin === 'site' ? 'Found online' : value.source.name,
        url: null, script: value.script, language: value.language, lines: value.lines, synced: value.synced }))
    };
  }

  public async submit(ref: string, versions: unknown, userId: string): Promise<LyricsSyncResult> {
    if (!Array.isArray(versions) || versions.length < 1 || versions.length > 2) throw new LyricSyncInputError('Choose one or two lyric versions.');
    const parsed = versions.map(raw => {
      const version = object(raw);
      if (!exactKeys(version, ['candidateId', 'script', 'wordTimes', 'confidence']) || typeof version.candidateId !== 'string'
        || !/^[a-f0-9]{64}$/.test(version.candidateId) || !lyricsScript(version.script)) throw new LyricSyncInputError('Choose a valid lyric version.');
      return { candidateId: version.candidateId, script: version.script, wordTimes: version.wordTimes, confidence: version.confidence };
    });
    if (new Set(parsed.map(version => version.script)).size !== parsed.length) throw new LyricSyncInputError('Choose only one version per script.');
    const song = await this.song(ref);
    let rebuilt: Awaited<ReturnType<LyricSyncService['candidates']>> | undefined;
    const submissions: VerifiedLyricsSubmission[] = [];
    for (const version of parsed) {
      let candidate = await this.cache.get<LyricSource>(`lyric-candidate:${CANDIDATE_VERSION}:${ref}:${version.candidateId}`).catch(() => null);
      if (!candidate) {
        rebuilt ??= await this.candidates(ref, song);
        candidate = rebuilt.find(item => item.id === version.candidateId)?.value ?? null;
      }
      if (!candidate || candidateId(ref, candidate) !== version.candidateId || candidate.script !== version.script) throw new LyricSyncInputError('These words changed or expired. Find the versions again.');
      const lrc = rebuildLrc(candidate.lines, version.wordTimes, song.duration, version.confidence);
      submissions.push({ script: candidate.script, language: candidate.language, source: candidate.source, lrc,
        confidence: version.confidence as number, syncedBy: userId });
    }
    // Validate every version before changing any saved lyric.
    const saved: Array<{ script: LyricsScript; saved: boolean }> = [];
    try {
      for (const version of submissions) {
        const result = await this.store.submit({ ref, title: song.title, artist: song.artist, duration: song.duration,
          matchKey: matchKey(song.title, song.artist) }, version);
        saved.push({ script: version.script, saved: result.saved });
      }
    } finally {
      await this.lyrics.forgetVerified(ref);
    }
    return { versions: saved };
  }

  public async report(ref: string, script: LyricsScript, reporter: string): Promise<{ found: boolean; hidden: boolean }> {
    if (!validLyricsRef(ref)) throw new LyricSyncInputError('Choose a catalog song.');
    const result = await this.store.report(ref, script, reporter);
    await this.lyrics.forgetVerified(ref);
    return result;
  }
}

/** Validates times, then constructs enhanced LRC. No client text is consumed. */
export function rebuildLrc(lines: readonly string[], input: unknown, duration: number, confidence: unknown): string {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < SYNC_CONFIDENCE || confidence > 1) throw new LyricSyncInputError('The timing is not confident enough to share.');
  const words = lines.map(line => line.split(/\s+/u));
  if (!Array.isArray(input) || input.length !== words.reduce((count, line) => count + line.length, 0) || input.length > MAX_WORDS) throw new LyricSyncInputError('The timing does not match these words.');
  let previousEnd = 0;
  const times = input.map(raw => {
    const value = object(raw);
    const { start, end, filler } = value;
    if (!exactKeys(value, ['start', 'end', 'filler']) || typeof start !== 'number' || typeof end !== 'number'
      || !Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd || end <= start || end > duration
      || (filler !== undefined && typeof filler !== 'boolean')) throw new LyricSyncInputError('Some word times are invalid. Sync the version again.');
    // Millisecond rounding must not collapse a word's duration.
    const roundedStart = Math.round(start * 1000) / 1000;
    const roundedEnd = Math.round(end * 1000) / 1000;
    if (roundedEnd <= roundedStart) throw new LyricSyncInputError('Some word times are too short.');
    previousEnd = end;
    return { start: roundedStart, end: roundedEnd, filler: filler === true };
  });
  let index = 0;
  let realLines = 0;
  const lrc = words.map(line => {
    const timed = times.slice(index, index + line.length);
    index += line.length;
    if (timed.every(time => !time.filler)) realLines++;
    const text = line.map((word, i) => `<${stamp(timed[i]?.start ?? 0)}>${word}<${stamp(timed[i]?.end ?? 0)}>`).join(' ');
    return `[${stamp(timed[0]?.start ?? 0)}]${text}`;
  });
  if (!lines.length || realLines / lines.length < 0.7) throw new LyricSyncInputError('Too many lines could not be timed reliably. Try another version.');
  return lrc.join('\n');
}

function stamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
}
