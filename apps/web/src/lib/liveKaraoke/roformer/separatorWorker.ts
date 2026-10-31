/// <reference lib="webworker" />

/**
 * Off-main-thread Mel-Band RoFormer. Holds the inference session for the page's lifetime
 * (model load is the slow part) and separates one song at a time, chunk by chunk,
 * starting wherever the listener is.
 *
 * Every separated chunk is also written to the on-device stem cache. A song's chunks come
 * from that cache first: a fully cached song needs neither its audio nor the model.
 * While the current song is comfortably ahead, the opening of the next song in the queue
 * is separated into the cache too (a prefetch), so karaoke carries on across the change.
 */

import { nextChunk, sliceChunk, streamChunkCount, STREAM_HOP_SAMPLES } from './chunks';
import { ROFORMER_SAMPLE_RATE } from './config';
import { getSession, recoverWithWasm, separateChunk } from './separate';
import { StemCache } from './stemCache';
import { subtractStereo } from './stems';
import type { StereoPcm } from './stft';

export type SeparatorRequest =
  | { readonly type: 'warm' }
  | { readonly type: 'abort-warm' }
  | { readonly type: 'probe'; readonly requestId: number; readonly songId: string }
  | {
      readonly type: 'job';
      readonly jobId: number;
      readonly songId: string;
      readonly totalSamples: number;
      readonly mono: boolean;
      readonly focus: number;
      readonly playhead: number;
      /** Chunks the page already holds: neither sent back nor separated again. */
      readonly skip: Uint8Array | null;
      /** The song's audio; null when the cache (or a prefetch) is expected to provide it. */
      readonly left: Float32Array | null;
      readonly right: Float32Array | null;
    }
  | { readonly type: 'audio'; readonly jobId: number; readonly left: Float32Array; readonly right: Float32Array }
  | { readonly type: 'focus'; readonly jobId: number; readonly chunk: number; readonly playhead: number }
  | { readonly type: 'pause'; readonly jobId: number }
  | { readonly type: 'resume'; readonly jobId: number }
  | { readonly type: 'cancel'; readonly jobId: number }
  | {
      readonly type: 'prefetch';
      readonly songId: string;
      readonly totalSamples: number;
      readonly mono: boolean;
      readonly left: Float32Array;
      readonly right: Float32Array;
      readonly chunks: readonly number[];
    }
  | { readonly type: 'cancel-prefetch' };

export interface SongProbe {
  readonly totalSamples: number;
  readonly mono: boolean;
  readonly chunkCount: number;
}

export type SeparatorResponse =
  | {
      readonly type: 'progress';
      readonly ratio: number;
      readonly phase?: string;
      readonly message?: string;
      readonly loadedBytes?: number;
      readonly totalBytes?: number;
    }
  | { readonly type: 'warm-ready' }
  | {
      readonly type: 'probe-result';
      readonly requestId: number;
      readonly song: SongProbe | null;
      readonly cached: readonly number[];
      /** The worker holds this song's audio already (from a prefetch). */
      readonly hasAudio: boolean;
    }
  | { readonly type: 'working'; readonly jobId: number; readonly index: number | null }
  | {
      readonly type: 'chunk';
      readonly jobId: number;
      readonly index: number;
      /** Instrumental. */
      readonly left: Float32Array;
      readonly right: Float32Array;
      /** Vocals: the chunk's mix minus the instrumental, so the two stems sum to the mix. */
      readonly vocalLeft: Float32Array;
      readonly vocalRight: Float32Array;
      readonly ms: number;
      readonly residualPass: boolean;
      /** Read from the stem cache rather than separated now; its time says nothing about pace. */
      readonly cached: boolean;
    }
  | { readonly type: 'needs-audio'; readonly jobId: number }
  | { readonly type: 'complete'; readonly jobId: number }
  | { readonly type: 'error'; readonly jobId: number | null; readonly message: string };

