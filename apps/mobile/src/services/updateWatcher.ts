/**
 * Noticing a new build while the app is open (1.49.1): a light watcher, with no server of ours in the loop.
 *
 * CI publishes every build to the public `apk-latest` release, and each build carries a small `changelog.json` (about
 * 700 bytes) that names its commit and version. While the app is in front, this fetches that file now and then — a
 * plain download from GitHub's CDN, which has no API rate limit — and compares the commit with the one installed and
 * the last one it already acted on. Only when it differs does it make the one full check (`checkNow`, a single GitHub
 * API call) that fills the update store, so the profile dot and an open About sheet update by themselves.
 *
 * It costs nothing while the app is in the background (the timer stops), and it backs off when GitHub or the network
 * does not answer. It never downloads or installs anything: that is still the listener's tap.
 */
import { AppState, type AppStateStatus } from 'react-native';
import { useUpdateStore } from '../store/updateStore';
import { INSTALLED_BUILD, type InstalledBuild } from './appUpdate';
import { checkNow } from './updateCheck';
import { isBatterySaverOn } from '../utils/batterySaver';

/** The release's own `changelog.json`, a download rather than an API call. */
export const STAMP_URL = 'https://github.com/peterish8/allegra/releases/download/apk-latest/changelog.json';

export interface BuildStamp {
  readonly commit: string | null;
  readonly version: string | null;
}

/** Pure: the commit and version a `changelog.json` names; null when it is not one. */
export const parseStamp = (json: unknown): BuildStamp | null => {
  if (!json || typeof json !== 'object') return null;
  const { commit, version } = json as { commit?: unknown; version?: unknown };
  const sha = typeof commit === 'string' && /^[0-9a-f]{7,40}$/i.test(commit) ? commit.toLowerCase() : null;
  const ver = typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  return sha || ver ? { commit: sha, version: ver } : null;
};

/**
 * Pure: whether a stamp is worth the one full check. Not when it names the build already installed, and not when the
 * watcher already acted on it (the full check would only say what it said before).
 */
export const stampNeedsCheck = (stamp: BuildStamp, installed: InstalledBuild, lastActedOn: string | null): boolean => {
  if (!stamp.commit) return false;
  if (installed.commit && stamp.commit === installed.commit) return false;
  return stamp.commit !== lastActedOn;
};

export const FAST_MS = 15_000;
export const NORMAL_MS = 45_000;
export const SAVER_MS = 3 * 60_000;
export const KNOWN_MS = 5 * 60_000;
export const MAX_BACKOFF_MS = 10 * 60_000;

/** Pure: how long to wait before the next look. */
export const nextDelayMs = (o: { failures: number; saver: boolean; updateKnown: boolean; panelOpen: boolean }): number => {
  const base = o.panelOpen ? FAST_MS : o.updateKnown ? KNOWN_MS : o.saver ? SAVER_MS : NORMAL_MS;
  return Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(o.failures, 5));
};

export interface WatcherDeps {
  /** The latest build's stamp, or null when it could not be read (offline, GitHub down). */
  readonly fetchStamp: () => Promise<BuildStamp | null>;
  /** The one full check; true when it answered. */
  readonly check: () => Promise<boolean>;
  readonly installed: InstalledBuild;
  readonly autoCheck: () => boolean;
  readonly updateKnown: () => boolean;
  readonly saver: () => boolean;
  /** App state changes: called with true when the app comes to the front. */
  readonly onActiveChange: (listener: (active: boolean) => void) => () => void;
  readonly isActive: () => boolean;
}

export interface UpdateWatcher {
  start: () => void;
  stop: () => void;
  /** The About sheet's Updates panel is open: look more often. */
  setPanelOpen: (open: boolean) => void;
}

export const createUpdateWatcher = (deps: WatcherDeps): UpdateWatcher => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let running = false;
  let busy = false;
  let failures = 0;
  let panelOpen = false;
  let lastActedOn: string | null = null;

  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const schedule = () => {
    clear();
    if (!running || !deps.isActive() || !deps.autoCheck()) return;
    timer = setTimeout(() => { void tick(); }, nextDelayMs({ failures, saver: deps.saver(), updateKnown: deps.updateKnown(), panelOpen }));
  };

  const tick = async (): Promise<void> => {
    timer = null;
    if (busy || !running || !deps.isActive() || !deps.autoCheck()) return;
    busy = true;
    try {
      const stamp = await deps.fetchStamp();
      if (!stamp) { failures += 1; return; }
      failures = 0;
      if (stampNeedsCheck(stamp, deps.installed, lastActedOn)) {
        // Remember it only once the full check answered, so a failed one is tried again on the next look.
        if (await deps.check()) lastActedOn = stamp.commit; else failures += 1;
      }
    } catch {
      failures += 1;
    } finally {
      busy = false;
      schedule();
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      unsubscribe = deps.onActiveChange(active => {
        clear();
        // Coming to the front looks straight away: an update that landed while the app was away shows at once.
        if (active) void tick();
      });
      void tick();
    },
    stop() {
      running = false;
      clear();
      unsubscribe?.();
      unsubscribe = null;
    },
    setPanelOpen(open) {
      if (panelOpen === open) return;
      panelOpen = open;
      if (open && running) { clear(); void tick(); } else schedule();
    },
  };
};

// ── The real watcher ────────────────────────────────────────────────────────

const fetchStampFromGitHub = async (): Promise<BuildStamp | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    // No cache: the file is replaced in place when a new build is published.
    const res = await fetch(STAMP_URL, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    return res.ok ? parseStamp(await res.json()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

let watcher: UpdateWatcher | null = null;

/** Starts the app-wide watcher once (it lives as long as the app). It idles while the app is away or automatic checks are off. */
export const startUpdateWatcher = (): void => {
  if (watcher) return;
  watcher = createUpdateWatcher({
    fetchStamp: fetchStampFromGitHub,
    check: async () => (await checkNow()) !== null,
    installed: INSTALLED_BUILD,
    autoCheck: () => useUpdateStore.getState().autoCheck,
    updateKnown: () => useUpdateStore.getState().available !== null,
    saver: isBatterySaverOn,
    isActive: () => AppState.currentState === 'active',
    onActiveChange: listener => {
      const sub = AppState.addEventListener('change', (state: AppStateStatus) => listener(state === 'active'));
      return () => sub.remove();
    },
  });
  watcher.start();
  // Turning automatic checks back on starts looking again without waiting for the next foreground.
  useUpdateStore.subscribe((state, previous) => {
    if (state.autoCheck && !previous.autoCheck) { watcher?.stop(); watcher?.start(); }
  });
};

/** The Updates panel tells the watcher to look more often while it is open. */
export const setUpdateWatchFast = (open: boolean): void => { watcher?.setPanelOpen(open); };
