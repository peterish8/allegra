import { useEffect, useState } from 'react';

const EVENT = 'allegra:library-arrival';

/** Songs just landed in the library (an import or transfer finished): the Library nav glows once. */
export function announceLibraryArrival(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Counts arrivals; use it as a key so each one replays the nav's one-shot glow. */
export function useLibraryArrival(): number {
  const [arrivals, setArrivals] = useState(0);
  useEffect(() => {
    const onArrival = (): void => setArrivals((count) => count + 1);
    window.addEventListener(EVENT, onArrival);
    return () => window.removeEventListener(EVENT, onArrival);
  }, []);
  return arrivals;
}
