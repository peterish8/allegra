import { ROFORMER_SAMPLE_RATE } from './config';
import type { StereoPcm } from './stft';

/**
 * Packs one separated chunk (instrumental + vocals, stereo, 44.1 kHz) for the on-device
 * stem cache, and unpacks it again.
 *
 * Opus through WebCodecs where the browser can encode it (~1.4 MB per 11 s chunk at
 * 192 kbps per stem); 16-bit PCM otherwise (~3.9 MB). Opus decodes at 48 kHz and starts
 * with encoder priming, so decoding trims the measured priming and resamples back to the
 * exact 44.1 kHz chunk length, keeping cached chunks sample-aligned with fresh ones.
 */

export interface ChunkStemsPcm {
  readonly instrumental: StereoPcm;
  readonly vocals: StereoPcm;
}

const MAGIC = 0x4d545341; // "ASTM", little-endian
const VERSION = 1;
const CODEC_INT16 = 0;
const CODEC_OPUS = 1;
const HEADER_BYTES = 24;
const OPUS_BITRATE = 192_000;

/* ── Resampling ─────────────────────────────────────────────────────────── */

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

const HALF_TAPS = 16;
const tables = new Map<string, { table: Float32Array; up: number; down: number }>();

/** Windowed-sinc polyphase table for a rational rate change, one row of taps per phase. */
function polyphase(fromRate: number, toRate: number): { table: Float32Array; up: number; down: number } {
  const key = `${fromRate}:${toRate}`;
  const cached = tables.get(key);
  if (cached) return cached;
  const g = gcd(fromRate, toRate);
  const up = toRate / g;
  const down = fromRate / g;
  const cutoff = Math.min(1, toRate / fromRate) * 0.95;
  const taps = HALF_TAPS * 2;
  const table = new Float32Array(up * taps);
  for (let p = 0; p < up; p++) {
    const frac = p / up;
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const x = j - HALF_TAPS + 1 - frac;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
      const w = Math.abs(x) >= HALF_TAPS ? 0 : 0.42 + 0.5 * Math.cos((Math.PI * x) / HALF_TAPS) + 0.08 * Math.cos((2 * Math.PI * x) / HALF_TAPS);
      const h = sinc * w;
      table[p * taps + j] = h;
      sum += h;
    }
    for (let j = 0; j < taps; j++) table[p * taps + j]! /= sum;
  }
  const entry = { table, up, down };
  tables.set(key, entry);
  return entry;
}

/**
 * `outLength` samples at `toRate`, starting `skip` input samples in. Band-limited, so
 * going down from 48 kHz does not fold the top octave back into the audible range.
 */
export function resample(input: Float32Array, fromRate: number, toRate: number, outLength: number, skip = 0): Float32Array {
  const out = new Float32Array(outLength);
  if (fromRate === toRate) {
    out.set(input.subarray(skip, skip + outLength));
    return out;
  }
  const { table, up, down } = polyphase(fromRate, toRate);
  const taps = HALF_TAPS * 2;
  const last = input.length - 1;
  for (let n = 0; n < outLength; n++) {
    const pos = n * down;
    const base = skip + Math.floor(pos / up) - HALF_TAPS + 1;
    const row = (pos % up) * taps;
    let acc = 0;
    if (base >= 0 && base + taps - 1 <= last) {
      for (let j = 0; j < taps; j++) acc += input[base + j]! * table[row + j]!;
    } else {
      for (let j = 0; j < taps; j++) {
        const i = base + j;
        if (i >= 0 && i <= last) acc += input[i]! * table[row + j]!;
      }
    }
    out[n] = acc;
  }
  return out;
}

/* ── Container ──────────────────────────────────────────────────────────── */

