import { useEffect, useRef, useState } from 'react';

/**
 * `value`, shown at most once per `intervalMs`. The latest value always lands at the end of the
 * window, so a burst never leaves the display stale.
 */
export function useThrottled<T>(value: T, intervalMs: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, last.current + intervalMs - Date.now());
    const timer = window.setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [value, intervalMs]);
  return shown;
}
