import type { LyricsSyncCandidate, LyricsSyncRequest } from '@shared/lyricSync';
import { fromAllegraSong, type SongRef } from '@shared/songRef';
import type { UnifiedSong } from '@shared/types';
import { saveLyricsSync } from '../api';
import { syncInBrowser, type AlignedVersion } from './client';
import type { AlignProgress } from './config';

export interface LyricsSyncTarget {
  readonly ref: SongRef;
  readonly song: UnifiedSong;
  readonly streamUrl: string;
  readonly candidates: readonly LyricsSyncCandidate[];
  readonly gpu: boolean;
}

export type LyricsSyncJobStatus = 'queued' | 'downloading' | 'syncing' | 'ready' | 'saving' | 'saved' | 'failed' | 'cancelled';

export interface LyricsSyncJob {
  readonly id: string;
  readonly target: LyricsSyncTarget;
  readonly status: LyricsSyncJobStatus;
  readonly progress: AlignProgress;
  readonly versions?: readonly AlignedVersion[];
  readonly error?: string;
  readonly createdAt: number;
}

export type LyricsSyncRunner = (
  target: LyricsSyncTarget,
  signal: AbortSignal,
  progress: (value: AlignProgress) => void
) => Promise<AlignedVersion[]>;

export interface LyricsSyncCoordinatorDependencies {
  readonly run?: LyricsSyncRunner;
  readonly save?: (request: LyricsSyncRequest) => ReturnType<typeof saveLyricsSync>;
  readonly createId?: () => string;
  readonly now?: () => number;
}

export interface LyricsSyncCoordinator {
  enqueue(target: LyricsSyncTarget): string;
  retry(jobId: string): void;
  cancel(jobId: string): void;
  save(jobId: string): Promise<boolean>;
  restore(jobs: readonly LyricsSyncJob[]): void;
  getSnapshot(): readonly LyricsSyncJob[];
  subscribe(listener: () => void): () => void;
}

let fallbackId = 0;

export function createLyricsSyncTarget(
  song: UnifiedSong,
  candidates: readonly LyricsSyncCandidate[],
  gpu: boolean
): LyricsSyncTarget {
  const ref = fromAllegraSong(song);
  if (!ref || !song.streamUrl) throw new Error('Could not identify this recording for lyric sync.');
  if (!candidates.length) throw new Error('Choose at least one lyric version to sync.');

  const variants = song.variants?.map((variant) => Object.freeze({ ...variant }));
  const songSnapshot = Object.freeze({
    ...song,
    ...(variants ? { variants: Object.freeze(variants) } : {})
  });
  const candidateSnapshots = Object.freeze(candidates.map((candidate) => Object.freeze({
    ...candidate,
    lines: Object.freeze([...candidate.lines])
  })));

  return Object.freeze({
    ref,
    song: songSnapshot,
    streamUrl: song.streamUrl,
    candidates: candidateSnapshots,
    gpu
  });
}

function defaultId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  fallbackId += 1;
  return `lyrics-sync-${Date.now()}-${fallbackId}`;
}

function fingerprint(target: LyricsSyncTarget): string {
  return JSON.stringify([
    target.ref,
    target.song.id,
    target.streamUrl,
    target.gpu,
    target.candidates.map((candidate) => [candidate.id, candidate.script, candidate.lines])
  ]);
}

function immutableVersions(versions: readonly AlignedVersion[], target: LyricsSyncTarget): readonly AlignedVersion[] {
  const mapped = versions.map((version) => {
    const candidate = target.candidates.find((item) => item.id === version.candidate.id);
    if (!candidate) throw new Error('The alignment returned lyrics for a different recording. Retry this sync.');
    return Object.freeze({
      ...version,
      candidate,
      wordTimes: Object.freeze(version.wordTimes.map((word) => Object.freeze({ ...word }))),
      lineConfidence: Object.freeze([...version.lineConfidence])
    });
  });
  return Object.freeze(mapped);
}

function saveRequest(job: LyricsSyncJob): LyricsSyncRequest | null {
  if (!job.versions?.length || job.versions.some((version) => version.confidence < 0.7)) return null;
  return {
    ref: job.target.ref,
    versions: job.versions.map((version) => ({
      candidateId: version.candidate.id,
      script: version.candidate.script,
      wordTimes: version.wordTimes,
      confidence: version.confidence
    }))
  };
}