function peakOf(stems: ChunkStemsPcm): number {
  let peak = 0;
  for (const channel of [stems.instrumental.left, stems.instrumental.right, stems.vocals.left, stems.vocals.right]) {
    for (let i = 0; i < channel.length; i++) {
      const v = Math.abs(channel[i]!);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

function header(codec: number, frames: number, gain: number, preSkipSeconds: number, extra: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(HEADER_BYTES + extra);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint8(4, VERSION);
  view.setUint8(5, codec);
  view.setUint32(8, frames, true);
  view.setFloat32(12, gain, true);
  view.setFloat32(16, preSkipSeconds, true);
  return { bytes, view };
}

/** 16-bit PCM, interleaved per stem. Scaled down first if a stem peaks above full scale. */
export function encodeInt16(stems: ChunkStemsPcm): Uint8Array {
  const frames = stems.instrumental.left.length;
  const gain = Math.max(1, peakOf(stems));
  const { bytes, view } = header(CODEC_INT16, frames, gain, 0, frames * 8);
  let at = HEADER_BYTES;
  for (const stem of [stems.instrumental, stems.vocals]) {
    for (let i = 0; i < frames; i++) {
      view.setInt16(at, Math.round((stem.left[i]! / gain) * 32767), true);
      view.setInt16(at + 2, Math.round((stem.right[i]! / gain) * 32767), true);
      at += 4;
    }
  }
  return bytes;
}

function decodeInt16(view: DataView, frames: number, gain: number): ChunkStemsPcm {
  let at = HEADER_BYTES;
  const scale = gain / 32767;
  const stem = (): StereoPcm => {
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = view.getInt16(at, true) * scale;
      right[i] = view.getInt16(at + 2, true) * scale;
      at += 4;
    }
    return { left, right };
  };
  const instrumental = stem();
  return { instrumental, vocals: stem() };
}

/* ── Opus through WebCodecs ─────────────────────────────────────────────── */

interface EncodedStem {
  readonly packets: Uint8Array[];
  readonly config: AudioDecoderConfig;
}

const encoderConfig: AudioEncoderConfig = {
  codec: 'opus',
  sampleRate: ROFORMER_SAMPLE_RATE,
  numberOfChannels: 2,
  bitrate: OPUS_BITRATE
};

async function encodeOpusStem(stem: StereoPcm): Promise<EncodedStem> {
  const frames = stem.left.length;
  const packets: Uint8Array[] = [];
  let config: AudioDecoderConfig | null = null;
  let failure: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      packets.push(bytes);
      if (meta?.decoderConfig) config = meta.decoderConfig;
    },
    error: (err) => {
      failure = err;
    }
  });
  try {
    encoder.configure(encoderConfig);
    const planar = new Float32Array(frames * 2);
    planar.set(stem.left, 0);
    planar.set(stem.right, frames);
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: ROFORMER_SAMPLE_RATE,
      numberOfFrames: frames,
      numberOfChannels: 2,
      timestamp: 0,
      data: planar
    });
    encoder.encode(data);
    data.close();
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure) throw failure instanceof Error ? failure : new Error('Opus encode failed');
  return { packets, config: config ?? { codec: 'opus', sampleRate: 48_000, numberOfChannels: 2 } };
}

async function decodeOpusStem(packets: readonly Uint8Array[], config: AudioDecoderConfig): Promise<{ left: Float32Array; right: Float32Array; rate: number }> {
  const pieces: Array<{ left: Float32Array; right: Float32Array }> = [];
  let rate = config.sampleRate;
  let failure: unknown = null;
  const decoder = new AudioDecoder({
    output: (audio) => {
      const left = new Float32Array(audio.numberOfFrames);
      const right = new Float32Array(audio.numberOfFrames);
      audio.copyTo(left, { planeIndex: 0, format: 'f32-planar' });
      audio.copyTo(right, { planeIndex: audio.numberOfChannels > 1 ? 1 : 0, format: 'f32-planar' });
      rate = audio.sampleRate;
      pieces.push({ left, right });
      audio.close();
    },
    error: (err) => {
      failure = err;
    }
  });
  try {
    decoder.configure(config);
    let timestamp = 0;
    for (const data of packets) {
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp, data }));
      timestamp += 20_000;
    }
    await decoder.flush();
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }
  if (failure) throw failure instanceof Error ? failure : new Error('Opus decode failed');
  const total = pieces.reduce((n, p) => n + p.left.length, 0);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let at = 0;
  for (const piece of pieces) {
    left.set(piece.left, at);
    right.set(piece.right, at);
    at += piece.left.length;
  }
  return { left, right, rate };
}

/**
 * How far into the decoded audio the encoded signal starts, measured once per worker by
 * encoding a tone burst at a known spot. Null when this browser cannot round-trip Opus,
 * which sends the cache to 16-bit PCM.
 */
let calibration: Promise<number | null> | null = null;

function onset(samples: Float32Array, threshold: number): number {
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]!) > threshold) return i;
  return -1;
}

async function measurePriming(): Promise<number | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined') return null;
  try {
    if (!(await AudioEncoder.isConfigSupported(encoderConfig)).supported) return null;
    const frames = Math.round(ROFORMER_SAMPLE_RATE * 0.6);
    const tone = new Float32Array(frames);
    const start = Math.round(ROFORMER_SAMPLE_RATE * 0.1);
    for (let i = start; i < start + ROFORMER_SAMPLE_RATE * 0.2; i++) tone[i] = 0.8 * Math.sin((2 * Math.PI * 1000 * (i - start)) / ROFORMER_SAMPLE_RATE);
    const encoded = await encodeOpusStem({ left: tone, right: tone });
    const decoded = await decodeOpusStem(encoded.packets, encoded.config);
    const at = onset(decoded.left, 0.4);
    if (at < 0) return null;
    const seconds = at / decoded.rate - onset(tone, 0.4) / ROFORMER_SAMPLE_RATE;
    return seconds >= 0 && seconds < 0.05 ? seconds : null;
  } catch {
    return null;
  }
}

function opusPriming(): Promise<number | null> {
  calibration ??= measurePriming();
  return calibration;
}

