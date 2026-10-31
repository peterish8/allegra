import type { LyricsWordTime } from '@shared/lyricSync';
import { ALIGN_VOCAB } from './config';

const DIGITS = ['zero','one','two','three','four','five','six','seven','eight','nine'];

/** MMS uses romanized characters. Never silently drop a word in an unsupported script. */
export function tokenize(lines: readonly string[]): { labels: number[]; owners: number[]; words: string[]; lineWords: number[][] } {
  const labels: number[] = [31];
  const owners: number[] = [-1];
  const words: string[] = [];
  const lineWords: number[][] = [];
  for (const line of lines) {
    const indices: number[] = [];
    for (const word of line.trim().split(/\s+/).filter(Boolean)) {
      const normalized = word.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’‘]/g, "'").replace(/\d/g, (d) => DIGITS[Number(d)] ?? '').replace(/[^a-z'\p{L}]/gu, '');
      if (!normalized || /[^a-z']/u.test(normalized)) throw new Error('Choose an English / romanized version for this model. Native-script alignment is not available yet.');
      const owner = words.length; words.push(word); indices.push(owner);
      for (const letter of normalized) { labels.push(ALIGN_VOCAB[letter]!); owners.push(owner); }
    }
    lineWords.push(indices); labels.push(31); owners.push(-1);
  }
  return { labels, owners, words, lineWords };
}

export interface Alignment {
  readonly wordTimes: readonly LyricsWordTime[];
  readonly confidence: number;
  readonly lineConfidence: readonly number[];
}

/** Exact CTC Viterbi with explicit between-line wildcard states for intros, breaks and ad-libs.
 * Backpointers occupy one byte per state/frame; scores use only two rows. */
export function alignCtc(logits: Float32Array, frames: number, vocabulary: number, seconds: number, lines: readonly string[], progress?: (percent: number) => void): Alignment {
  const transcript = tokenize(lines);
  const states = transcript.labels.length * 2 + 1;
  if (vocabulary !== 31 || frames < transcript.labels.length || frames * states > 240_000_000) throw new Error('This recording or transcript is too large to align on this device.');
  const path = new Uint8Array(frames * states);
  let previous = new Float32Array(states).fill(-Infinity);
  let next = new Float32Array(states);
  previous[0] = 0;
  const probabilities = new Float32Array(logits.length);
  for (let t = 0; t < frames; t++) {
    const offset = t * vocabulary;
    let max = -Infinity;
    for (let v = 0; v < vocabulary; v++) max = Math.max(max, logits[offset + v]!);
    let sum = 0;
    for (let v = 0; v < vocabulary; v++) sum += Math.exp(logits[offset + v]! - max);
    const normalizer = max + Math.log(sum);
    let wildcard = -Infinity;
    for (let v = 0; v < vocabulary; v++) {
      probabilities[offset + v] = logits[offset + v]! - normalizer;
      if (v >= 4) wildcard = Math.max(wildcard, probabilities[offset + v]!);
    }
    next.fill(-Infinity);
    for (let s = 0; s < Math.min(states, 2 * t + 3); s++) {
      const label = s % 2 ? transcript.labels[(s - 1) / 2]! : 0;
      let score = previous[s]!; let step = 0;
      if (s > 0 && previous[s - 1]! > score) { score = previous[s - 1]!; step = 1; }
      if (s > 1 && label !== 0 && label !== transcript.labels[(s - 3) / 2] && previous[s - 2]! > score) { score = previous[s - 2]!; step = 2; }
      next[s] = score + (label === 31 ? Math.max(wildcard - 0.1, probabilities[offset]!) : probabilities[offset + label]!);
      path[t * states + s] = step;
    }
    [previous, next] = [next, previous];
    if (t % 100 === 0) progress?.(Math.floor(t / frames * 100));
  }
  let state = previous[states - 1]! > previous[states - 2]! ? states - 1 : states - 2;
  if (!Number.isFinite(previous[state])) throw new Error('The words could not be matched to this recording. Try another version.');
  const starts = new Int32Array(transcript.words.length).fill(-1);
  const ends = new Int32Array(starts.length);
  const sums = new Float64Array(starts.length);
  const counts = new Uint32Array(starts.length);
  for (let t = frames - 1; t >= 0; t--) {
    if (state % 2) {
      const index = (state - 1) / 2;
      const owner = transcript.owners[index]!;
      if (owner >= 0) {
        starts[owner] = t; ends[owner] = Math.max(ends[owner]!, t + 1);
        sums[owner] = sums[owner]! + Math.exp(probabilities[t * vocabulary + transcript.labels[index]!]!);
        counts[owner] = counts[owner]! + 1;
      }
    }
    state -= path[t * states + state]!;
  }
  const wordConfidence = Array.from(sums, (sum, i) => sum / Math.max(1, counts[i]!));
  const wordTimes = Array.from(starts, (start, i) => {
    if (start < 0) throw new Error('Some words could not be matched. Choose another lyric version.');
    return { start: start * seconds / frames, end: ends[i]! * seconds / frames };
  });
  const lineConfidence = transcript.lineWords.map((indices) => indices.reduce((sum, i) => sum + wordConfidence[i]!, 0) / Math.max(1, indices.length));
  progress?.(100);
  return { wordTimes, lineConfidence, confidence: wordConfidence.reduce((sum, n) => sum + n, 0) / Math.max(1, wordConfidence.length) };
}