interface Job {
  readonly id: number;
  readonly songId: string;
  readonly totalSamples: number;
  readonly mono: boolean;
  /** Dropped once every chunk is done: a whole song is tens of MB the worker no longer needs. */
  mix: StereoPcm | null;
  readonly done: Uint8Array;
  /** Chunks stored on disk and not yet sent. Filled once the cache has been read. */
  readonly cached: Set<number>;
  readonly ready: Promise<void>;
  focus: number;
  playhead: number;
  paused: boolean;
  askedForAudio: boolean;
  /** Decided from the first chunk's timing: only when the device has time for two passes. */
  residualPass: boolean | null;
}

interface Prefetch {
  readonly songId: string;
  readonly totalSamples: number;
  readonly mono: boolean;
  readonly mix: StereoPcm;
  readonly chunks: number[];
}

/** Separate the next song's opening only once the current song has this little left. */
const PREFETCH_WITHIN_CHUNKS = 6;

const scope = self as unknown as DedicatedWorkerGlobalScope;
let job: Job | null = null;
let prefetch: Prefetch | null = null;
let pumping = false;
let warmAbort = new AbortController();
let cachePromise: Promise<StemCache | null> | null = null;

function cache(): Promise<StemCache | null> {
  cachePromise ??= StemCache.open().catch(() => null);
  return cachePromise;
}

