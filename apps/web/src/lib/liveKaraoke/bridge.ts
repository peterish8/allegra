import type { ElementGraph } from '../audioGraph';

/**
 * Live vocal reduction in the Web Audio graph: the same bass-preserving mid-side remover
 * as `midSideVocalRemove.ts`, built from nodes so it works on the element's own audio the
 * moment Karaoke is pressed. No download, no render, no source swap.
 *
 * It bridges every stretch the AI model has not separated yet (and is all of Basic mode):
 *
 *   source → upmix → split → mid ─ low-pass(200 Hz) ─┬─ keep bass
 *                          │       └ band(200 Hz–5.2 kHz) duck vocals, keep air
 *                          └ side × 1.22
 *          → L = mid + side, R = mid − side → soft clip → bridge gain → bus
 */

/** Same defaults as the offline remover, so Basic sounds the same whichever path runs. */
export const BRIDGE_DSP = {
  bassKeepHz: 200,
  airKeepHz: 5200,
  /** Vocal-band mid left in: 1 − midAttenuation (0.95). */
  vocalKeep: 0.05,
  airKeep: 0.55,
  sideBoost: 1.22,
  makeupGain: 1.08
} as const;

/** The offline remover's one-pole low-pass `y += a (x − y)` as IIR coefficients. */
export function onePole(cutoffHz: number, sampleRate: number): { readonly feedforward: number[]; readonly feedback: number[] } {
  const dt = 1 / sampleRate;
  const a = dt / (1 / (2 * Math.PI * cutoffHz) + dt);
  return { feedforward: [a], feedback: [1, -(1 - a)] };
}

/**
 * Gains on the three mid paths. The offline remover computes
 * `midLow + vocalKeep·midVocal + airKeep·midAir`; with `midAir = (mid − midLow) − midVocal`
 * that is `(1 − airKeep)·midLow + airKeep·mid + (vocalKeep − airKeep)·midVocal`, which needs
 * only two filters. Mono has no side to keep, so it passes the mid through untouched.
 */
export function midGains(mono: boolean): { readonly low: number; readonly mid: number; readonly vocal: number } {
  if (mono) return { low: 0, mid: 1, vocal: 0 };
  return { low: 1 - BRIDGE_DSP.airKeep, mid: BRIDGE_DSP.airKeep, vocal: BRIDGE_DSP.vocalKeep - BRIDGE_DSP.airKeep };
}

function softClip(x: number): number {
  if (x > 1) return 1 - Math.exp(1 - x);
  if (x < -1) return -1 + Math.exp(1 + x);
  return x;
}

