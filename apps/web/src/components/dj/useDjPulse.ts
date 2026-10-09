import { useEffect, type RefObject } from 'react';

import type { AnalyserHandle } from '../../hooks/useAudioAnalyser';

/** Loudness must beat the running baseline by this factor, and this floor, to count as a beat. */
const ONSET_RATIO = 1.48;
const ONSET_FLOOR = 0.095;
/** Two beats closer than this are one beat. */
const ONSET_GAP_MS = 360;
const ONSET_CEILING = 0.9;
const ONSET_DECAY = 0.91;
const BASELINE_RATE = 0.025;

export interface OnsetDetector {
  /** Feeds one frame (`level` 0..1, `now` in ms) and returns the pulse, 0..0.9, decaying between beats. */
  readonly next: (level: number, now: number) => number;
}

/** Beat detector over overall loudness. Pure: the caller owns the clock. */
export function createOnsetDetector(): OnsetDetector {
  let baseline = 0.025;
  let pulse = 0;
  let lastOnset = 0;
  return {
    next: (level, now) => {
      baseline += (level - baseline) * BASELINE_RATE;
      const onset = level > Math.max(ONSET_FLOOR, baseline * ONSET_RATIO) && now - lastOnset > ONSET_GAP_MS;
      if (onset) {
        pulse = Math.min(ONSET_CEILING, Math.max(pulse, level * 2.4));
        lastOnset = now;
      } else {
        pulse *= ONSET_DECAY;
      }
      return pulse;
    }
  };
}

function write(target: HTMLElement, bass: number, energy: number, onset: number): void {
  // Three decimals: plenty of resolution to drive a CSS calc().
  target.style.setProperty('--dj-bass', bass.toFixed(3));
  target.style.setProperty('--dj-energy', energy.toFixed(3));
  target.style.setProperty('--dj-onset', onset.toFixed(3));
}

/**
 * Writes the audio analysis onto an element as three custom properties the stylesheet reads:
 * `--dj-bass` and `--dj-energy` (0..1, from the band tracker) and `--dj-onset` (0..0.9, a decaying
 * kick on each detected beat).
 *
 * No React state: the loop writes straight to `targetRef.current.style`, so a song never re-renders
 * the tree. `readBands()` returns null when there is no data (muted tab, graph not ready); the last
 * values are held then, because null means "unknown", not "silent". Frames are skipped while the
 * document is hidden. Stopping (or unmounting) writes zeros so nothing stays lit.
 */
export function useDjPulse(
  targetRef: RefObject<HTMLElement | null>,
  analyser: AnalyserHandle,
  active: boolean
): void {
  useEffect(() => {
    const target = targetRef.current;
    if (!target || !active) return undefined;

    const detector = createOnsetDetector();
    let bass = 0;
    let energy = 0;
    let frame = 0;

    const sample = (now: number): void => {
      frame = window.requestAnimationFrame(sample);
      if (document.hidden) return;
      const bands = analyser.readBands();
      if (bands) {
        bass = bands.bass;
        energy = Math.min(1, bands.bass * 0.5 + bands.mid * 0.3 + bands.treble * 0.2);
      }
      write(target, bass, energy, detector.next(analyser.readLevel(), now));
    };
    frame = window.requestAnimationFrame(sample);

    return () => {
      window.cancelAnimationFrame(frame);
      write(target, 0, 0, 0);
    };
  }, [analyser, active, targetRef]);
}
