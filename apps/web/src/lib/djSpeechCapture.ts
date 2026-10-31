/**
 * Turning a microphone into one spoken request, without any speech service: a small voice-activity
 * detector over loudness, plus the conversions the recognisers need (16 kHz mono for Whisper on the
 * device, a WAV file for a cloud transcriber). Pure, so it can be checked without a microphone.
 */

/** Whisper listens at this rate. */
export const SPEECH_RATE = 16_000;

export interface UtteranceOptions {
  readonly sampleRate: number;
  /** Loudness (RMS) above this starts speech… */
  readonly startLevel?: number;
  /** …and below this, for `silenceMs`, ends it. */
  readonly stopLevel?: number;
  readonly silenceMs?: number;
  /** Speech that runs this long is cut off here. */
  readonly maxMs?: number;
  /** Nobody spoke within this long: give up. */
  readonly waitMs?: number;
  /** Audio kept from just before speech started, so the first syllable is not lost. */
  readonly preRollMs?: number;
}

export type UtteranceState = 'waiting' | 'speaking' | 'done' | 'silent';

export interface UtteranceDetector {
  /** Feeds one block of samples (-1..1). Returns where the utterance stands after it. */
  readonly push: (block: Float32Array) => UtteranceState;
  /** The utterance so far (pre-roll included), at the input's sample rate. */
  readonly take: () => Float32Array;
  /** Milliseconds of speech captured so far. */
  readonly spokenMs: () => number;
}

export function rms(block: Float32Array): number {
  if (block.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < block.length; index += 1) {
    const value = block[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / block.length);
}

export function createUtteranceDetector(options: UtteranceOptions): UtteranceDetector {
  const {
    sampleRate,
    startLevel = 0.025,
    stopLevel = 0.014,
    silenceMs = 1100,
    maxMs = 12_000,
    waitMs = 8000,
    preRollMs = 350
  } = options;
  const msOf = (samples: number): number => (samples / sampleRate) * 1000;

  let state: UtteranceState = 'waiting';
  let preRoll: Float32Array[] = [];
  let preRollSamples = 0;
  let speech: Float32Array[] = [];
  let speechSamples = 0;
  let waitedSamples = 0;
  let quietSamples = 0;

  const push = (block: Float32Array): UtteranceState => {
    if (state === 'done' || state === 'silent') return state;
    const level = rms(block);
    if (state === 'waiting') {
      waitedSamples += block.length;
      preRoll.push(block);
      preRollSamples += block.length;
      while (preRoll.length > 1 && msOf(preRollSamples - (preRoll[0]?.length ?? 0)) >= preRollMs) {
        preRollSamples -= preRoll[0]?.length ?? 0;
        preRoll = preRoll.slice(1);
      }
      if (level >= startLevel) {
        state = 'speaking';
        speech = [...preRoll];
        speechSamples = preRollSamples;
        preRoll = [];
        preRollSamples = 0;
      } else if (msOf(waitedSamples) >= waitMs) {
        state = 'silent';
      }
      return state;
    }
    speech.push(block);
    speechSamples += block.length;
    quietSamples = level < stopLevel ? quietSamples + block.length : 0;
    if (msOf(quietSamples) >= silenceMs || msOf(speechSamples) >= maxMs) state = 'done';
    return state;
  };

  const take = (): Float32Array => {
    const out = new Float32Array(speechSamples);
    let at = 0;
    for (const block of speech) {
      out.set(block, at);
      at += block.length;
    }
    return out;
  };

  return { push, take, spokenMs: () => msOf(speechSamples) };
}

/** Linear resampling to 16 kHz. Good enough for speech, and free of any audio API. */
export function resampleTo16k(samples: Float32Array, fromRate: number): Float32Array {
  if (fromRate === SPEECH_RATE) return samples;
  const ratio = fromRate / SPEECH_RATE;
  const length = Math.max(0, Math.floor(samples.length / ratio));
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const t = position - left;
    out[index] = (samples[left] ?? 0) * (1 - t) + (samples[right] ?? 0) * t;
  }
  return out;
}

/** A 16-bit mono PCM WAV file, as bytes. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(at + index, value.charCodeAt(index));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return bytes;
}

/** Bytes as base64, in chunks so a long recording never overflows the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