function post(message: SeparatorResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function onProgress(p: { ratio: number; phase?: string; message?: string; loadedBytes?: number; totalBytes?: number }): void {
  post({ type: 'progress', ratio: p.ratio, phase: p.phase, message: p.message, loadedBytes: p.loadedBytes, totalBytes: p.totalBytes });
}

function session(): ReturnType<typeof getSession> {
  return getSession(onProgress, warmAbort.signal);
}

/**
 * A second pass doubles the work. Only take it when two passes still leave clear
 * headroom over real time, otherwise playback would outrun separation.
 */
function canAffordResidual(singlePassMs: number): boolean {
  const hopMs = (STREAM_HOP_SAMPLES / ROFORMER_SAMPLE_RATE) * 1000;
  return singlePassMs * 2 < hopMs * 0.6;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'AI model failed';
}

type Work =
  | { readonly kind: 'cached'; readonly job: Job; readonly index: number }
  | { readonly kind: 'separate'; readonly job: Job; readonly index: number }
  | { readonly kind: 'prefetch'; readonly prefetch: Prefetch; readonly index: number };

/** The most useful cached chunk not yet sent, in the same order separation would take. */
function bestCached(j: Job): number {
  if (j.cached.size === 0) return -1;
  const mask = new Uint8Array(j.done.length);
  for (let k = 0; k < mask.length; k++) mask[k] = j.done[k] || !j.cached.has(k) ? 1 : 0;
  return nextChunk(mask, j.focus, j.playhead)?.index ?? -1;
}

function prefetchWork(j: Job): Work | null {
  const p = prefetch;
  if (!p || p.chunks.length === 0 || j.paused) return null;
  return { kind: 'prefetch', prefetch: p, index: p.chunks[0]! };
}

function pickWork(): Work | null {
  const j = job;
  if (!j || j.paused) return null;
  // A saved chunk under the playhead makes karaoke ready at once: it goes before the lead.
  if (!j.done[j.playhead] && j.cached.has(j.playhead)) return { kind: 'cached', job: j, index: j.playhead };
  const pick = nextChunk(j.done, j.focus, j.playhead);
  if (!pick) return prefetchWork(j);
  if (j.cached.has(pick.index)) return { kind: 'cached', job: j, index: pick.index };
  if (pick.urgent && j.mix) return { kind: 'separate', job: j, index: pick.index };
  // Reading a cached chunk takes a fraction of a separation: send those before any non-urgent work.
  const cachedIndex = bestCached(j);
  if (cachedIndex >= 0) return { kind: 'cached', job: j, index: cachedIndex };
  if (!j.mix) {
    if (!j.askedForAudio) {
      j.askedForAudio = true;
      post({ type: 'needs-audio', jobId: j.id });
    }
    return prefetchWork(j);
  }
  const chunksLeft = j.done.length - j.playhead;
  if (!pick.urgent && chunksLeft <= PREFETCH_WITHIN_CHUNKS) {
    const ahead = prefetchWork(j);
    if (ahead) return ahead;
  }
  return { kind: 'separate', job: j, index: pick.index };
}

async function separate(mix: StereoPcm, index: number, residualPass: boolean): Promise<{ instrumental: StereoPcm; vocals: StereoPcm; mixChunk: StereoPcm }> {
  let s = await session();
  const mixChunk = sliceChunk(mix, index);
  let out;
  try {
    out = await separateChunk(s, mixChunk, residualPass);
  } catch (err) {
    // WebGPU can build a session and still fail at run time; retry once on WASM.
    const recovered = await recoverWithWasm(onProgress);
    if (!recovered) throw err;
    s = recovered;
    out = await separateChunk(s, mixChunk, residualPass);
  }
  return { instrumental: out, vocals: subtractStereo(mixChunk, out, out.left.length), mixChunk };
}

function postChunk(j: Job, index: number, stems: { instrumental: StereoPcm; vocals: StereoPcm }, ms: number, residualPass: boolean, cached: boolean): void {
  const { instrumental, vocals } = stems;
  post(
    {
      type: 'chunk',
      jobId: j.id,
      index,
      left: instrumental.left,
      right: instrumental.right,
      vocalLeft: vocals.left,
      vocalRight: vocals.right,
      ms,
      residualPass,
      cached
    },
    [instrumental.left.buffer, instrumental.right.buffer, vocals.left.buffer, vocals.right.buffer] as ArrayBuffer[]
  );
}

async function runOnce(work: Work): Promise<void> {
  const store = await cache();
  if (work.kind === 'cached') {
    const { job: j, index } = work;
    j.cached.delete(index);
    const stems = await store?.read(j.songId, index);
    if (job !== j || !stems) return; // replaced meanwhile, or unreadable: separate it instead
    j.done[index] = 1;
    postChunk(j, index, stems, 0, false, true);
    return;
  }

  if (work.kind === 'prefetch') {
    const p = work.prefetch;
    p.chunks.shift();
    const stems = await separate(p.mix, work.index, false);
    if (prefetch === p) {
      store?.write(p.songId, work.index, stems, { totalSamples: p.totalSamples, chunkCount: streamChunkCount(p.totalSamples), mono: p.mono });
    }
    return;
  }

  const { job: j, index } = work;
  const mix = j.mix;
  if (!mix) return;
  const residualPass = j.residualPass ?? false;
  // Time the separation only: the first chunk would otherwise count the model load as pace.
  await session();
  if (job !== j) return;
  post({ type: 'working', jobId: j.id, index });
  const started = performance.now();
  const stems = await separate(mix, index, residualPass);
  const ms = performance.now() - started;
  if (job !== j) return; // cancelled or replaced while the GPU was busy
  j.done[index] = 1;
  if (j.residualPass === null) j.residualPass = canAffordResidual(ms);
  store?.write(j.songId, index, stems, { totalSamples: j.totalSamples, chunkCount: j.done.length, mono: j.mono });
  postChunk(j, index, stems, ms, residualPass, false);
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const j = job;
      if (j) await j.ready;
      if (job !== j) continue;
      const work = pickWork();
      if (!work) {
        if (j && !j.paused && j.done.every(Boolean)) {
          j.mix = null;
          post({ type: 'complete', jobId: j.id });
        }
        break;
      }
      await runOnce(work);
    }
  } catch (err) {
    if (warmAbort.signal.aborted) {
      // The listener cancelled the model load; nothing to report.
    } else {
      post({ type: 'error', jobId: job?.id ?? null, message: errorMessage(err) });
      job = null;
    }
  } finally {
    pumping = false;
    if (job) post({ type: 'working', jobId: job.id, index: null });
  }
  // A focus/resume/audio that landed during the last await may need the loop again.
  if (job && !job.paused && pickWork()) void pump();
}

