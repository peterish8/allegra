import type { StereoPcm } from './stft';
import type { SeparatorRequest, SeparatorResponse, SongProbe } from './separatorWorker';

export type { SongProbe };

export interface ChunkStems {
  readonly instrumental: StereoPcm;
  readonly vocals: StereoPcm;
}

export interface ModelLoadProgress {
  readonly ratio: number;
  readonly phase?: string;
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
}

export interface SeparatorJobHandlers {
  readonly onProgress?: (progress: ModelLoadProgress) => void;
  /** Both stems of one chunk; `instrumental + vocals` is the chunk's original mix. */
  readonly onChunk: (index: number, stems: ChunkStems, ms: number, cached: boolean) => void;
  /** The chunk the model is on now, or null when it is idle. */
  readonly onWorking?: (index: number | null) => void;
  /** The cache could not cover the rest of the song: send its audio with `provideAudio`. */
  readonly onNeedsAudio?: () => void;
  readonly onError: (message: string) => void;
}

export interface SongOnDevice {
  readonly song: SongProbe | null;
  readonly cached: readonly number[];
  readonly hasAudio: boolean;
}

export interface JobStart {
  readonly songId: string;
  readonly totalSamples: number;
  readonly mono: boolean;
  readonly focus: number;
  readonly playhead: number;
  readonly skip: Uint8Array | null;
  /** Transferred, not copied: the caller must not use it afterwards. */
  readonly audio: StereoPcm | null;
}

function transferList(pcm: StereoPcm): Transferable[] {
  return pcm.left.buffer === pcm.right.buffer ? [pcm.left.buffer as ArrayBuffer] : [pcm.left.buffer as ArrayBuffer, pcm.right.buffer as ArrayBuffer];
}

/**
 * One long-lived worker per page. The model session inside it is the expensive part, so
 * it survives toggles and song changes; only the job (one song) is replaced.
 */
class SeparatorClient {
  private readonly worker: Worker;
  private nextJobId = 1;
  private nextRequestId = 1;
  private jobId: number | null = null;
  private handlers: SeparatorJobHandlers | null = null;
  private warmState: 'idle' | 'loading' | 'ready' = 'idle';
  private readonly probes = new Map<number, (result: SongOnDevice) => void>();
  private readonly warmListeners = new Set<(progress: ModelLoadProgress) => void>();