/** The shaper reads input in [−1, 1]; the signal is halved first so the curve covers ±2. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) curve[i] = softClip(((i / (curve.length - 1)) * 2 - 1) * 2);
  return curve;
}

export class KaraokeBridge {
  /** What the bridge adds to the bus. Karaoke drives it opposite the separated stems. */
  public readonly gain: GainNode;
  private readonly input: GainNode;
  private readonly low: GainNode;
  private readonly mid: GainNode;
  private readonly vocal: GainNode;
  private readonly midProbe: AnalyserNode;
  private readonly sideProbe: AnalyserNode;
  private attached = false;

  constructor(private readonly graph: ElementGraph) {
    const ctx = graph.context;
    const node = (value: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    };
    // A mono element would reach the splitter as one channel: upmix so L = R.
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';
    const split = ctx.createChannelSplitter(2);
    this.input.connect(split);

    const midSum = node(0.5);
    split.connect(midSum, 0);
    split.connect(midSum, 1);
    const invertRight = node(-1);
    split.connect(invertRight, 1);
    const side = node(0.5 * BRIDGE_DSP.sideBoost);
    split.connect(side, 0);
    invertRight.connect(side);
    this.midProbe = ctx.createAnalyser();
    this.sideProbe = ctx.createAnalyser();
    this.midProbe.fftSize = this.sideProbe.fftSize = 2048;
    midSum.connect(this.midProbe);
    side.connect(this.sideProbe);

    const bass = onePole(BRIDGE_DSP.bassKeepHz, ctx.sampleRate);
    const air = onePole(BRIDGE_DSP.airKeepHz, ctx.sampleRate);
    const midLow = ctx.createIIRFilter(bass.feedforward, bass.feedback);
    midSum.connect(midLow);
    const noBass = node(1);
    midSum.connect(noBass);
    const subtractLow = node(-1);
    midLow.connect(subtractLow).connect(noBass);
    const midVocal = ctx.createIIRFilter(air.feedforward, air.feedback);
    noBass.connect(midVocal);

    const gains = midGains(false);
    this.low = node(gains.low);
    this.mid = node(gains.mid);
    this.vocal = node(gains.vocal);
    const midOut = node(1);
    midLow.connect(this.low).connect(midOut);
    midSum.connect(this.mid).connect(midOut);
    midVocal.connect(this.vocal).connect(midOut);

    const left = node(1);
    const right = node(1);
    const invertSide = node(-1);
    midOut.connect(left);
    midOut.connect(right);
    side.connect(left);
    side.connect(invertSide).connect(right);

    const merge = ctx.createChannelMerger(2);
    left.connect(merge, 0, 0);
    right.connect(merge, 0, 1);
    const pre = node(0.5 * BRIDGE_DSP.makeupGain);
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    this.gain = node(0);
    merge.connect(pre).connect(clip).connect(this.gain).connect(graph.bus);
  }

  /** Mono sources have no side channel: pass them through instead of hollowing them out. */
  public setMono(mono: boolean): void {
    const gains = midGains(mono);
    const now = this.graph.context.currentTime;
    this.low.gain.setValueAtTime(gains.low, now);
    this.mid.gain.setValueAtTime(gains.mid, now);
    this.vocal.gain.setValueAtTime(gains.vocal, now);
  }

  /**
   * Listen to the element for a moment: a mono recording has no side signal at all. Only
   * windows with sound count, so a quiet intro or a pause cannot pass for mono. Resolves
   * 'unknown' if not enough sound arrives within `timeoutMs`.
   */
  public measureStereo(signal: AbortSignal, timeoutMs = 8000): Promise<'mono' | 'stereo' | 'unknown'> {
    return new Promise((resolve) => {
      const mid = new Float32Array(this.midProbe.fftSize);
      const side = new Float32Array(this.sideProbe.fftSize);
      let midEnergy = 0;
      let sideEnergy = 0;
      let windows = 0;
      const started = performance.now();
      const timer = window.setInterval(() => {
        if (signal.aborted) return finish('unknown');
        this.midProbe.getFloatTimeDomainData(mid);
        this.sideProbe.getFloatTimeDomainData(side);
        let m = 0;
        let s = 0;
        for (let i = 0; i < mid.length; i++) {
          m += mid[i]! * mid[i]!;
          s += side[i]! * side[i]!;
        }
        if (m / mid.length > 1e-6) {
          midEnergy += m;
          sideEnergy += s;
          windows += 1;
        }
        if (windows >= 10) return finish(sideEnergy < midEnergy * 1e-4 ? 'mono' : 'stereo');
        if (performance.now() - started > timeoutMs) finish('unknown');
      }, 100);
      const finish = (result: 'mono' | 'stereo' | 'unknown'): void => {
        window.clearInterval(timer);
        resolve(result);
      };
    });
  }

  /** Feed the element into the bridge. Only while karaoke is on, so it costs nothing otherwise. */
  public attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.graph.source.connect(this.input);
  }

  public detach(): void {
    if (!this.attached) return;
    this.attached = false;
    try {
      this.graph.source.disconnect(this.input);
    } catch {
      // Already disconnected.
    }
  }
}

const bridges = new WeakMap<ElementGraph, KaraokeBridge>();

/** The element's one bridge, built on first use. */
export function ensureBridge(graph: ElementGraph): KaraokeBridge {
  let bridge = bridges.get(graph);
  if (!bridge) {
    bridge = new KaraokeBridge(graph);
    bridges.set(graph, bridge);
  }
  return bridge;
}