export function createLyricsSyncCoordinator(dependencies: LyricsSyncCoordinatorDependencies = {}): LyricsSyncCoordinator {
  let jobs: readonly LyricsSyncJob[] = Object.freeze([]);
  const listeners = new Set<() => void>();
  let activeJobId: string | null = null;
  let activeController: AbortController | null = null;
  let activeRunToken: number | null = null;
  const runTokens = new Map<string, number>();

  const run: LyricsSyncRunner = dependencies.run ?? ((target, signal, progress) =>
    syncInBrowser(target.streamUrl, [...target.candidates], target.gpu, signal, progress));
  const persist: NonNullable<LyricsSyncCoordinatorDependencies['save']> = dependencies.save ?? saveLyricsSync;
  const createId = dependencies.createId ?? defaultId;
  const now = dependencies.now ?? Date.now;

  const publish = (next: readonly LyricsSyncJob[]): void => {
    jobs = Object.freeze([...next]);
    listeners.forEach((listener) => listener());
  };

  const update = (jobId: string, change: (job: LyricsSyncJob) => LyricsSyncJob): void => {
    const index = jobs.findIndex((job) => job.id === jobId);
    if (index < 0) return;
    const next = [...jobs];
    next[index] = change(next[index]!);
    publish(next);
  };

  const pump = (): void => {
    if (activeJobId) return;
    const next = jobs.find((job) => job.status === 'queued');
    if (!next) return;
    const controller = new AbortController();
    activeJobId = next.id;
    activeController = controller;
    const runToken = (runTokens.get(next.id) ?? 0) + 1;
    runTokens.set(next.id, runToken);
    activeRunToken = runToken;
    update(next.id, (job) => ({ ...job, status: 'syncing', error: undefined }));

    void Promise.resolve()
      .then(() => run(next.target, controller.signal, (value) => {
        if (controller.signal.aborted || runTokens.get(next.id) !== runToken) return;
        const progress = Object.freeze({ ...value });
        update(next.id, (job) => ({
          ...job,
          status: /download/i.test(progress.stage) ? 'downloading' : 'syncing',
          progress,
          error: undefined
        }));
      }))
      .then((versions) => {
        if (controller.signal.aborted || runTokens.get(next.id) !== runToken) return;
        const result = immutableVersions(versions, next.target);
        update(next.id, (job) => ({ ...job, status: 'ready', progress: { stage: 'Ready to review', percent: 100, overall: 100 }, versions: result, error: undefined }));
      })
      .catch((error: unknown) => {
        if (runTokens.get(next.id) !== runToken) return;
        update(next.id, (job) => {
          if (controller.signal.aborted || job.status === 'cancelled') {
            return { ...job, status: 'cancelled', progress: { stage: 'Cancelled', percent: 0, overall: 0 }, error: undefined };
          }
          return {
            ...job,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Could not sync this recording. Try again.'
          };
        });
      })
      .finally(() => {
        if (activeJobId === next.id && activeRunToken === runToken) {
          activeJobId = null;
          activeController = null;
          activeRunToken = null;
        }
        pump();
      });
  };

  return {
    enqueue(target) {
      const key = fingerprint(target);
      const inFlight = jobs.find((job) =>
        ['queued', 'downloading', 'syncing'].includes(job.status) && fingerprint(job.target) === key
      );
      if (inFlight) return inFlight.id;

      const id = createId();
      const job: LyricsSyncJob = Object.freeze({
        id,
        target,
        status: 'queued',
        progress: Object.freeze({ stage: 'Waiting to sync', percent: 0, overall: 0 }),
        createdAt: now()
      });
      publish([...jobs, job]);
      pump();
      return id;
    },

    retry(jobId) {
      const job = jobs.find((item) => item.id === jobId);
      if (!job || !['failed', 'cancelled'].includes(job.status)) return;
      runTokens.set(jobId, (runTokens.get(jobId) ?? 0) + 1);
      update(jobId, (current) => ({
        ...current,
        status: 'queued',
        progress: { stage: 'Waiting to sync', percent: 0, overall: 0 },
        error: undefined,
        versions: undefined
      }));
      pump();
    },

    cancel(jobId) {
      const job = jobs.find((item) => item.id === jobId);
      if (!job || !['queued', 'downloading', 'syncing'].includes(job.status)) return;
      runTokens.set(jobId, (runTokens.get(jobId) ?? 0) + 1);
      if (activeJobId === jobId) activeController?.abort();
      update(jobId, (current) => ({
        ...current,
        status: 'cancelled',
        progress: { stage: 'Cancelled', percent: 0, overall: 0 },
        error: undefined
      }));
    },

    async save(jobId) {
      const job = jobs.find((item) => item.id === jobId);
      const request = job ? saveRequest(job) : null;
      if (!job || job.status !== 'ready' || !request) return false;
      update(jobId, (current) => ({ ...current, status: 'saving', error: undefined }));
      try {
        const result = await persist(request);
        if (!result.versions.some((version) => version.saved)) throw new Error('A higher-confidence version is already shared for this recording.');
        update(jobId, (current) => ({ ...current, status: 'saved', error: undefined }));
        return true;
      } catch (error) {
        update(jobId, (current) => ({
          ...current,
          status: 'ready',
          error: error instanceof Error ? error.message : 'Could not save the timing.'
        }));
        return false;
      }
    },

    restore(restored) {
      if (activeJobId) return;
      const seen = new Set<string>();
      const safe = restored.filter((job) => {
        if ((job.status !== 'ready' && job.status !== 'saved') || seen.has(job.id)) return false;
        seen.add(job.id);
        return true;
      });
      publish(safe.slice(-5));
    },

    getSnapshot: () => jobs,

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  };
}
