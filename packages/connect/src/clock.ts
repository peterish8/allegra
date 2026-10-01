import type { Clock } from './types.ts';

const monotonicNow = typeof globalThis.performance?.now === 'function'
  ? () => globalThis.performance.now()
  : undefined;

export const systemClock: Clock = {
  now: () => Date.now(),
  ...(monotonicNow ? { monotonicNow } : {}),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>)
};
