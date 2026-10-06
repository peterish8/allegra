/**
 * Small, local-only performance trace primitives shared by the web and Android apps.
 * No browser, React, storage, network, or native dependencies belong in this file.
 */

export const PERFORMANCE_TRACE_MAX_RECORDS = 250;

export type PerformancePlatform = 'web' | 'android';

export type PerformanceTraceScope =
  | 'web.search-to-play'
  | 'android.search.online'
  | 'android.search.local';

export type PerformanceEventName =
  | 'query.changed'
  | 'search.dispatched'
  | 'catalog.completed'
  | 'artists.completed'
  | 'results.committed'
  | 'results.presented'
  | 'result.selected'
  | 'playback.commanded'
  | 'media.ready'
  | 'media.play'
  | 'media.playing'
  | 'media.waiting'
  | 'media.error'
  | 'playback.observed'
  | 'attempt.finished';

export type PerformanceOutcome =
  | 'success'
  | 'empty'
  | 'search-failure'
  | 'aborted'
  | 'superseded'
  | 'timeout'
  | 'playback-failure'
  | 'remote-routed';

export type PerformanceCacheState = 'cold' | 'warm' | 'unknown';
export type PerformanceScenario = 'online' | 'local';

/** Opaque attempt identity. The helper validates object identity as well as generation. */
export interface PerformanceAttempt {
  readonly attemptId: string;
  readonly generation: number;
}

export interface PerformanceTraceRecord extends PerformanceAttempt {
  readonly platform: PerformancePlatform;
  readonly event: PerformanceEventName;
  /** Elapsed milliseconds on the injected monotonic clock, relative to this attempt. */
  readonly elapsedMs: number;
  /** Optional within-attempt interval measured on that same monotonic clock. */
  readonly durationMs?: number;
  readonly scenario?: PerformanceScenario;
  readonly resultCount?: number;
  readonly cache?: PerformanceCacheState;
  readonly outcome?: PerformanceOutcome;
}

export interface PerformanceTraceDetails {
  readonly durationMs?: number;
  readonly resultCount?: number;
  readonly cache?: PerformanceCacheState;
}

export interface PerformanceTraceOptions {
  readonly enabled: boolean;
  readonly platform: PerformancePlatform;
  readonly now?: () => number;
}

export interface PerformanceTrace {
  readonly enabled: boolean;
  beginAttempt(
    scope: PerformanceTraceScope,
    generation: number,
    metadata?: { readonly scenario?: PerformanceScenario },
  ): PerformanceAttempt | null;
  getActiveAttempt(scope: PerformanceTraceScope): PerformanceAttempt | null;
  record(attempt: PerformanceAttempt | null, event: Exclude<PerformanceEventName, 'attempt.finished'>, details?: PerformanceTraceDetails): boolean;
  finish(attempt: PerformanceAttempt | null, outcome: PerformanceOutcome, details?: PerformanceTraceDetails): boolean;
  exportRecords(): readonly PerformanceTraceRecord[];
  clear(): void;
  dispose(): void;
}

interface ActiveAttempt {
  readonly scope: PerformanceTraceScope;
  readonly token: PerformanceAttempt;
  readonly startedAt: number;
  readonly scenario?: PerformanceScenario;
  readonly seenEvents: Set<Exclude<PerformanceEventName, 'attempt.finished'>>;
  lastElapsedMs: number;
  finished: boolean;
}

const MEDIA_EVENTS = new Set<Exclude<PerformanceEventName, 'attempt.finished'>>([
  'media.ready',
  'playback.observed',
]);

function validDetails(details: PerformanceTraceDetails | undefined): PerformanceTraceDetails {
  if (!details) return {};
  const resultCount = details.resultCount;
  const durationMs = details.durationMs;
  const cache = details.cache;
  return {
    ...(typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
      ? { durationMs }
      : {}),
    ...(typeof resultCount === 'number' && Number.isFinite(resultCount) && resultCount >= 0
      ? { resultCount: Math.floor(resultCount) }
      : {}),
    ...(cache === 'cold' || cache === 'warm' || cache === 'unknown' ? { cache } : {}),
  };
}

/**
 * Create a bounded trace buffer. Disabled traces are true no-ops: they never call the clock,
 * retain records, create attempts, or install any global state.
 */