function writePackets(view: DataView, bytes: Uint8Array, at: number, stem: EncodedStem): number {
  view.setUint32(at, stem.packets.length, true);
  at += 4;
  for (const packet of stem.packets) {
    view.setUint32(at, packet.length, true);
    bytes.set(packet, at + 4);
    at += 4 + packet.length;
  }
  return at;
}

function readPackets(view: DataView, bytes: Uint8Array, at: number): { packets: Uint8Array[]; next: number } {
  if (at + 4 > bytes.length) throw new Error('Truncated stem file');
  const count = view.getUint32(at, true);
  at += 4;
  const packets: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const length = view.getUint32(at, true);
    // A write cut short (tab closed mid-chunk) must read as missing, not as silence.
    if (at + 4 + length > bytes.length) throw new Error('Truncated stem file');
    packets.push(bytes.slice(at + 4, at + 4 + length));
    at += 4 + length;
  }
  return { packets, next: at };
}

async function encodeOpus(stems: ChunkStemsPcm, priming: number): Promise<Uint8Array> {
  const frames = stems.instrumental.left.length;
  const gain = Math.max(1, peakOf(stems));
  const scaled = (stem: StereoPcm): StereoPcm =>
    gain === 1 ? stem : { left: stem.left.map((v) => v / gain), right: stem.right.map((v) => v / gain) };
  const instrumental = await encodeOpusStem(scaled(stems.instrumental));
  const vocals = await encodeOpusStem(scaled(stems.vocals));
  const config = instrumental.config;
  const source = config.description;
  const description = !source
    ? new Uint8Array(0)
    : ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice()
      : new Uint8Array(source).slice();
  const packetBytes = [instrumental, vocals].reduce((n, s) => n + 4 + s.packets.reduce((m, p) => m + 4 + p.length, 0), 0);
  const { bytes, view } = header(CODEC_OPUS, frames, gain, priming, 8 + description.length + packetBytes);
  view.setUint32(20, config.sampleRate, true);
  let at = HEADER_BYTES;
  view.setUint32(at, description.length, true);
  bytes.set(description, at + 4);
  at += 4 + description.length;
  at = writePackets(view, bytes, at, instrumental);
  writePackets(view, bytes, at, vocals);
  return bytes;
}

async function decodeOpus(view: DataView, bytes: Uint8Array, frames: number, gain: number, priming: number): Promise<ChunkStemsPcm> {
  const sampleRate = view.getUint32(20, true);
  let at = HEADER_BYTES;
  const descriptionLength = view.getUint32(at, true);
  const description = descriptionLength > 0 ? bytes.slice(at + 4, at + 4 + descriptionLength) : undefined;
  at += 4 + descriptionLength;
  const config: AudioDecoderConfig = { codec: 'opus', sampleRate, numberOfChannels: 2, ...(description ? { description } : {}) };
  const first = readPackets(view, bytes, at);
  const second = readPackets(view, bytes, first.next);
  const stem = async (packets: Uint8Array[]): Promise<StereoPcm> => {
    const decoded = await decodeOpusStem(packets, config);
    const skip = Math.round(priming * decoded.rate);
    if (decoded.left.length < skip + Math.floor((frames * decoded.rate) / ROFORMER_SAMPLE_RATE)) {
      throw new Error('Stem file decoded short');
    }
    const left = resample(decoded.left, decoded.rate, ROFORMER_SAMPLE_RATE, frames, skip);
    const right = resample(decoded.right, decoded.rate, ROFORMER_SAMPLE_RATE, frames, skip);
    if (gain !== 1) {
      for (let i = 0; i < frames; i++) {
        left[i]! *= gain;
        right[i]! *= gain;
      }
    }
    return { left, right };
  };
  return { instrumental: await stem(first.packets), vocals: await stem(second.packets) };
}

/* ── Public ─────────────────────────────────────────────────────────────── */

/** The smallest form this browser can store and read back exactly in time. */
export async function encodeChunkStems(stems: ChunkStemsPcm): Promise<Uint8Array> {
  const priming = await opusPriming();
  if (priming !== null) {
    try {
      return await encodeOpus(stems, priming);
    } catch {
      // A failed encode (encoder reset, memory) still caches the chunk, just larger.
    }
  }
  return encodeInt16(stems);
}

/** Inverse of `encodeChunkStems`; null for a file this version cannot read. */
export async function decodeChunkStems(bytes: Uint8Array): Promise<ChunkStemsPcm | null> {
  if (bytes.length < HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC || view.getUint8(4) !== VERSION) return null;
  const codec = view.getUint8(5);
  const frames = view.getUint32(8, true);
  const gain = view.getFloat32(12, true);
  if (codec === CODEC_INT16) return bytes.length === HEADER_BYTES + frames * 8 ? decodeInt16(view, frames, gain) : null;
  if (codec !== CODEC_OPUS) return null;
  try {
    return await decodeOpus(view, bytes, frames, gain, view.getFloat32(16, true));
  } catch {
    return null;
  }
}
