import { useEffect, useRef, type RefObject } from 'react';

import type { DjMotion } from '../../lib/djDance';

/** How long the live pose takes to close most of the gap to a new target, seconds. Changes glide, never snap. */
const EASE_SECONDS = 0.7;
/** A frame this long is a stalled tab, not motion: clamp so the mascot does not teleport on return. */
const MAX_DT = 0.1;

const NUMERIC_KEYS = ['period', 'ampX', 'ampY', 'yRatio', 'yOffset', 'sway', 'swayPeriod', 'tilt'] as const;

function write(target: HTMLElement, x: number, y: number, sway: number): void {
  target.style.setProperty('--dj-roam-x', x.toFixed(3));
  target.style.setProperty('--dj-roam-y', y.toFixed(3));
  target.style.setProperty('--dj-sway', sway.toFixed(2));
}

/**
 * Walks the DJ mascot around its stage and sways it, by writing three custom properties the stylesheet
 * turns into `translate` and `rotate`: `--dj-roam-x` and `--dj-roam-y` (-1..1, fractions of the roam box)
 * and `--dj-sway` (degrees).
 *
 * The path is a Lissajous curve, biased upward so the mascot stays clear of the prompt below it. Every
 * parameter eases toward `motion` as it changes (a new vibe, play/pause, thinking, listening), so the
 * mascot changes its mind in mid-stride instead of jumping. No React state: the loop writes straight to
 * the element. Under reduced motion nothing runs and the mascot stays centred.
 */
export function useDjRoam(targetRef: RefObject<HTMLElement | null>, motion: DjMotion): void {
  const motionRef = useRef(motion);
  motionRef.current = motion;

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return undefined;

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let last = 0;
    let phase = 0;
    let swayPhase = 0;
    const live: Record<(typeof NUMERIC_KEYS)[number], number> = { ...motionRef.current };

    const sample = (now: number): void => {
      frame = window.requestAnimationFrame(sample);
      const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
      last = now;
      if (document.hidden) return;

      const goal = motionRef.current;
      const ease = 1 - Math.exp(-dt / EASE_SECONDS);
      for (const key of NUMERIC_KEYS) live[key] += (goal[key] - live[key]) * ease;

      phase += (dt / Math.max(1, live.period)) * Math.PI * 2;
      swayPhase += (dt / Math.max(1, live.swayPeriod)) * Math.PI * 2;
      const x = live.ampX * Math.sin(phase);
      // 0.45 + 0.55 * s runs 0..1, so the path spends its time in the upper part of the box.
      const y = live.ampY * -(0.45 + 0.55 * Math.sin(live.yRatio * phase)) + live.yOffset;
      write(target, x, Math.max(-1, Math.min(1, y)), live.sway * Math.sin(swayPhase) + live.tilt);
    };

    const start = (): void => {
      window.cancelAnimationFrame(frame);
      last = performance.now();
      frame = window.requestAnimationFrame(sample);
    };
    const settle = (): void => {
      window.cancelAnimationFrame(frame);
      write(target, 0, 0, 0);
    };
    const follow = (): void => { if (query.matches) settle(); else start(); };

    follow();
    query.addEventListener('change', follow);
    return () => {
      query.removeEventListener('change', follow);
      window.cancelAnimationFrame(frame);
    };
  }, [targetRef]);
}
