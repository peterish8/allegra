/**
 * The Spotify transfer as a job that outlives the screen that started it. Both apps keep one of these
 * at module level: the panel shows it and drives it, but leaving the page never cancels a run.
 * Pure TypeScript (no npm imports): the API calls come in through `TransferDeps`.
 */
import type { SpotifySyncStep } from './spotify';

/** One source's part in the current run. */
export type RowRun =
  | { readonly state: 'waiting' }
  | { readonly state: 'syncing' | 'done'; readonly step: SpotifySyncStep | null }
  | { readonly state: 'failed'; readonly message: string };

export interface TransferState {
  /** The account the run belongs to; another account resets it. */
  readonly accountKey: string | null;
  readonly syncing: boolean;
  /** The sources of the current (or last) run, in order. */
  readonly order: readonly string[];
  readonly names: ReadonlyMap<string, string>;
  readonly runs: ReadonlyMap<string, RowRun>;
  /** The run's outcome line, when it ended without an arrival to show. */
  readonly message: string;
  /** Every source finished with songs added. */
  readonly arrival: { readonly added: number; readonly notExact: number } | null;
  readonly needsReconnect: boolean;
  /** Bumped when a run ends, so a screen can refresh its status. */
  readonly finishedAt: number;
}

export interface TransferDeps {
  readonly sync: (id: string, signal: AbortSignal) => Promise<unknown>;
  readonly errorText: (error: unknown) => string;
  /** Authorization and rate limits stop the whole run; anything else stays on its own row. */
  readonly stopsRun: (error: unknown) => { readonly reconnect: boolean } | null;
  /** Songs landed (library refresh, nav glow); runs even if no screen is showing the transfer. */
  readonly onLanded?: (added: number) => void;
}

const MAX_STEPS = 100;

export const isSyncStep = (value: unknown): value is SpotifySyncStep => typeof value === 'object' && value !== null
  && typeof (value as SpotifySyncStep).complete === 'boolean'
  && Number.isInteger((value as SpotifySyncStep).added) && Number.isInteger((value as SpotifySyncStep).skipped)
  && Number.isInteger((value as SpotifySyncStep).reviewNeeded) && typeof (value as SpotifySyncStep).libraryId === 'string';

const EMPTY: TransferState = { accountKey: null, syncing: false, order: [], names: new Map(), runs: new Map(), message: '', arrival: null, needsReconnect: false, finishedAt: 0 };

export interface SpotifyTransfer {
  readonly getState: () => TransferState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Runs `order` one bounded step at a time; ignored while a run is going. */
  readonly start: (accountKey: string, order: readonly { readonly id: string; readonly name: string }[], deps: TransferDeps) => Promise<void>;
  readonly pause: () => void;
  /** A row was ticked again: forget its result. */
  readonly forget: (id: string) => void;
  /** The selection changed wholesale: forget every result and the outcome. */
  readonly clear: () => void;
  readonly dismiss: () => void;
  /** A different account (or none): stop and forget everything. */
  readonly useAccount: (accountKey: string | null) => void;
}

export function createSpotifyTransfer(): SpotifyTransfer {
  let state = EMPTY;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const set = (next: Partial<TransferState>): void => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const setRun = (id: string, run: RowRun): void => set({ runs: new Map(state.runs).set(id, run) });

  const start: SpotifyTransfer['start'] = async (accountKey, order, deps) => {
    if (state.syncing || order.length === 0) return;
    const run = new AbortController();
    controller?.abort();
    controller = run;
    const ids = order.map((row) => row.id);
    set({
      accountKey, syncing: true, order: ids, names: new Map(order.map((row) => [row.id, row.name])),
      runs: new Map(ids.map((id) => [id, { state: 'waiting' } as const])), message: '', arrival: null, needsReconnect: false
    });
    let added = 0; let notExact = 0; let finished = 0;
    try {
      for (const id of ids) {
        let latest: SpotifySyncStep | null = null;
        setRun(id, { state: 'syncing', step: null });
        try {
          for (let step = 0; step < MAX_STEPS; step += 1) {
            const response = await deps.sync(id, run.signal);
            if (!isSyncStep(response)) throw new Error('Spotify returned an invalid sync progress response.');
            latest = response;
            if (run.signal.aborted) return;
            setRun(id, { state: latest.complete ? 'done' : 'syncing', step: latest });
            if (latest.complete) break;
          }
          if (!latest?.complete) { setRun(id, { state: 'failed', message: 'Still going. Transfer again to finish it.' }); continue; }
          added += latest.added; notExact += latest.reviewNeeded; finished += 1;
        } catch (error) {
          if (run.signal.aborted) return;
          const stop = deps.stopsRun(error);
          if (stop) { set({ message: deps.errorText(error), needsReconnect: state.needsReconnect || stop.reconnect }); setRun(id, { state: 'failed', message: 'Stopped here' }); return; }
          setRun(id, { state: 'failed', message: deps.errorText(error) });
        }
      }
      if (finished === ids.length && added > 0) set({ arrival: { added, notExact } });
      else set({ message: finishedText(added, finished, notExact) });
    } finally {
      if (controller === run) {
        controller = null;
        set({ syncing: false, finishedAt: state.finishedAt + 1 });
        if (added > 0) deps.onLanded?.(added);
      }
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start,
    pause: () => {
      controller?.abort();
      controller = null;
      set({
        syncing: false,
        runs: new Map([...state.runs].filter(([, row]) => row.state === 'done' || row.state === 'failed')),
        message: 'Paused. Songs already added stay saved; transfer again to carry on.'
      });
    },
    forget: (id) => {
      if (!state.runs.has(id) && !state.arrival) return;
      const runs = new Map(state.runs);
      runs.delete(id);
      set({ runs, arrival: null });
    },
    clear: () => { if (!state.syncing) set({ runs: new Map(), arrival: null, message: '' }); },
    dismiss: () => set({ message: '', arrival: null, needsReconnect: false }),
    useAccount: (accountKey) => {
      if (accountKey === state.accountKey) return;
      controller?.abort();
      controller = null;
      state = { ...EMPTY, accountKey, finishedAt: state.finishedAt };
      for (const listener of listeners) listener();
    }
  };
}

function finishedText(added: number, finished: number, notExact: number): string {
  if (finished === 0) return 'Nothing transferred. Check the rows above and try again.';
  return `${added} ${added === 1 ? 'song' : 'songs'} added from ${finished} ${finished === 1 ? 'source' : 'sources'}.${notExact ? ` ${notExact} had no exact match and were left out; the next transfer tries them again.` : ''}`;
}
