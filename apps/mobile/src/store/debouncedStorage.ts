/**
 * Storage for a persisted store whose writes are held back and coalesced per key. The settings store rewrites its
 * whole saved JSON on every change, and the playlist history changes with every song: a burst of changes now costs
 * one write a second at most. Pending writes go out at once when the app leaves the foreground, so a swipe-away does
 * not lose them, and a read sees the newest value even before it is written.
 */
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';

interface Backing {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Calls `flush` whenever the app stops being active. */
const watchBackground = (flush: () => void): void => {
  AppState?.addEventListener?.('change', state => { if (state !== 'active') flush(); });
};

export interface DebouncedStorage extends StateStorage {
  /** Writes everything pending now. */
  flush(): Promise<void>;
}

export const createDebouncedStorage = (
  delayMs: number,
  backing: Backing = AsyncStorage,
  onBackground: (flush: () => void) => void = watchBackground,
): DebouncedStorage => {
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watching = false;

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const writes = [...pending];
    pending.clear();
    await Promise.all(writes.map(([key, value]) => backing.setItem(key, value).catch(() => undefined)));
  };

  return {
    getItem: key => (pending.has(key) ? pending.get(key) ?? null : backing.getItem(key)),
    setItem: (key, value) => {
      pending.set(key, value);
      if (!watching) {
        watching = true;
        onBackground(() => { flush().catch(() => undefined); });
      }
      if (!timer) timer = setTimeout(() => { flush().catch(() => undefined); }, delayMs);
    },
    removeItem: async key => {
      pending.delete(key);
      await backing.removeItem(key);
    },
    flush,
  };
};
