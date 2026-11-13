import type { LyricsSyncCandidate } from '@shared/lyricSync';
import { fromAllegraSong, type SongRef } from '@shared/songRef';
import type { UnifiedSong } from '@shared/types';
import type { AlignedVersion } from './client';
import type { LyricsSyncJob } from './jobs';

const DRAFT_KEY = 'allegra-lyric-sync-drafts-v1';
const MAX_DRAFTS = 5;
const MAX_DRAFT_LENGTH = 500_000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function snapshotSong(value: unknown): UnifiedSong | null {
  const raw = record(value);
  if (!raw || typeof raw.id !== 'string' || typeof raw.title !== 'string' || typeof raw.artist !== 'string'
    || typeof raw.artwork !== 'string' || typeof raw.streamUrl !== 'string' || !number(raw.duration)
    || typeof raw.hasLyrics !== 'boolean' || !number(raw.playCount)
    || (raw.source !== 'Saavn' && raw.source !== 'Gaana')) return null;
  return Object.freeze({
    id: raw.id,
    title: raw.title,
    artist: raw.artist,
    artwork: raw.artwork,
    streamUrl: raw.streamUrl,
    duration: raw.duration,
    hasLyrics: raw.hasLyrics,
    playCount: raw.playCount,
    source: raw.source,
    ...(typeof raw.album === 'string' ? { album: raw.album } : {}),
    ...(typeof raw.albumId === 'string' ? { albumId: raw.albumId } : {}),
    ...(typeof raw.language === 'string' ? { language: raw.language } : {})
  });
}

function snapshotCandidate(value: unknown): LyricsSyncCandidate | null {
  const raw = record(value);
  if (!raw || typeof raw.id !== 'string' || (raw.origin !== 'provider' && raw.origin !== 'site' && raw.origin !== 'manual')
    || typeof raw.source !== 'string' || raw.url !== null || (raw.script !== 'latin' && raw.script !== 'native')
    || typeof raw.language !== 'string' || !Array.isArray(raw.lines) || raw.lines.length > 3000
    || !raw.lines.every((line) => typeof line === 'string') || typeof raw.synced !== 'boolean') return null;
  return Object.freeze({ ...raw, lines: Object.freeze([...raw.lines]) }) as LyricsSyncCandidate;
}

function snapshotVersion(value: unknown, candidates: readonly LyricsSyncCandidate[]): AlignedVersion | null {
  const raw = record(value);
  const candidateRaw = record(raw?.candidate);
  const candidate = candidates.find((item) => item.id === candidateRaw?.id);
  if (!raw || !candidate || !Array.isArray(raw.wordTimes) || raw.wordTimes.length > 100_000
    || !Array.isArray(raw.lineConfidence) || raw.lineConfidence.length > 3000
    || !raw.lineConfidence.every((confidence) => number(confidence) && confidence >= 0 && confidence <= 1)
    || !number(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) return null;
  const wordTimes = raw.wordTimes.map((value) => {
    const word = record(value);
    if (!word || !number(word.start) || !number(word.end) || word.start < 0 || word.end <= word.start) return null;
    return Object.freeze({ start: word.start, end: word.end });
  });
  if (wordTimes.some((word) => word === null)) return null;
  return Object.freeze({
    candidate,
    wordTimes: Object.freeze(wordTimes),
    lineConfidence: Object.freeze([...raw.lineConfidence]),
    confidence: raw.confidence
  }) as AlignedVersion;
}

function snapshotJob(value: unknown): LyricsSyncJob | null {
  const raw = record(value);
  const targetRaw = record(raw?.target);
  const song = snapshotSong(targetRaw?.song);
  const ref = targetRaw?.ref;
  const candidatesRaw = targetRaw?.candidates;
  if (!raw || typeof raw.id !== 'string' || (raw.status !== 'ready' && raw.status !== 'saved')
    || !number(raw.createdAt) || typeof ref !== 'string' || !song || fromAllegraSong(song) !== ref
    || targetRaw?.streamUrl !== song.streamUrl || typeof targetRaw.gpu !== 'boolean'
    || !Array.isArray(candidatesRaw) || !candidatesRaw.length) return null;
  const candidates = candidatesRaw.map(snapshotCandidate);
  if (candidates.some((candidate) => candidate === null)) return null;
  const safeCandidates = Object.freeze(candidates as LyricsSyncCandidate[]);
  const target = Object.freeze({
    ref: ref as SongRef,
    song,
    streamUrl: song.streamUrl,
    candidates: safeCandidates,
    gpu: targetRaw.gpu
  });
  if (!Array.isArray(raw.versions) || !raw.versions.length || raw.versions.length > safeCandidates.length) return null;
  const versions = raw.versions.map((version) => snapshotVersion(version, safeCandidates));
  if (versions.some((version) => version === null)) return null;
  const progressRaw = record(raw.progress);
  const progress = progressRaw && typeof progressRaw.stage === 'string' && number(progressRaw.percent) && number(progressRaw.overall)
    ? Object.freeze({ stage: progressRaw.stage, percent: progressRaw.percent, overall: progressRaw.overall })
    : Object.freeze({ stage: 'Ready to review', percent: 100, overall: 100 });
  return Object.freeze({
    id: raw.id,
    target,
    status: raw.status,
    progress,
    versions: Object.freeze(versions as AlignedVersion[]),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
    createdAt: raw.createdAt
  });
}

export function readLyricsSyncDrafts(storage: StorageLike | null = browserStorage()): readonly LyricsSyncJob[] {
  if (!storage) return Object.freeze([]);
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw || raw.length > MAX_DRAFT_LENGTH) return Object.freeze([]);
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return Object.freeze([]);
    return Object.freeze(value.map(snapshotJob).filter((job): job is LyricsSyncJob => job !== null).slice(-MAX_DRAFTS));
  } catch {
    return Object.freeze([]);
  }
}

export function persistLyricsSyncDrafts(jobs: readonly LyricsSyncJob[], storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    const completed = jobs.filter((job) => ['ready', 'saving', 'saved'].includes(job.status) && job.versions?.length).slice(-MAX_DRAFTS);
    if (!completed.length) { storage.removeItem(DRAFT_KEY); return; }

    const accepted: LyricsSyncJob[] = [];
    for (const job of [...completed].reverse()) {
      const song = { ...job.target.song, variants: undefined };
      const safeJob = { ...job, status: job.status === 'saving' ? 'ready' : job.status, target: { ...job.target, song } } as LyricsSyncJob;
      const next = [safeJob, ...accepted];
      if (JSON.stringify(next).length <= MAX_DRAFT_LENGTH) accepted.splice(0, accepted.length, ...next);
    }
    const encoded = JSON.stringify(accepted);
    if (encoded.length <= MAX_DRAFT_LENGTH) storage.setItem(DRAFT_KEY, encoded);
    else storage.removeItem(DRAFT_KEY);
  } catch {
    // The in-memory draft remains available when local storage is full or disabled.
  }
}
