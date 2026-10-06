import { useCallback, useEffect, useRef } from 'react';

import { motionTokens } from '../motion';

const easing = `cubic-bezier(${motionTokens.ease.emphasis.join(', ')})`;

/**
 * A cover flying between a list row and the import crate (FLIP, transform and opacity only).
 * A clone of the cover is laid over the page, animated, and removed when it lands. A new flight for
 * the same key cancels the one in the air and starts from wherever that one had got to, so rapid
 * toggles retarget instead of stacking. Unmounting removes anything still flying.
 * Disabled (reduced motion): nothing flies; the crate just updates.
 */
export function useCoverFlight(enabled: boolean): (key: string, cover: Element, from: DOMRect, to: DOMRect) => void {
  const flights = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const live = flights.current;
    return () => {
      for (const node of live.values()) node.remove();
      live.clear();
    };
  }, []);

  return useCallback((key, cover, from, to) => {
    const prior = flights.current.get(key);
    const start = prior ? prior.getBoundingClientRect() : from;
    if (prior) {
      prior.remove();
      flights.current.delete(key);
    }
    if (!enabled || start.width === 0 || to.width === 0 || typeof HTMLElement.prototype.animate !== 'function') return;

    const clone = cover.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');
    clone.setAttribute('aria-hidden', 'true');
    clone.classList.add('cover-flight');
    clone.style.left = `${start.left}px`;
    clone.style.top = `${start.top}px`;
    clone.style.width = `${start.width}px`;
    clone.style.height = `${start.height}px`;
    document.body.appendChild(clone);
    flights.current.set(key, clone);

    const dx = to.left - start.left;
    const dy = to.top - start.top;
    const scale = to.width / start.width;
    const animation = clone.animate(
      [{ transform: 'translate(0px, 0px) scale(1)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.85 }],
      { duration: motionTokens.duration.flight * 1000, easing, fill: 'forwards' }
    );
    const land = (): void => {
      clone.remove();
      if (flights.current.get(key) === clone) flights.current.delete(key);
    };
    animation.onfinish = land;
    animation.oncancel = land;
  }, [enabled]);
}
