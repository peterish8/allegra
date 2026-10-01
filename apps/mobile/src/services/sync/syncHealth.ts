/**
 * Whether library sync is stuck, for Settings. A change that cannot be sent is retried quietly
 * each time sync runs; only when nothing has gone out for a whole day does the listener hear
 * about it (PLAN section 6: "Sync paused: tap to retry").
 *
 * The time the outbox first failed lives in SQLite (database/syncQueries `markOutboxStuck`), so
 * a restart does not start the day again. This is the in-memory copy, set by the sync loop after
 * each attempt and when Settings asks. Nothing ticks to watch it: "has it been a day" is worked
 * out from the clock whenever the row is drawn.
 */
import { create } from 'zustand';

export const SYNC_PAUSED_AFTER_MS = 24 * 60 * 60 * 1000;

interface SyncHealthState {
  /** When the outbox first could not be delivered (ms), or null while it is flowing. */
  stuckSince: number | null;
}

export const useSyncHealthStore = create<SyncHealthState>(() => ({ stuckSince: null }));

export const setStuckSince = (stuckSince: number | null): void => {
  if (useSyncHealthStore.getState().stuckSince !== stuckSince) useSyncHealthStore.setState({ stuckSince });
};

/** True once changes made here have failed to reach the account for a day. */
export const isSyncPaused = (stuckSince: number | null, now: number): boolean =>
  stuckSince !== null && now - stuckSince >= SYNC_PAUSED_AFTER_MS;

/** For `useSyncHealthStore(selectSyncPaused)`: read again on every sync attempt and every draw. */
export const selectSyncPaused = (state: SyncHealthState): boolean => isSyncPaused(state.stuckSince, Date.now());
