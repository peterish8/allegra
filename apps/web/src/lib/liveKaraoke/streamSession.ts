import type { ElementGraph } from '../audioGraph';
import type { KaraokeMix } from '../karaokeMix';
import {
  assembleSegment,
  catchUpChunk,
  chunkIndexAt,
  chunkTail,
  crossfadeHead,
  STREAM_HOP_SAMPLES,
  streamChunkCount
} from './roformer/chunks';
import { paceIsMeasurable } from './device';
import { ROFORMER_SAMPLE_RATE } from './roformer/config';
import { getSeparator, type ChunkStems, type ModelLoadProgress, type SeparatorJobHandlers } from './roformer/separatorClient';
import type { StereoPcm } from './roformer/stft';
import { KaraokeStreamPlayer, pcmToBuffer, type SegmentBuffers, type SegmentStems } from './streamPlayer';

/**
 * How often readiness at the playhead is checked and the separator re-aimed. Playback
 * alone moves the playhead into (or out of) a ready segment, so this cannot wait for chunk events.
 */
const TICK_MS = 500;
const HOP_SECONDS = STREAM_HOP_SAMPLES / ROFORMER_SAMPLE_RATE;
const HOP_MS = HOP_SECONDS * 1000;
/** First guess at one chunk's separation time, before any has been measured. */
const INITIAL_CHUNK_MS = 8000;
/** Aim a little past the estimate: landing just short costs a whole extra chunk. */
const LEAD_MARGIN_MS = 1500;
/**
 * Separation has to outrun playback. The first chunk also pays for shader compilation,
 * so it gets more room; the second is the honest measure.
 */
const MAX_FIRST_CHUNK_MS = HOP_MS * 2.5;
const MAX_CHUNK_MS = HOP_MS * 0.95;
/** Separated audio this far ahead of the playhead counts as safe: time to prepare the next song. */
const COMFORTABLE_CHUNKS = 3;

/** When the tab was last hidden: chunks that ran across it are not timed (see `paceIsMeasurable`). */
let lastHiddenAt = -Infinity;
if (typeof document !== 'undefined') {
  if (document.hidden) lastHiddenAt = performance.now();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lastHiddenAt = performance.now();
  });
}

export interface StreamSessionEvents {
  /** Model download / session build. */
  readonly onModelProgress: (progress: ModelLoadProgress) => void;
  /** Separated audio became available (true) or ran out (false) where the listener is. */
  readonly onReadinessChange: (ready: boolean) => void;
  /** A chunk arrived or the model moved to another one: redraw the coverage. */
  readonly onCoverage: () => void;
  /** Once, after two separated chunks: this device separates faster than the song plays. */
  readonly onKeepingUp: () => void;
  /** Once: separation is slower than playback, so most of the song would keep its vocals. */
  readonly onTooSlow: () => void;
  /** The cache cannot cover the rest of the song: call `provideAudio`. */
  readonly onNeedsAudio: () => void;
  readonly onError: (message: string) => void;
}

export interface StreamSong {
  readonly songId: string;
  readonly totalSamples: number;
  readonly mono: boolean;
}

interface Segment {
  /** Kept only while its head may still be blended with a late predecessor. */
  stems: SegmentStems | null;
  /** Built once the segment is final; scheduling reuses them. */
  buffers: SegmentBuffers | null;
  /** False while its head is chunk k's raw output, waiting for chunk k - 1's tail. */
  blended: boolean;
}

interface Tail {
  readonly instrumental: StereoPcm;
  readonly vocals: StereoPcm;
}

/**
 * One song's live karaoke: separated chunks arrive from the worker (fresh, or from the
 * on-device cache), get stitched into playable segments, and the stream player swaps them
 * in over the bridge. Each segment keeps both stems (instrumental and vocals) so the
 * listener can mix them.
 *
 * Turning karaoke off pauses the separator but keeps what is done. Changing song parks the
 * session (its job ends, its segments stay), so coming back to the song is instant.
 */
export class LiveKaraokeStream {
  public readonly song: StreamSong;
  private readonly segments = new Map<number, Segment>();
  private readonly tails = new Map<number, Tail>();
  private readonly player: KaraokeStreamPlayer;
  private readonly chunkCount: number;
  private jobId: number | null = null;
  private timer: number | null = null;
  private chunksTimed = 0;
  /** Smoothed separation time per chunk: how far ahead of the playhead to aim. */
  private chunkMs = INITIAL_CHUNK_MS;
  private wasReady: boolean | null = null;
  private working: { index: number; since: number } | null = null;
  private lastFocus: { chunk: number; playhead: number } | null = null;
  private readonly onSeeking = (): void => this.tick();
  private disposed = false;

