import assert from 'node:assert/strict';
import test from 'node:test';

import { BRIDGE_DSP, midGains, onePole } from './liveKaraoke/bridge.ts';
import { processMidSideStereo } from './liveKaraoke/midSideVocalRemove.ts';

/** An IIR filter exactly as Web Audio's IIRFilterNode runs it (feedback[0] = 1). */
function iir(input: Float32Array, coefficients: { feedforward: number[]; feedback: number[] }): Float32Array {
  const out = new Float32Array(input.length);
  const { feedforward: b, feedback: a } = coefficients;
  for (let n = 0; n < input.length; n++) {
    let y = 0;
    for (let k = 0; k < b.length; k++) y += (b[k] ?? 0) * (input[n - k] ?? 0);
    for (let k = 1; k < a.length; k++) y -= (a[k] ?? 0) * (out[n - k] ?? 0);
    out[n] = y;
  }
  return out;
}

/** The live bridge's node graph, sample by sample. */
function bridge(left: Float32Array, right: Float32Array, rate: number, mono = false): { left: Float32Array; right: Float32Array } {
  const n = left.length;
  const mid = new Float32Array(n);
  const side = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mid[i] = (left[i]! + right[i]!) * 0.5;
    side[i] = (left[i]! - right[i]!) * 0.5 * BRIDGE_DSP.sideBoost;
  }
  const low = iir(mid, onePole(BRIDGE_DSP.bassKeepHz, rate));
  const noBass = mid.map((v, i) => v - low[i]!);
  const vocal = iir(noBass, onePole(BRIDGE_DSP.airKeepHz, rate));
  const g = midGains(mono);
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m = g.low * low[i]! + g.mid * mid[i]! + g.vocal * vocal[i]!;
    // Quiet input: the soft clip is transparent, so only the make-up gain remains.
    outL[i] = (m + side[i]!) * BRIDGE_DSP.makeupGain;
    outR[i] = (m - side[i]!) * BRIDGE_DSP.makeupGain;
  }
  return { left: outL, right: outR };
}

function noise(length: number, seed: number): Float32Array {
  const out = new Float32Array(length);
  let s = seed;
  for (let i = 0; i < length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = ((s / 0xffffffff) * 2 - 1) * 0.3;
  }
  return out;
}

test('the live bridge sounds the same as the offline Basic remover', () => {
  const rate = 48_000;
  const left = noise(9_600, 1);
  const right = noise(9_600, 2);
  const live = bridge(left, right, rate);
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(left.length);
  processMidSideStereo(left, right, outL, outR, rate);
  for (let i = 0; i < left.length; i++) {
    assert.ok(Math.abs(live.left[i]! - outL[i]!) < 1e-5, `left ${i}`);
    assert.ok(Math.abs(live.right[i]! - outR[i]!) < 1e-5, `right ${i}`);
  }
});

test('a centred voice is ducked hard while bass and side stay', () => {
  const rate = 48_000;
  const n = 48_000;
  const voice = new Float32Array(n).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 1000 * i) / rate));
  const out = bridge(voice, voice, rate);
  const rms = (a: Float32Array): number => Math.sqrt(a.slice(4_800).reduce((s, v) => s + v * v, 0) / (n - 4_800));
  assert.ok(rms(out.left) < rms(voice) * 0.2, `voice left at ${(rms(out.left) / rms(voice)).toFixed(2)}`);
});

test('a mono track passes through instead of being hollowed out', () => {
  const rate = 48_000;
  const voice = noise(4_800, 3);
  const out = bridge(voice, voice, rate, true);
  for (let i = 0; i < voice.length; i++) assert.ok(Math.abs(out.left[i]! - voice[i]! * BRIDGE_DSP.makeupGain) < 1e-6);
});
