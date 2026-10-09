import { useEffect, useRef, type RefObject } from 'react';

import type { DjMotion } from '../../lib/djDance';
import { createHopper } from '../../lib/djHop';

/** A frame this long is a stalled tab, not motion; the hopper clamps it too. */
const MAX_DT = 0.1;

/**
 * Makes the DJ mascot hop about its stage like a ball, by writing five custom properties the stylesheet
 * turns into `translate`, `scale` and `rotate`: `--dj-roam-x`, `--dj-roam-y` (where it stands),
 * `--dj-lift` (how high it is), `--dj-squash` (crushed or stretched) and `--dj-sway` (lean and wobble).
 * The motion itself is `createHopper` in `lib/djHop.ts`.
 *
 * `motion` is read each frame from a ref, so a new vibe, play/pause, thinking or listening changes what
 * the next hop looks like without restarting anything. No React state: the loop writes straight to the
 * element. Under reduced motion nothing runs and the mascot stays where it is.
 */
export function useDjRoam(targetRef: RefObject<HTMLElement | null>, motion: DjMotion): void {
  const motionRef = useRef(motion);
  motionRef.current = motion;

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return undefined;

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const hopper = createHopper();
    let frame = 0;
    let last = 0;
    let written = '';

    const write = (x: number, y: number, lift: number, squash: number, sway: number): void => {
      // Skip the style write while it is resting: most frames are.
      const next = `${x.toFixed(3)}|${y.toFixed(3)}|${lift.toFixed(3)}|${squash.toFixed(3)}|${sway.toFixed(2)}`;
      if (next === written) return;
      written = next;
      target.style.setProperty('--dj-roam-x', x.toFixed(3));
      target.style.setProperty('--dj-roam-y', y.toFixed(3));
      target.style.setProperty('--dj-lift', lift.toFixed(3));
      target.style.setProperty('--dj-squash', squash.toFixed(3));
      target.style.setProperty('--dj-sway', sway.toFixed(2));
    };

    const sample = (now: number): void => {
      frame = window.requestAnimationFrame(sample);
      const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
      last = now;
      if (document.hidden) return;
      const pose = hopper.step(dt, motionRef.current);
      write(pose.x, pose.y, pose.lift, pose.squash, pose.sway);
    };

    const follow = (): void => {
      window.cancelAnimationFrame(frame);
      if (query.matches) {
        write(0, 0, 0, 0, 0);
        return;
      }
      last = performance.now();
      frame = window.requestAnimationFrame(sample);
    };

    follow();
    query.addEventListener('change', follow);
    return () => {
      query.removeEventListener('change', follow);
      window.cancelAnimationFrame(frame);
    };
  }, [targetRef]);
}
