import { AppState, type AppStateStatus } from 'react-native';

/** Same rhythm as the website: a stale Blend is checked every 3 s, at most six times, only while it can be seen. */
export const STALE_REFRESH = { everyMs: 3_000, tries: 6 } as const;

/**
 * Re-reads a Blend whose build is still in flight (another member opened it first, or the last build failed and
 * yesterday's list is showing). Stops when `refresh` reports a fresh build, after the last try, while the app is
 * in the background or the screen is hidden, and when the returned stop function runs.
 */
export function watchStaleBlend(refresh: () => Promise<boolean>, visible: () => boolean): () => void {
  let stopped = false;
  let tries = 0;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const canRun = (): boolean => !stopped && visible() && AppState.currentState === 'active';
  const schedule = (): void => {
    if (timer || pending || tries >= STALE_REFRESH.tries || !canRun()) return;
    timer = setTimeout(() => { timer = null; void tick(); }, STALE_REFRESH.everyMs);
  };
  const tick = async (): Promise<void> => {
    if (!canRun()) return;
    pending = true;
    tries += 1;
    let fresh = false;
    try { fresh = await refresh(); } catch { /* the next try or the tap-to-refresh note covers it */ }
    finally { pending = false; }
    if (!fresh) schedule();
    else stopped = true;
  };
  const onAppState = (next: AppStateStatus): void => { if (next === 'active') schedule(); };
  const subscription = AppState.addEventListener('change', onAppState);
  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    subscription.remove();
  };
}
