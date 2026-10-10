import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createUtteranceDetector, encodeWav, resampleTo16k, rms, toBase64 } from './djSpeechCapture';

const RATE = 48_000;
/** 100 ms blocks of silence or a 0.1-amplitude tone. */
const block = (loud: boolean): Float32Array => Float32Array.from({ length: RATE / 10 }, (_, index) => (loud ? 0.1 * Math.sin(index / 5) : 0.001));

describe('createUtteranceDetector', () => {
  it('waits, records speech with a little pre-roll, and ends on silence', () => {
    const detector = createUtteranceDetector({ sampleRate: RATE, silenceMs: 500 });
    for (let index = 0; index < 5; index += 1) assert.equal(detector.push(block(false)), 'waiting');
    assert.equal(detector.push(block(true)), 'speaking');
    for (let index = 0; index < 9; index += 1) detector.push(block(true));
    let state = detector.push(block(false));
    for (let index = 0; index < 5 && state === 'speaking'; index += 1) state = detector.push(block(false));
    assert.equal(state, 'done');
    const audio = detector.take();
    // 1 s of speech, about 0.6 s of trailing quiet, and up to 0.4 s of pre-roll.
    assert.ok(audio.length > RATE * 1.4 && audio.length < RATE * 2.2, `${audio.length / RATE}s`);
  });

  it('gives up when nobody speaks', () => {
    const detector = createUtteranceDetector({ sampleRate: RATE, waitMs: 1000 });
    let state = detector.push(block(false));
    for (let index = 0; index < 12 && state === 'waiting'; index += 1) state = detector.push(block(false));
    assert.equal(state, 'silent');
  });

  it('cuts off speech that runs too long', () => {
    const detector = createUtteranceDetector({ sampleRate: RATE, maxMs: 2000 });
    let state = detector.push(block(true));
    for (let index = 0; index < 40 && state === 'speaking'; index += 1) state = detector.push(block(true));
    assert.equal(state, 'done');
    assert.ok(detector.spokenMs() <= 2200);
  });
});

describe('audio conversions', () => {
  it('resamples to 16 kHz', () => {
    const out = resampleTo16k(new Float32Array(RATE), RATE);
    assert.equal(out.length, 16_000);
    assert.equal(resampleTo16k(new Float32Array(10), 16_000).length, 10);
  });

  it('measures loudness', () => {
    assert.ok(rms(block(true)) > 0.05);
    assert.ok(rms(block(false)) < 0.005);
  });

  it('writes a valid WAV header and base64', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 16_000);
    assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
    assert.equal(String.fromCharCode(...wav.subarray(8, 12)), 'WAVE');
    assert.equal(wav.length, 44 + 6);
    assert.equal(toBase64(new Uint8Array([104, 105])), 'aGk=');
  });
});
