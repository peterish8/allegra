import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeChunkStems, encodeChunkStems, encodeInt16, resample } from './liveKaraoke/roformer/stemCodec.ts';
import type { StereoPcm } from './liveKaraoke/roformer/stft.ts';

function tone(rate: number, length: number, hz: number, phase = 0, amplitude = 0.5): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate + phase);
  return out;
}

function stems(length: number): { instrumental: StereoPcm; vocals: StereoPcm } {
  return {
    instrumental: { left: tone(44_100, length, 220), right: tone(44_100, length, 330) },
    vocals: { left: tone(44_100, length, 440, 1), right: tone(44_100, length, 550, 2) }
  };
}

function maxError(a: Float32Array, b: Float32Array, from = 0, to = a.length): number {
  let worst = 0;
  for (let i = from; i < to; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  return worst;
}

test('resampling 48 kHz to 44.1 kHz keeps a tone in time and in level', () => {
  const input = tone(48_000, 48_000, 1000);
  const out = resample(input, 48_000, 44_100, 44_100);
  const expected = tone(44_100, 44_100, 1000);
  // Away from the edges the result is the same tone sampled at the new rate.
  assert.ok(maxError(out, expected, 100, 44_000) < 0.01, `error ${maxError(out, expected, 100, 44_000)}`);
});

test('resampling with a skip drops exactly that much leading audio (Opus priming)', () => {
  const priming = 312;
  const shifted = new Float32Array(48_000 + priming);
  shifted.set(tone(48_000, 48_000, 700), priming);
  const out = resample(shifted, 48_000, 44_100, 40_000, priming);
  assert.ok(maxError(out, tone(44_100, 40_000, 700), 100, 39_900) < 0.01);
});

test('content above the new Nyquist is filtered out instead of folding back', () => {
  // 23 kHz exists at 48 kHz but not at 44.1 kHz: it must come out near silent.
  const out = resample(tone(48_000, 48_000, 23_000), 48_000, 44_100, 44_100);
  assert.ok(maxError(out, new Float32Array(44_100), 200, 43_900) < 0.05);
});

test('equal rates copy the samples', () => {
  const input = tone(44_100, 1000, 300);
  assert.deepEqual(resample(input, 44_100, 44_100, 500, 10), input.slice(10, 510));
});

test('a 16-bit chunk round-trips to within one quantisation step', async () => {
  const original = stems(4_410);
  const decoded = await decodeChunkStems(encodeInt16(original));
  assert.ok(decoded);
  for (const key of ['instrumental', 'vocals'] as const) {
    assert.ok(maxError(decoded[key].left, original[key].left) < 1 / 30_000);
    assert.ok(maxError(decoded[key].right, original[key].right) < 1 / 30_000);
  }
});

test('a stem peaking above full scale is scaled, not clipped', async () => {
  const original = stems(1_000);
  original.instrumental.left[10] = 1.7;
  const decoded = await decodeChunkStems(encodeInt16(original));
  assert.ok(decoded);
  assert.ok(Math.abs(decoded.instrumental.left[10]! - 1.7) < 1e-3);
});

test('without WebCodecs (Node) the cache falls back to 16-bit PCM', async () => {
  const original = stems(2_000);
  const bytes = await encodeChunkStems(original);
  assert.equal(bytes.length, 24 + 2_000 * 8);
  assert.ok(await decodeChunkStems(bytes));
});

test('unknown or damaged files read as missing, never as noise', async () => {
  assert.equal(await decodeChunkStems(new Uint8Array(10)), null);
  const bytes = encodeInt16(stems(100));
  assert.equal(await decodeChunkStems(bytes.slice(0, bytes.length - 4)), null);
  bytes[0] = 0;
  assert.equal(await decodeChunkStems(bytes), null);
});
