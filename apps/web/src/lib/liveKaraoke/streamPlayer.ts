import type { ElementGraph } from '../audioGraph';
import { DEFAULT_KARAOKE_MIX, normalizeMix, type KaraokeMix } from '../karaokeMix';
import { ROFORMER_SAMPLE_RATE } from './roformer/config';
import { STREAM_HOP_SAMPLES } from './roformer/chunks';
import type { StereoPcm } from './roformer/stft';

/** Schedule this far ahead of "now" so a start never lands in the past. */
const LEAD_SECONDS = 0.03;
/** Keep this much instrumental queued ahead of the playhead. */
const QUEUE_AHEAD_SECONDS = 12;
/** Re-lock to the element when the two clocks disagree by more than this... */
const MAX_DRIFT_SECONDS = 0.12;
/** ...on this many ticks in a row: one coarse `currentTime` reading is not drift. */
const DRIFT_TICKS = 2;
const RAMP_SECONDS = 0.015;
/** Slider moves glide over ~20 ms (time constant) so dragging never clicks. */
const MIX_SMOOTHING_SECONDS = 0.02;
const TICK_MS = 250;
const SEGMENT_SECONDS = STREAM_HOP_SAMPLES / ROFORMER_SAMPLE_RATE;

/** One playable segment, as two stems that sum to the original. */
export interface SegmentStems {
  readonly instrumental: StereoPcm;
  readonly vocals: StereoPcm;
}

/** A segment ready to schedule. Built once per segment, not on every schedule. */
export interface SegmentBuffers {
  readonly instrumental: AudioBuffer;
  readonly vocals: AudioBuffer;
}

interface Scheduled {
  readonly nodes: readonly AudioBufferSourceNode[];
  readonly index: number;
  readonly endCtx: number;
}