  constructor(
    private readonly audio: HTMLAudioElement,
    graph: ElementGraph,
    fill: GainNode,
    song: StreamSong,
    private events: StreamSessionEvents,
    initialMix?: KaraokeMix
  ) {
    this.song = song;
    this.chunkCount = streamChunkCount(song.totalSamples);
    this.player = new KaraokeStreamPlayer(
      audio,
      graph,
      fill,
      (index) => this.buffersFor(index),
      song.totalSamples / ROFORMER_SAMPLE_RATE,
      initialMix
    );
  }

  /** A new press on a kept session: its events now belong to that press. */
  public rebind(events: StreamSessionEvents): void {
    this.events = events;
  }

  /** Live vocal / instrument levels; takes effect within a few milliseconds. */
  public setMix(mix: KaraokeMix): void {
    this.player.setMix(mix);
  }

  public get enabled(): boolean {
    return this.player.isEnabled;
  }

  public readyAtPlayhead(): boolean {
    return this.player.readyAtPlayhead();
  }

  public get complete(): boolean {
    return this.segments.size >= this.chunkCount;
  }

  /** Which segments exist, and which one the model is on: what the seek bar draws. */
  public coverage(): { readonly ready: Uint8Array; readonly working: number | null; readonly segmentSeconds: number } {
    const ready = new Uint8Array(this.chunkCount);
    for (const index of this.segments.keys()) if (index < ready.length) ready[index] = 1;
    return { ready, working: this.working?.index ?? null, segmentSeconds: HOP_SECONDS };
  }

  /** Separated segments in a row from the playhead on. */
  public readyAhead(): number {
    let count = 0;
    for (let k = chunkIndexAt(this.audio.currentTime, this.song.totalSamples); k < this.chunkCount && this.segments.has(k); k++) count += 1;
    return count;
  }

  /** Enough is separated ahead that the next song can be prepared without risking this one. */
  public comfortable(): boolean {
    return this.complete || (this.chunksTimed >= 2 && this.readyAhead() >= COMFORTABLE_CHUNKS);
  }

  /**
   * Seconds until separated audio plays at the playhead: the time to the next ready
   * segment ahead, or until the chunk being separated lands. 0 when ready, null when unknown.
   */
  public etaSeconds(): number | null {
    if (this.readyAtPlayhead()) return 0;
    const now = this.audio.currentTime;
    const p = chunkIndexAt(now, this.song.totalSamples);
    const moving = !this.audio.paused;
    const candidates: number[] = [];
    if (moving) {
      for (let k = p + 1; k < this.chunkCount; k++) {
        if (this.segments.has(k)) {
          candidates.push(k * HOP_SECONDS - now);
          break;
        }
      }
    }
    const w = this.working;
    if (w && (w.index === p || (moving && w.index > p))) {
      const remaining = Math.max(0.5, (this.chunkMs - (performance.now() - w.since)) / 1000);
      candidates.push(w.index === p ? remaining : Math.max(remaining, w.index * HOP_SECONDS - now));
    }
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }

  /**
   * Start (or resume) separating. `audio` is the song's mix, transferred to the worker;
   * pass null when the cache is expected to cover the song, and `provideAudio` if asked.
   */
  public enable(audio: StereoPcm | null): void {
    if (this.disposed) return;
    const separator = getSeparator();
    const handlers = this.handlers();
    if (this.jobId === null || !separator.resume(this.jobId, handlers)) {
      const skip = new Uint8Array(this.chunkCount);
      for (const index of this.segments.keys()) if (index < skip.length) skip[index] = 1;
      const focus = this.focus();
      this.jobId = separator.startJob(
        { ...this.song, focus: focus.chunk, playhead: focus.playhead, skip, audio },
        handlers
      );
      this.lastFocus = focus;
    }
    this.audio.addEventListener('seeking', this.onSeeking);
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.player.enable();
    this.wasReady = null;
    this.checkReady();
  }

  public provideAudio(audio: StereoPcm): void {
    if (this.jobId !== null) getSeparator().provideAudio(this.jobId, audio);
  }

