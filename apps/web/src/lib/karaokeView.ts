/**
 * What the karaoke controls say and draw, kept out of the components so every player
 * surface (full player, lyrics dock, phone dock, mini bar) says the same thing.
 */

import type { KaraokeCoverage, KaraokeStage } from '../hooks/useLiveKaraoke';
import type { LiveKaraokeStatus } from './liveKaraoke/types';

export interface KaraokeLabelInput {
  readonly active: boolean;
  readonly busy: boolean;
  readonly status: LiveKaraokeStatus;
  readonly stage: KaraokeStage | null;
}

function downloadPercent(loaded: number, total: number): number {
  return total <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
}

function seconds(eta: number | null): string | null {
  return eta === null ? null : `~${Math.max(1, Math.round(eta))} s`;
}

/** The Karaoke button's text. Short: it shares a row with the mix button on a phone. */
export function karaokeButtonLabel(k: KaraokeLabelInput): string {
  if (!k.active) return 'Karaoke';
  if (k.status === 'catching-up') {
    const eta = seconds(k.stage?.kind === 'separating' ? k.stage.eta : null);
    return eta ? `Catching up · ${eta}` : 'Catching up';
  }
  if (!k.busy || !k.stage) return 'Karaoke on';
  switch (k.stage.kind) {
    case 'song':
      return 'Preparing song';
    case 'model-check':
      return 'Checking AI model';
    case 'model-download':
      return `AI download · ${downloadPercent(k.stage.loaded, k.stage.total)}%`;
    case 'model-verify':
      return 'Verifying AI model';
    case 'model-save':
      return 'Saving AI model';
    case 'model-start':
      return 'Starting AI model';
    case 'separating': {
      const eta = seconds(k.stage.eta);
      return eta ? `Separating · ${eta}` : 'AI separating';
    }
  }
}

/** The accessible name: what pressing does, then what is happening. */
export function karaokeButtonAriaLabel(k: KaraokeLabelInput): string {
  if (!k.active) return 'Turn karaoke on';
  if (k.busy) return `Turn karaoke off. ${karaokeButtonLabel(k)}`;
  if (k.status === 'catching-up') return `Turn karaoke off. ${karaokeButtonLabel(k)}`;
  return 'Turn karaoke off';
}

export interface CoverageRun {
  /** Percent of the song. */
  readonly from: number;
  readonly to: number;
  readonly ready: boolean;
}

/** Adjacent segments with the same state merged into runs across the song, in percent. */
export function coverageRuns(ready: ArrayLike<number>, segmentSeconds: number, totalSeconds: number): CoverageRun[] {
  if (totalSeconds <= 0 || ready.length === 0) return [];
  const runs: CoverageRun[] = [];
  for (let k = 0; k < ready.length; k++) {
    const from = Math.min(100, ((k * segmentSeconds) / totalSeconds) * 100);
    const to = Math.min(100, (((k + 1) * segmentSeconds) / totalSeconds) * 100);
    if (to <= from) break;
    const isReady = Boolean(ready[k]);
    const last = runs[runs.length - 1];
    if (last && last.ready === isReady) runs[runs.length - 1] = { ...last, to };
    else runs.push({ from, to, ready: isReady });
  }
  return runs;
}

/** A hard-stop gradient painting separated runs in `readyColor`, the rest in `restColor`. */
export function coverageGradient(runs: readonly CoverageRun[], readyColor: string, restColor: string): string {
  if (runs.length === 0) return 'none';
  const stops = runs.map((run) => `${run.ready ? readyColor : restColor} ${run.from.toFixed(2)}% ${run.to.toFixed(2)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** Where the segment being separated sits on the bar, in percent; null when idle. */
export function workingSpan(coverage: KaraokeCoverage): { readonly left: number; readonly width: number } | null {
  if (coverage.working === null || coverage.totalSeconds <= 0) return null;
  const left = Math.min(100, ((coverage.working * coverage.segmentSeconds) / coverage.totalSeconds) * 100);
  const right = Math.min(100, (((coverage.working + 1) * coverage.segmentSeconds) / coverage.totalSeconds) * 100);
  return right > left ? { left, width: right - left } : null;
}