  constructor(onCrash: () => void) {
    this.worker = new Worker(new URL('./separatorWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<SeparatorResponse>) => this.receive(event.data);
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.handlers?.onError('The karaoke engine stopped unexpectedly.');
      this.handlers = null;
      this.jobId = null;
      for (const resolve of this.probes.values()) resolve({ song: null, cached: [], hasAudio: false });
      this.probes.clear();
      this.worker.terminate();
      onCrash();
    };
  }

  public get modelReady(): boolean {
    return this.warmState === 'ready';
  }

  /** Load the model ahead of time so a later Karaoke press starts in seconds. */
  public warm(): void {
    if (this.warmState !== 'idle') return;
    this.warmState = 'loading';
    this.send({ type: 'warm' });
  }

  /** Stop a model download or build in progress. What has downloaded stays for next time. */
  public abortWarm(): void {
    if (this.warmState === 'ready') return;
    this.warmState = 'idle';
    this.send({ type: 'abort-warm' });
  }

  /** Model progress outside a job (an idle warm-up), for Settings. */
  public onWarmProgress(listener: (progress: ModelLoadProgress) => void): () => void {
    this.warmListeners.add(listener);
    return () => this.warmListeners.delete(listener);
  }

  /** What this device already has for a song: cached chunks, and whether its audio is held. */
  public probe(songId: string): Promise<SongOnDevice> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      this.probes.set(requestId, resolve);
      this.send({ type: 'probe', requestId, songId });
    });
  }

  public startJob(start: JobStart, handlers: SeparatorJobHandlers): number {
    if (this.jobId !== null) this.send({ type: 'cancel', jobId: this.jobId });
    const jobId = this.nextJobId++;
    this.jobId = jobId;
    this.handlers = handlers;
    const { audio, ...rest } = start;
    this.send(
      { type: 'job', jobId, ...rest, left: audio?.left ?? null, right: audio?.right ?? null },
      audio ? transferList(audio) : []
    );
    return jobId;
  }

  /** The song's audio for a job started without it. Transferred. */
  public provideAudio(jobId: number, audio: StereoPcm): void {
    if (jobId !== this.jobId) return;
    this.send({ type: 'audio', jobId, left: audio.left, right: audio.right }, transferList(audio));
  }

  public focus(jobId: number, chunk: number, playhead: number): void {
    if (jobId === this.jobId) this.send({ type: 'focus', jobId, chunk, playhead });
  }

  public pause(jobId: number): void {
    if (jobId === this.jobId) this.send({ type: 'pause', jobId });
  }

  public resume(jobId: number, handlers: SeparatorJobHandlers): boolean {
    if (jobId !== this.jobId) return false;
    this.handlers = handlers;
    this.send({ type: 'resume', jobId });
    return true;
  }

  public cancel(jobId: number): void {
    if (jobId !== this.jobId) return;
    this.send({ type: 'cancel', jobId });
    this.jobId = null;
    this.handlers = null;
  }

  /** Separate the opening of the next song into the cache while this one plays. Transferred. */
  public prefetch(songId: string, totalSamples: number, mono: boolean, audio: StereoPcm, chunks: readonly number[]): void {
    this.send({ type: 'prefetch', songId, totalSamples, mono, left: audio.left, right: audio.right, chunks }, transferList(audio));
  }

  public cancelPrefetch(): void {
    this.send({ type: 'cancel-prefetch' });
  }

  private send(message: SeparatorRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }

  private receive(msg: SeparatorResponse): void {
    switch (msg.type) {
      case 'progress': {
        const progress = { ratio: msg.ratio, phase: msg.phase, loadedBytes: msg.loadedBytes, totalBytes: msg.totalBytes };
        this.handlers?.onProgress?.(progress);
        for (const listener of this.warmListeners) listener(progress);
        if (msg.phase === 'ready') this.warmState = 'ready';
        break;
      }
      case 'warm-ready':
        this.warmState = 'ready';
        break;
      case 'probe-result': {
        const resolve = this.probes.get(msg.requestId);
        this.probes.delete(msg.requestId);
        resolve?.({ song: msg.song, cached: msg.cached, hasAudio: msg.hasAudio });
        break;
      }
      case 'working':
        if (msg.jobId === this.jobId) this.handlers?.onWorking?.(msg.index);
        break;
      case 'chunk':
        if (msg.jobId === this.jobId) {
          this.handlers?.onChunk(
            msg.index,
            {
              instrumental: { left: msg.left, right: msg.right },
              vocals: { left: msg.vocalLeft, right: msg.vocalRight }
            },
            msg.ms,
            msg.cached
          );
        }
        break;
      case 'needs-audio':
        if (msg.jobId === this.jobId) this.handlers?.onNeedsAudio?.();
        break;
      case 'complete':
        break;
      case 'error':
        if (msg.jobId === null) this.warmState = 'idle';
        if (msg.jobId === null || msg.jobId === this.jobId) {
          this.handlers?.onError(msg.message);
          if (msg.jobId !== null) {
            this.jobId = null;
            this.handlers = null;
          }
        }
        break;
    }
  }
}

let shared: SeparatorClient | null = null;

/** The page's separator; throws if workers are unavailable (caller falls back). */
export function getSeparator(): SeparatorClient {
  if (!shared) {
    shared = new SeparatorClient(() => {
      shared = null;
    });
  }
  return shared;
}

/** The separator if one has started this page, without starting one. */
export function existingSeparator(): SeparatorClient | null {
  return shared;
}

export type { SeparatorClient };
