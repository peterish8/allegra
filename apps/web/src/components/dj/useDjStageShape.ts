import { useLayoutEffect, type RefObject } from 'react';

import { djStagePath } from '../../lib/djStageShape';

/** How far beyond the console each curve starts on the stage's edge, and how far inside it lands, in px. */
const SPREAD = 130;
const TUCK = 34;

/**
 * Keeps the DJ hero cut to one shape: the stage plus the console tab under it (`djStagePath`). Measures
 * the hero, the stage and the console whenever any of them changes size, then writes the shape as the
 * hero's `clip-path` and as the `d` of the edge outline. No React state; nothing re-renders.
 */
export function useDjStageShape(
  heroRef: RefObject<HTMLElement | null>,
  stageRef: RefObject<HTMLElement | null>,
  tabRef: RefObject<HTMLElement | null>,
  outlineRef: RefObject<SVGPathElement | null>
): void {
  useLayoutEffect(() => {
    const hero = heroRef.current;
    const stage = stageRef.current;
    const tab = tabRef.current;
    if (!hero || !stage || !tab || typeof ResizeObserver === 'undefined') return undefined;

    let frame = 0;
    const draw = (): void => {
      frame = 0;
      const width = hero.offsetWidth;
      const height = hero.offsetHeight;
      const radius = Number.parseFloat(getComputedStyle(hero).borderTopLeftRadius) || 30;
      const path = djStagePath({
        width,
        height,
        stageHeight: stage.offsetHeight,
        tabLeft: tab.offsetLeft,
        tabWidth: tab.offsetWidth,
        radius,
        spread: SPREAD,
        tuck: TUCK
      });
      if (!path) return;
      hero.style.clipPath = `path('${path}')`;
      const outline = outlineRef.current;
      if (outline) {
        outline.setAttribute('d', path);
        outline.ownerSVGElement?.setAttribute('viewBox', `0 0 ${width} ${height}`);
      }
    };
    const schedule = (): void => {
      if (!frame) frame = window.requestAnimationFrame(draw);
    };

    draw();
    const observer = new ResizeObserver(schedule);
    observer.observe(hero);
    observer.observe(stage);
    observer.observe(tab);
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      hero.style.clipPath = '';
    };
  }, [heroRef, outlineRef, stageRef, tabRef]);
}