export function createPerformanceTrace(options: PerformanceTraceOptions): PerformanceTrace {
  const enabledAtCreation = options.enabled;
  const clock = options.now ?? (() => globalThis.performance?.now() ?? 0);
  const records: PerformanceTraceRecord[] = [];
  const activeByScope = new Map<PerformanceTraceScope, ActiveAttempt>();
  const attempts = new WeakMap<PerformanceAttempt, ActiveAttempt>();
  let nextAttemptId = 1;
  let lastClockValue: number | null = null;
  let disposed = false;

  const readClock = (): number => {
    const observed = clock();
    if (!Number.isFinite(observed)) return lastClockValue ?? 0;
    lastClockValue = lastClockValue === null ? observed : Math.max(lastClockValue, observed);
    return lastClockValue;
  };

  const append = (active: ActiveAttempt, event: PerformanceEventName, details?: PerformanceTraceDetails, outcome?: PerformanceOutcome): void => {
    const elapsedMs = Math.max(active.lastElapsedMs, Math.max(0, readClock() - active.startedAt));
    active.lastElapsedMs = elapsedMs;
    const cleanDetails = validDetails(details);
    const record: PerformanceTraceRecord = Object.freeze({
      attemptId: active.token.attemptId,
      generation: active.token.generation,
      platform: options.platform,
      event,
      elapsedMs,
      ...(active.scenario ? { scenario: active.scenario } : {}),
      ...cleanDetails,
      ...(outcome ? { outcome } : {}),
    });
    records.push(record);
    if (records.length > PERFORMANCE_TRACE_MAX_RECORDS) records.splice(0, records.length - PERFORMANCE_TRACE_MAX_RECORDS);
  };

  const closeAttempt = (active: ActiveAttempt, outcome: PerformanceOutcome, details?: PerformanceTraceDetails): boolean => {
    if (active.finished || activeByScope.get(active.scope) !== active) return false;
    active.finished = true;
    append(active, 'attempt.finished', details, outcome);
    activeByScope.delete(active.scope);
    return true;
  };

  return {
    get enabled() {
      return enabledAtCreation && !disposed;
    },
    beginAttempt(scope, generation, metadata) {
      if (!enabledAtCreation || disposed || !Number.isFinite(generation)) return null;
      const previous = activeByScope.get(scope);
      if (previous) closeAttempt(previous, 'superseded');
      const token: PerformanceAttempt = Object.freeze({
        attemptId: `${options.platform}-${nextAttemptId++}`,
        generation,
      });
      const active: ActiveAttempt = {
        scope,
        token,
        startedAt: readClock(),
        ...(metadata?.scenario === 'online' || metadata?.scenario === 'local' ? { scenario: metadata.scenario } : {}),
        seenEvents: new Set(),
        lastElapsedMs: 0,
        finished: false,
      };
      attempts.set(token, active);
      activeByScope.set(scope, active);
      return token;
    },
    getActiveAttempt(scope) {
      if (!enabledAtCreation || disposed) return null;
      return activeByScope.get(scope)?.token ?? null;
    },
    record(attempt, event, details) {
      if (!enabledAtCreation || disposed || !attempt) return false;
      const active = attempts.get(attempt);
      if (!active || active.finished || activeByScope.get(active.scope) !== active) return false;
      if (active.token.generation !== attempt.generation || active.token.attemptId !== attempt.attemptId) return false;
      if (MEDIA_EVENTS.has(event) && active.seenEvents.has(event)) return false;
      active.seenEvents.add(event);
      append(active, event, details);
      return true;
    },
    finish(attempt, outcome, details) {
      if (!enabledAtCreation || disposed || !attempt) return false;
      const active = attempts.get(attempt);
      if (!active || active.token.generation !== attempt.generation || active.token.attemptId !== attempt.attemptId) return false;
      return closeAttempt(active, outcome, details);
    },
    exportRecords() {
      if (!enabledAtCreation) return [];
      return records.map((record) => ({ ...record }));
    },
    clear() {
      if (!enabledAtCreation || disposed) return;
      records.length = 0;
    },
    dispose() {
      if (!enabledAtCreation || disposed) return;
      for (const active of [...activeByScope.values()]) closeAttempt(active, 'aborted');
      disposed = true;
      activeByScope.clear();
    },
  };
}
