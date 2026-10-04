/**
 * The newest phone build, read from the public `apk-latest` release (CI replaces it on every push to
 * main; .github/workflows/mobile-apk.yml). Settings shows its real size, version and date and
 * downloads the file the release actually lists, so the page never promises a number or a link that
 * has gone stale. Everything has a fallback: no network, no problem, the fixed link still works.
 */
const RELEASE_API = 'https://api.github.com/repos/peterish8/allegra/releases/tags/apk-latest';

export const ANDROID_APK_FALLBACK_URL = 'https://github.com/peterish8/allegra/releases/download/apk-latest/LuvLyrics.apk';
export const ANDROID_RELEASES_URL = 'https://github.com/peterish8/allegra/releases/tag/apk-latest';

export interface AndroidRelease {
  readonly url: string;
  readonly sizeBytes: number | null;
  /** The app version CI stamped in the release title ("LuvLyrics 0.2.0 — latest build"), if it did. */
  readonly version: string | null;
  /** The commit it was built from, short ("21738ed"), when the release names one. */
  readonly build: string | null;
  readonly publishedAt: Date;
}

interface ReleaseJson {
  readonly name?: unknown;
  readonly published_at?: unknown;
  readonly target_commitish?: unknown;
  readonly assets?: unknown;
}

/** The release as the card shows it, or null when GitHub's answer is not a release with an APK. */
export function parseAndroidRelease(json: unknown): AndroidRelease | null {
  if (!json || typeof json !== 'object') return null;
  const { name, published_at: publishedRaw, assets, target_commitish: target } = json as ReleaseJson;
  if (typeof publishedRaw !== 'string' || !Array.isArray(assets)) return null;
  const publishedAt = new Date(publishedRaw);
  if (Number.isNaN(publishedAt.getTime())) return null;
  const apk = assets.find(
    (asset): asset is { name: string; size?: unknown; browser_download_url: string } =>
      typeof asset === 'object' && asset !== null &&
      typeof (asset as { name?: unknown }).name === 'string' && (asset as { name: string }).name.toLowerCase().endsWith('.apk') &&
      typeof (asset as { browser_download_url?: unknown }).browser_download_url === 'string'
  );
  if (!apk) return null;
  const size = typeof apk.size === 'number' && apk.size > 0 ? apk.size : null;
  const version = typeof name === 'string' ? name.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? null : null;
  const build = typeof target === 'string' && /^[0-9a-f]{7,40}$/i.test(target) ? target.slice(0, 7) : null;
  return { url: apk.browser_download_url, sizeBytes: size, version, build, publishedAt };
}

/** "31.7 MB". */
export function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "today", "yesterday", "3 days ago", or the date. */
export function releasedAgo(when: Date, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - when.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** One look at the release, or null for any failure: the card is complete without it. */
export async function fetchAndroidRelease(signal?: AbortSignal): Promise<AndroidRelease | null> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 8000);
  const abort = (): void => timeout.abort();
  signal?.addEventListener('abort', abort);
  try {
    const response = await fetch(RELEASE_API, { signal: timeout.signal, headers: { Accept: 'application/vnd.github+json' } });
    return response.ok ? parseAndroidRelease(await response.json()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Whether `next` should replace what is showing: a later build only (a slow, cached answer never rolls it back). */
export function isNewerRelease(next: AndroidRelease | null, showing: AndroidRelease | null): next is AndroidRelease {
  if (!next) return false;
  if (!showing) return true;
  return next.publishedAt.getTime() > showing.publishedAt.getTime()
    || (next.publishedAt.getTime() === showing.publishedAt.getTime() && next.url !== showing.url);
}

/** How often an open page looks again. CI publishes a new build on every push to main. */
export const RELEASE_RECHECK_MS = 10 * 60 * 1000;

/**
 * Keeps the newest build in view while the page is open: one look now, again every `intervalMs` while the tab is
 * visible, and at once when the visitor comes back to the tab. `onRelease` hears only builds newer than the last it
 * heard. Returns a function that stops watching.
 */
export function watchAndroidRelease(
  onRelease: (release: AndroidRelease) => void,
  intervalMs: number = RELEASE_RECHECK_MS,
  fetchRelease: (signal: AbortSignal) => Promise<AndroidRelease | null> = fetchAndroidRelease,
): () => void {
  const controller = new AbortController();
  let shown: AndroidRelease | null = null;
  let inFlight = false;
  const look = async (): Promise<void> => {
    if (inFlight || controller.signal.aborted) return;
    inFlight = true;
    try {
      const next = await fetchRelease(controller.signal);
      if (!controller.signal.aborted && isNewerRelease(next, shown)) {
        shown = next;
        onRelease(next);
      }
    } finally {
      inFlight = false;
    }
  };
  const visible = (): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  void look();
  const timer = setInterval(() => { if (visible()) void look(); }, intervalMs);
  const onVisible = (): void => { if (visible()) void look(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  return () => {
    controller.abort();
    clearInterval(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}