  /** Stop playing the stems and pause the separator; what is done stays. */
  public disable(): void {
    this.audio.removeEventListener('seeking', this.onSeeking);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.jobId !== null) getSeparator().pause(this.jobId);
    this.player.disable();
    this.working = null;
  }

  /** Song changed: end the job but keep the segments, in case the listener comes back. */
  public park(): void {
    this.disable();
    if (this.jobId !== null) getSeparator().cancel(this.jobId);
    this.jobId = null;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.park();
    this.player.dispose();
    this.segments.clear();
    this.tails.clear();
    this.disposed = true;
  }

  private handlers(): SeparatorJobHandlers {
    return {
      onProgress: (progress) => this.events.onModelProgress(progress),
      onChunk: (index, stems, ms, cached) => {
        if (this.disposed) return;
        this.store(index, stems);
        if (!cached) {
          this.judgePace(ms);
          this.chunkMs = this.chunkMs * 0.5 + ms * 0.5;
          if (this.working?.index === index) this.working = null;
        }
        this.player.segmentReady();
        this.checkReady();
        this.events.onCoverage();
      },
      onWorking: (index) => {
        this.working = index === null ? null : { index, since: performance.now() };
        this.events.onCoverage();
      },
      onNeedsAudio: () => this.events.onNeedsAudio(),
      onError: (message) => {
        if (!this.disposed) this.events.onError(message);
      }
    };
  }

  private buffersFor(index: number): SegmentBuffers | null {
    const segment = this.segments.get(index);
    if (!segment) return null;
    if (segment.buffers) return segment.buffers;
    // Still waiting for its predecessor's tail: a one-off build, redone once it is blended.
    const stems = segment.stems!;
    return { instrumental: pcmToBuffer(stems.instrumental), vocals: pcmToBuffer(stems.vocals) };
  }

  private finalize(segment: Segment): void {
    const stems = segment.stems;
    if (!stems) return;
    segment.buffers = { instrumental: pcmToBuffer(stems.instrumental), vocals: pcmToBuffer(stems.vocals) };
    segment.stems = null;
  }

  /** Keep only what playback needs: the segment itself and the tail its successor blends in. */
  private store(index: number, chunk: ChunkStems): void {
    if (this.segments.has(index)) return;
    const total = this.song.totalSamples;
    const prevTail = this.tails.get(index - 1) ?? null;
    // Without a stored tail, a predecessor already final can no longer lend one: play this head as is.
    const prevFinal = index > 0 && !prevTail && this.segments.get(index - 1)?.buffers;
    const segment: Segment = {
      stems: {
        instrumental: assembleSegment(index, total, chunk.instrumental, prevTail?.instrumental ?? null),
        vocals: assembleSegment(index, total, chunk.vocals, prevTail?.vocals ?? null)
      },
      buffers: null,
      blended: index === 0 || prevTail !== null || Boolean(prevFinal)
    };
    this.segments.set(index, segment);
    if (prevTail) this.tails.delete(index - 1);
    if (segment.blended) this.finalize(segment);

    const next = this.segments.get(index + 1);
    if (next && !next.blended && next.stems) {
      // Its predecessor arrived late (it was separated first after a seek): finish its crossfade.
      // The crossfade is linear, so blending each stem keeps their sum equal to the blended mix.
      crossfadeHead(next.stems.instrumental, chunkTail(chunk.instrumental));
      crossfadeHead(next.stems.vocals, chunkTail(chunk.vocals));
      next.blended = true;
      this.finalize(next);
    } else if (!next && index + 1 < this.chunkCount) {
      this.tails.set(index, { instrumental: chunkTail(chunk.instrumental), vocals: chunkTail(chunk.vocals) });
    }
  }

  private judgePace(ms: number): void {
    if (this.chunksTimed >= 2) return;
    if (!paceIsMeasurable(document.hidden, lastHiddenAt, performance.now() - ms)) return;
    this.chunksTimed += 1;
    const limit = this.chunksTimed === 1 ? MAX_FIRST_CHUNK_MS : MAX_CHUNK_MS;
    if (ms > limit) {
      this.chunksTimed = 2;
      this.events.onTooSlow();
    } else if (this.chunksTimed === 2) {
      this.events.onKeepingUp();
    }
  }

  /**
   * Where the separator should work next. With separated audio at the playhead, straight
   * on from there. Without it, the first chunk that will still be ahead of the listener
   * when it lands and leaves time for the next one (see `catchUpChunk`).
   */
  private focus(): { chunk: number; playhead: number } {
    const now = this.audio.currentTime;
    const playhead = chunkIndexAt(now, this.song.totalSamples);
    if (this.audio.paused || this.player.readyAtPlayhead()) return { chunk: playhead, playhead };
    const chunkSeconds = this.chunkMs / 1000;
    const arriveAt = now + chunkSeconds + LEAD_MARGIN_MS / 1000;
    return { chunk: catchUpChunk(arriveAt, chunkSeconds, this.song.totalSamples), playhead };
  }

  private tick(): void {
    this.refocus();
    this.checkReady();
  }

  /** Report each change between "separated audio here" and "bridge here". */
  private checkReady(): void {
    const ready = this.player.readyAtPlayhead();
    if (ready !== this.wasReady) {
      this.wasReady = ready;
      this.events.onReadinessChange(ready);
    }
  }

  private refocus(): void {
    if (this.jobId === null) return;
    const next = this.focus();
    if (this.lastFocus && this.lastFocus.chunk === next.chunk && this.lastFocus.playhead === next.playhead) return;
    this.lastFocus = next;
    getSeparator().focus(this.jobId, next.chunk, next.playhead);
  }
}
