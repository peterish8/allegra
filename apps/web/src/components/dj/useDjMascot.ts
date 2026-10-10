import { useCallback, useEffect, useRef, type RefObject } from 'react';

import type { AnalyserHandle } from '../../hooks/useAudioAnalyser';
import {
  createMascotDriver,
  createOnsetDetector,
  type DjDanceVibe,
  type DjMascotMode,
  type DjMascotReaction
} from '../../lib/djMascotMotion';

/** A pointer that has not moved for this long no longer holds the mascot's gaze. */
const POINTER_HOLD_MS = 2600;
/** How far from the mascot (in its own widths) a pointer still pulls its eyes all the way over. */
const LOOK_REACH = 2.2;

export interface DjMascotLoopOptions {
  readonly mode: DjMascotMode;
  readonly vibe: DjDanceVibe;
  /** True while music plays on this device: only then is the audio read. */
  readonly playing: boolean;
}

function writeVars(target: HTMLElement, values: Readonly<Record<string, string>>, last: Map<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    if (last.get(name) === value) continue;
    last.set(name, value);
    target.style.setProperty(name, value);
  }
}

/**
 * The DJ page's one animation loop. Each frame it reads the song (`--dj-bass`, `--dj-energy`,
 * `--dj-voice`, `--dj-onset`), steps the mascot (`createMascotDriver`) and writes its pose
 * (`--dj-roam-x/y`, `--dj-lift`, `--dj-squash`, `--dj-sway`, `--dj-look-x/y`, `--dj-blink`,
 * `--dj-nod`) onto `targetRef`. Everything under it reads those: the mascot, the stage light and the
 * now-playing bars. No React state, so nothing re-renders per frame.
 *
 * `mascotRef` is the element the eyes look out from. Under reduced motion the body holds still and only
 * the audio values are written (the stylesheet turns them into opacity).
 *
 * Returns `react`, which makes the mascot hop for joy, shake its head or nod.
 */
export function useDjMascot(
  targetRef: RefObject<HTMLElement | null>,
  mascotRef: RefObject<HTMLElement | null>,
  analyser: AnalyserHandle,
  options: DjMascotLoopOptions
): (reaction: DjMascotReaction) => void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const driverRef = useRef<ReturnType<typeof createMascotDriver> | null>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return undefined;

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const driver = createMascotDriver();
    driverRef.current = driver;
    const detector = createOnsetDetector();
    const written = new Map<string, string>();
    let bass = 0;
    let energy = 0;
    let voice = 0;
    let frame = 0;
    let last = performance.now();
    let pointer: { x: number; y: number; at: number } | null = null;

    // Measured in the pointer event, not in the frame loop, so the loop never reads layout after writing styles.
    const onPointer = (event: PointerEvent): void => {
      const mascot = mascotRef.current;
      if (event.pointerType === 'touch' || !mascot) return;
      const box = mascot.getBoundingClientRect();
      if (box.width === 0) return;
      const reach = box.width * LOOK_REACH;
      pointer = {
        x: (event.clientX - (box.left + box.width / 2)) / reach,
        y: (event.clientY - (box.top + box.height / 2)) / reach,
        at: performance.now()
      };
    };

    const lookFrom = (now: number): { x: number; y: number } | null =>
      pointer && now - pointer.at <= POINTER_HOLD_MS ? { x: pointer.x, y: pointer.y } : null;

    const sample = (now: number): void => {
      frame = window.requestAnimationFrame(sample);
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      if (document.hidden) return;
      const { mode, vibe, playing } = optionsRef.current;

      let onset = 0;
      if (playing) {
        const bands = analyser.readBands();
        // null is "unknown" (muted tab, graph not ready), not silence: hold the last values.
        if (bands) {
          bass = bands.bass;
          voice = bands.mid;
          energy = Math.min(1, bands.bass * 0.5 + bands.mid * 0.3 + bands.treble * 0.2);
        }
        onset = detector.next(analyser.readLevel(), now);
      } else {
        bass *= 0.9;
        energy *= 0.9;
        voice *= 0.9;
      }

      const audio = {
        '--dj-bass': bass.toFixed(3),
        '--dj-energy': energy.toFixed(3),
        '--dj-voice': voice.toFixed(3),
        '--dj-onset': onset.toFixed(3)
      };
      if (query.matches) {
        writeVars(target, audio, written);
        return;
      }
      const pose = driver.step(dt, { mode, vibe, onset, look: lookFrom(now) });
      writeVars(target, {
        ...audio,
        '--dj-roam-x': pose.x.toFixed(3),
        '--dj-roam-y': pose.y.toFixed(3),
        '--dj-lift': pose.lift.toFixed(3),
        '--dj-squash': pose.squash.toFixed(3),
        '--dj-sway': pose.tilt.toFixed(2),
        '--dj-look-x': pose.lookX.toFixed(3),
        '--dj-look-y': pose.lookY.toFixed(3),
        '--dj-blink': pose.blink.toFixed(2),
        '--dj-nod': pose.nod.toFixed(3)
      }, written);
    };

    const rest = (): void => {
      writeVars(target, {
        '--dj-roam-x': '0', '--dj-roam-y': '0', '--dj-lift': '0', '--dj-squash': '0', '--dj-sway': '0',
        '--dj-look-x': '0', '--dj-look-y': '0', '--dj-blink': '0', '--dj-nod': '0'
      }, written);
    };

    const onMotionChange = (): void => {
      if (query.matches) rest();
    };

    rest();
    window.addEventListener('pointermove', onPointer, { passive: true });
    query.addEventListener('change', onMotionChange);
    frame = window.requestAnimationFrame(sample);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointer);
      query.removeEventListener('change', onMotionChange);
      driverRef.current = null;
      writeVars(target, { '--dj-bass': '0', '--dj-energy': '0', '--dj-voice': '0', '--dj-onset': '0' }, written);
    };
  }, [analyser, mascotRef, targetRef]);

  return useCallback((reaction: DjMascotReaction): void => {
    driverRef.current?.react(reaction);
  }, []);
}
