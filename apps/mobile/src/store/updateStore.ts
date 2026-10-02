/**
 * What the app knows about updates between launches: whether it looks for one by itself, when it last
 * looked, and the newer build it found (so About can show "Update available" before it is opened, as
 * Echo's settings do). Kept apart from the settings store so a new field here never needs a migration there.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** A newer build, as much of it as is worth keeping: the full notes are read again when About opens. */
export interface AvailableBuild {
  readonly commit: string | null;
  readonly version: string | null;
  readonly publishedAt: string;
}

interface UpdateState {
  autoCheck: boolean;
  /** ISO time of the last check, by hand or by itself. */
  lastCheckedAt: string | null;
  available: AvailableBuild | null;
  setAutoCheck: (on: boolean) => void;
  /** A check finished: when, and the newer build it found (null when the phone is up to date). */
  recordCheck: (at: Date, available: AvailableBuild | null) => void;
}

export const useUpdateStore = create<UpdateState>()(
  persist(
    set => ({
      autoCheck: true,
      lastCheckedAt: null,
      available: null,
      // Turning it off also clears the badge, so a stale "update available" does not nag for good.
      setAutoCheck: autoCheck => set(autoCheck ? { autoCheck } : { autoCheck, available: null }),
      recordCheck: (at, available) => set({ lastCheckedAt: at.toISOString(), available }),
    }),
    { name: 'luvlyrics-updates', storage: createJSONStorage(() => AsyncStorage), version: 1 },
  ),
);