function startJob(msg: Extract<SeparatorRequest, { type: 'job' }>): void {
  const done = new Uint8Array(streamChunkCount(msg.totalSamples));
  if (msg.skip) for (let k = 0; k < done.length; k++) done[k] = msg.skip[k] ? 1 : 0;
  let mix: StereoPcm | null = msg.left && msg.right ? { left: msg.left, right: msg.right } : null;
  if (!mix && prefetch?.songId === msg.songId) mix = prefetch.mix;
  if (prefetch?.songId === msg.songId) prefetch = null;
  const cached = new Set<number>();
  const ready = (async () => {
    const store = await cache();
    if (!store) return;
    const { meta, cached: stored } = await store.probe(msg.songId);
    if (meta && meta.totalSamples === msg.totalSamples) for (const k of stored) if (!done[k]) cached.add(k);
    store.touch(msg.songId);
    store.evict(msg.songId);
  })().catch(() => undefined);
  job = {
    id: msg.jobId,
    songId: msg.songId,
    totalSamples: msg.totalSamples,
    mono: msg.mono,
    mix,
    done,
    cached,
    ready,
    focus: msg.focus,
    playhead: msg.playhead,
    paused: false,
    askedForAudio: false,
    residualPass: null
  };
  void pump();
}

async function probe(requestId: number, songId: string): Promise<void> {
  const hasAudio = prefetch?.songId === songId || (job?.songId === songId && job.mix !== null);
  try {
    const store = await cache();
    const result = store ? await store.probe(songId) : { meta: null, cached: [] };
    const song = result.meta
      ? { totalSamples: result.meta.totalSamples, mono: result.meta.mono, chunkCount: result.meta.chunkCount }
      : prefetch?.songId === songId
        ? { totalSamples: prefetch.totalSamples, mono: prefetch.mono, chunkCount: streamChunkCount(prefetch.totalSamples) }
        : null;
    post({ type: 'probe-result', requestId, song, cached: result.cached, hasAudio });
  } catch {
    post({ type: 'probe-result', requestId, song: null, cached: [], hasAudio });
  }
}

scope.onmessage = (event: MessageEvent<SeparatorRequest>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'warm':
      void session()
        .then(() => post({ type: 'warm-ready' }))
        .catch((err: unknown) => {
          if (!warmAbort.signal.aborted) post({ type: 'error', jobId: null, message: errorMessage(err) });
        });
      break;
    case 'abort-warm':
      warmAbort.abort();
      warmAbort = new AbortController();
      break;
    case 'probe':
      void probe(msg.requestId, msg.songId);
      break;
    case 'job':
      startJob(msg);
      break;
    case 'audio':
      if (job?.id === msg.jobId && !job.mix) {
        job.mix = { left: msg.left, right: msg.right };
        void pump();
      }
      break;
    case 'focus':
      if (job?.id === msg.jobId) {
        job.focus = msg.chunk;
        job.playhead = msg.playhead;
      }
      break;
    case 'pause':
      if (job?.id === msg.jobId) job.paused = true;
      break;
    case 'resume':
      if (job?.id === msg.jobId) {
        job.paused = false;
        void pump();
      }
      break;
    case 'cancel':
      if (job?.id === msg.jobId) job = null;
      break;
    case 'prefetch':
      prefetch = {
        songId: msg.songId,
        totalSamples: msg.totalSamples,
        mono: msg.mono,
        mix: { left: msg.left, right: msg.right },
        chunks: [...msg.chunks]
      };
      void pump();
      break;
    case 'cancel-prefetch':
      prefetch = null;
      break;
  }
};
