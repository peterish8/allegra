import {
  createPerformanceTrace,
  type PerformanceAttempt,
  type PerformanceTraceRecord,
} from '@shared/performanceTrace';

const PERF_TRACE_ENABLED = process.env.NEXT_PUBLIC_PERF_TRACE === '1';

const trace = createPerformanceTrace({
  enabled: PERF_TRACE_ENABLED,
  platform: 'web',
  now: () => performance.now(),
});

interface SelectedPlaybackSource {
  readonly songId: string;
  readonly startPositionSeconds: number;
}

const selectedSources = new WeakMap<PerformanceAttempt, SelectedPlaybackSource>();

export interface LocalPerformanceTraceGlobal {
  snapshot(): readonly PerformanceTraceRecord[];
  clear(): void;
  recordResultsPresented(): boolean;
}

declare global {
  interface Window {
    allegraPerformanceTrace?: LocalPerformanceTraceGlobal;
  }
}

if (PERF_TRACE_ENABLED && typeof window !== 'undefined') {
  Object.defineProperty(window, 'allegraPerformanceTrace', {
    configurable: true,
    value: Object.freeze({
      snapshot: () => trace.exportRecords(),
      clear: () => trace.clear(),
      recordResultsPresented: () => recordWebSearchResultsPresented(),
    } satisfies LocalPerformanceTraceGlobal),
  });
}

export const webPerformanceTrace = PERF_TRACE_ENABLED ? trace : null;

export function associateSelectedPlaybackSource(
  attempt: PerformanceAttempt | null,
  songId: string,
  startPositionSeconds: number,
): void {
  if (!PERF_TRACE_ENABLED || !attempt || !songId) return;
  selectedSources.set(attempt, {
    songId,
    startPositionSeconds: Number.isFinite(startPositionSeconds) ? Math.max(0, startPositionSeconds) : 0,
  });
}

export function matchesSelectedPlaybackSource(attempt: PerformanceAttempt | null, songId: string): boolean {
  if (!PERF_TRACE_ENABLED || !attempt) return false;
  const selected = selectedSources.get(attempt);
  return Boolean(selected && selected.songId === songId);
}

export function hasSelectedPlaybackProgress(attempt: PerformanceAttempt | null, songId: string, positionSeconds: number): boolean {
  if (!PERF_TRACE_ENABLED || !attempt) return false;
  const selected = selectedSources.get(attempt);
  return Boolean(selected
    && selected.songId === songId
    && Number.isFinite(positionSeconds)
    && positionSeconds > selected.startPositionSeconds);
}

export function activeWebSearchAttempt(): PerformanceAttempt | null {
  return webPerformanceTrace?.getActiveAttempt('web.search-to-play') ?? null;
}

export function recordWebSearchResultsPresented(): boolean {
  const attempt = activeWebSearchAttempt();
  return webPerformanceTrace?.record(attempt, 'results.presented') ?? false;
}