export function pcmToBuffer(pcm: StereoPcm): AudioBuffer {
  const buffer = new AudioBuffer({ length: Math.max(1, pcm.left.length), numberOfChannels: 2, sampleRate: ROFORMER_SAMPLE_RATE });
  buffer.copyToChannel(pcm.left as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel(pcm.right as Float32Array<ArrayBuffer>, 1);
  return buffer;
}

/**
 * Plays the separated stems in place of the <audio> element's own sound, segment by
 * segment, as the separator produces them. Both stems of a segment start on the same
 * context tick from buffers of the same length, so they stay sample-aligned and any mix
 * of the two sounds clean.
 *
 * The element stays the clock and keeps playing its original stream: its src never
 * changes, so play/pause/seek, the progress bar and the lyrics keep working untouched.
 * Where a separated segment is ready it plays; where it is not (yet) the `fill` path
 * sounds instead (the live mid-side bridge), so the listener never hears silence and the
 * vocals stay down while the model catches up.
 */
export class KaraokeStreamPlayer {
  /** Gate: opens where a separated segment plays. Automated, so volume lives elsewhere. */
  private readonly wet: GainNode;
  /** Mirrors the element's volume and mute, which the separated path would otherwise skip. */
  private readonly volume: GainNode;
  /** Listener's stem levels. Persistent, so a slider move reaches every queued segment. */
  private readonly instrumentGain: GainNode;
  private readonly vocalGain: GainNode;
  private scheduled: Scheduled[] = [];
  /** Maps context time to song time while the chain runs: song = pos + (ctx - ctx0). */
  private anchor: { ctx0: number; pos: number } | null = null;
  private timer: number | null = null;
  private enabled = false;
  private driftTicks = 0;
  private readonly unlisten: Array<() => void> = [];

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly graph: ElementGraph,
    /** What sounds where no segment is ready: the bridge's gain. Driven opposite `wet`. */
    private readonly fill: GainNode,
    private readonly getSegment: (index: number) => SegmentBuffers | null,
    private readonly totalSeconds: number,
    initialMix: KaraokeMix = DEFAULT_KARAOKE_MIX
  ) {
    const ctx = graph.context;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.volume = ctx.createGain();
    this.instrumentGain = ctx.createGain();
    this.vocalGain = ctx.createGain();
    const mix = normalizeMix(initialMix);
    this.instrumentGain.gain.value = mix.instruments;
    this.vocalGain.gain.value = mix.vocals;
    this.instrumentGain.connect(this.wet);
    this.vocalGain.connect(this.wet);
    this.wet.connect(this.volume).connect(graph.bus);
  }

  /** Vocal and instrument levels, 0–1. Glides rather than jumps. */
  public setMix(mix: KaraokeMix): void {
    const next = normalizeMix(mix);
    const now = this.graph.context.currentTime;
    for (const [gain, value] of [
      [this.instrumentGain.gain, next.instruments],
      [this.vocalGain.gain, next.vocals]
    ] as const) {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.setTargetAtTime(value, now, MIX_SMOOTHING_SECONDS);
    }
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    const on = (type: string, fn: () => void): void => {
      this.audio.addEventListener(type, fn);
      this.unlisten.push(() => this.audio.removeEventListener(type, fn));
    };
    const halt = (): void => this.halt();
    on('pause', halt);
    on('waiting', halt);
    on('seeking', halt);
    on('emptied', halt);
    on('ended', halt);
    on('playing', () => this.relock());
    on('seeked', () => this.relock());
    on('volumechange', () => this.applyVolume());
    this.applyVolume();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.relock();
  }

  /** Stop the stems. The fill (bridge) is left sounding; the caller decides what comes next. */
  public disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const off of this.unlisten.splice(0)) off();
    this.halt();
    this.setFill(1);
  }

  public dispose(): void {
    this.disable();
    this.instrumentGain.disconnect();
    this.vocalGain.disconnect();
    this.wet.disconnect();
    this.volume.disconnect();
  }

  /** The separator finished a segment: extend the queue if it is the one we are waiting for. */
  public segmentReady(): void {
    if (this.enabled) this.topUp(false);
  }

  /** Whether separated audio exists at the current playhead. */
  public readyAtPlayhead(): boolean {
    return this.getSegment(this.segmentAt(this.audio.currentTime)) !== null;
  }

  private segmentAt(seconds: number): number {
    return Math.max(0, Math.floor(seconds / SEGMENT_SECONDS));
  }

  private playing(): boolean {
    return !this.audio.paused && !this.audio.seeking && !this.audio.ended;
  }

  private songTimeAt(ctxTime: number): number {
    const a = this.anchor;
    return a ? a.pos + (ctxTime - a.ctx0) : this.audio.currentTime;
  }

  private stopScheduled(at?: number): void {
    for (const s of this.scheduled) {
      for (const node of s.nodes) {
        try {
          node.stop(at);
        } catch {
          /* already stopped */
        }
        if (at === undefined) node.disconnect();
        else node.onended = () => node.disconnect();
      }
    }
    this.scheduled = [];
  }

  /** Stop everything queued. Mute the fill only if the stems can take over the moment playback resumes. */
  private halt(): void {
    this.stopScheduled();
    this.anchor = null;
    this.driftTicks = 0;
    const now = this.graph.context.currentTime;
    this.wet.gain.cancelScheduledValues(now);
    this.wet.gain.setValueAtTime(0, now);
    this.setFill(this.enabled && this.readyAtPlayhead() ? 0 : 1);
  }

  /** Throw the queue away and rebuild it from where the element is now. */
  private relock(): void {
    this.halt();
    if (!this.enabled || !this.playing()) return;
    const ctx = this.graph.context;
    this.anchor = { ctx0: ctx.currentTime, pos: this.audio.currentTime };
    this.topUp(false);
  }

  /**
   * Re-align after clock drift without a gap: the old chain stops on the exact tick the
   * new one starts, and the wet gate never closes.
   */
  private resync(): void {
    const ctx = this.graph.context;
    const at = ctx.currentTime + LEAD_SECONDS;
    this.stopScheduled(at);
    this.anchor = { ctx0: ctx.currentTime, pos: this.audio.currentTime };
    this.driftTicks = 0;
    this.topUp(true, at);
  }

  private topUp(continuing: boolean, startAt?: number): void {
    if (!this.enabled || !this.playing()) return;
    const ctx = this.graph.context;
    if (!this.anchor) this.anchor = { ctx0: ctx.currentTime, pos: this.audio.currentTime };

    // Drop sources that have finished.
    const now = ctx.currentTime;
    this.scheduled = this.scheduled.filter((s) => s.endCtx > now);

    const last = this.scheduled[this.scheduled.length - 1];
    let startCtx = last ? last.endCtx : (startAt ?? now + LEAD_SECONDS);
    let songPos = this.songTimeAt(startCtx);
    let index = last ? last.index + 1 : this.segmentAt(songPos);
    const chainStart = startCtx;

    while (startCtx - now < QUEUE_AHEAD_SECONDS && songPos < this.totalSeconds) {
      const segment = this.getSegment(index);
      if (!segment) break;
      const offset = Math.max(0, songPos - index * SEGMENT_SECONDS);
      if (offset >= segment.instrumental.duration) {
        index += 1;
        continue;
      }
      const nodes = (
        [
          [segment.instrumental, this.instrumentGain],
          [segment.vocals, this.vocalGain]
        ] as const
      ).map(([buffer, gain]) => {
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(gain);
        node.start(startCtx, offset);
        return node;
      });
      const endCtx = startCtx + (segment.instrumental.duration - offset);
      this.scheduled.push({ nodes, index, endCtx });
      startCtx = endCtx;
      songPos = this.songTimeAt(startCtx);
      index += 1;
    }

    const queuedUntil = this.scheduled[this.scheduled.length - 1]?.endCtx;
    if (queuedUntil === undefined) {
      // Nothing separated at the playhead: the bridge plays meanwhile.
      this.setFill(1);
      return;
    }
    // Wet on from where the chain starts; hand back to the fill where it runs out.
    const wet = this.wet.gain;
    const fill = this.fill.gain;
    const from = Math.max(now, Math.min(chainStart, this.scheduled[0]!.endCtx));
    wet.cancelScheduledValues(from);
    fill.cancelScheduledValues(from);
    if (!last && !continuing) {
      wet.setValueAtTime(0, from);
      wet.linearRampToValueAtTime(1, from + RAMP_SECONDS);
      fill.setValueAtTime(fill.value, from);
      fill.linearRampToValueAtTime(0, from + RAMP_SECONDS);
    } else if (continuing) {
      wet.setValueAtTime(1, from);
      fill.setValueAtTime(0, from);
    }
    wet.setValueAtTime(1, queuedUntil);
    wet.linearRampToValueAtTime(0, queuedUntil + RAMP_SECONDS);
    fill.setValueAtTime(0, queuedUntil);
    fill.linearRampToValueAtTime(1, queuedUntil + RAMP_SECONDS);
  }

  private tick(): void {
    if (!this.enabled || !this.playing()) return;
    if (this.scheduled.length > 0 && this.anchor) {
      const drift = this.audio.currentTime - this.songTimeAt(this.graph.context.currentTime);
      this.driftTicks = Math.abs(drift) > MAX_DRIFT_SECONDS ? this.driftTicks + 1 : 0;
      if (this.driftTicks >= DRIFT_TICKS) {
        if (process.env.NODE_ENV !== 'production') console.warn(`[karaoke] resync, drift ${drift.toFixed(3)} s`);
        this.resync();
        return;
      }
    }
    this.topUp(false);
  }

  private setFill(value: number): void {
    const now = this.graph.context.currentTime;
    const fill = this.fill.gain;
    fill.cancelScheduledValues(now);
    fill.setValueAtTime(fill.value, now);
    fill.linearRampToValueAtTime(value, now + RAMP_SECONDS);
  }

  private applyVolume(): void {
    this.volume.gain.value = this.audio.muted ? 0 : this.audio.volume;
  }
}
