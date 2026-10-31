import {
  createPerformanceTrace,
  type PerformanceAttempt,
  type PerformanceCacheState,
  type PerformanceEventName,
  type PerformanceOutcome,
  type PerformanceTraceRecord,
  type PerformanceTraceScope,
} from '@shared/performanceTrace';

export type MobileSearchLane = 'local' | 'online';
type RecordedEvent = Exclude<PerformanceEventName, 'attempt.finished'>;

type NativePlaybackStatus = {
  readonly position?: number;
  readonly isPlaying?: boolean;
  readonly playWhenReady?: boolean;
  readonly isBuffering?: boolean;
  readonly suppressed?: boolean;
};

type PendingPlayback = {
  readonly scope: MobileSearchLane;
  readonly attempt: PerformanceAttempt;
  readonly songId: string;
  lastPosition: number | null;
  lastStatusWasPlaying: boolean;
};

const scopes: Record<MobileSearchLane, PerformanceTraceScope> = {
  local: 'android.search.local',
  online: 'android.search.online',
};

export function createAndroidPerformanceInstrumentation(
  enabled: boolean,
  now?: () => number,
) {
  const trace = createPerformanceTrace({
    enabled,
    platform: 'android',
    ...(now ? { now } : {}),
  });
  let pendingPlayback: PendingPlayback | null = null;

  const clearPlaybackForAttempt = (attempt: PerformanceAttempt | null): void => {
    if (attempt && pendingPlayback?.attempt === attempt) pendingPlayback = null;
  };

  return {
    trace,
    beginSearchAttempt(lane: MobileSearchLane, generation: number): PerformanceAttempt | null {
      if (pendingPlayback?.scope === lane) pendingPlayback = null;
      return trace.beginAttempt(scopes[lane], generation, { scenario: lane });
    },
    record(
      attempt: PerformanceAttempt | null,
      event: RecordedEvent,
      details?: { readonly resultCount?: number; readonly cache?: PerformanceCacheState; readonly durationMs?: number },
    ): boolean {
      return trace.record(attempt, event, details);
    },
    finish(
      attempt: PerformanceAttempt | null,
      outcome: PerformanceOutcome,
      details?: { readonly resultCount?: number; readonly cache?: PerformanceCacheState; readonly durationMs?: number },
    ): boolean {
      clearPlaybackForAttempt(attempt);
      return trace.finish(attempt, outcome, details);
    },
    selectPlayback(lane: MobileSearchLane, attempt: PerformanceAttempt | null, songId: string): boolean {
      if (!attempt || !trace.enabled) return false;
      if (!trace.record(attempt, 'result.selected')) return false;
      pendingPlayback = {
        scope: lane,
        attempt,
        songId,
        lastPosition: null,
        lastStatusWasPlaying: false,
      };
      return true;
    },
    playbackCommanded(attempt: PerformanceAttempt | null): boolean {
      return trace.record(attempt, 'playback.commanded');
    },
    observeNativePlayback(status: NativePlaybackStatus, currentSongId: string | null): boolean {
      const pending = pendingPlayback;
      if (!pending || !trace.enabled) return false;
      if (trace.getActiveAttempt(scopes[pending.scope]) !== pending.attempt) {
        pendingPlayback = null;
        return false;
      }
      if (currentSongId !== pending.songId) {
        pending.lastPosition = null;
        pending.lastStatusWasPlaying = false;
        return false;
      }
      if (typeof status.position !== 'number' || !Number.isFinite(status.position)) {
        pending.lastPosition = null;
        pending.lastStatusWasPlaying = false;
        return false;
      }

      const isActuallyAdvancing = pending.lastStatusWasPlaying
        && status.isPlaying === true
        && status.playWhenReady === true
        && status.isBuffering === false
        && status.suppressed === false
        && pending.lastPosition !== null
        && status.position > pending.lastPosition;

      pending.lastPosition = status.position;
      pending.lastStatusWasPlaying = status.isPlaying === true
        && status.playWhenReady === true
        && status.isBuffering === false
        && status.suppressed === false;

      if (!isActuallyAdvancing) return false;
      trace.record(pending.attempt, 'playback.observed');
      trace.finish(pending.attempt, 'success');
      pendingPlayback = null;
      return true;
    },
    playbackFailed(currentSongId: string | null): boolean {
      const pending = pendingPlayback;
      if (!pending || pending.songId !== currentSongId) return false;
      pendingPlayback = null;
      return trace.finish(pending.attempt, 'playback-failure');
    },
    clearSnapshot(): void {
      for (const scope of Object.values(scopes)) {
        trace.finish(trace.getActiveAttempt(scope), 'aborted');
      }
      pendingPlayback = null;
      trace.clear();
    },
    /** One explicit local adb export; event callbacks and timers never log trace records. */
    dumpSnapshotToLog(): number {
      if (!trace.enabled) return 0;
      const records = trace.exportRecords();
      console.info(`[ALLEGRA_PERF_TRACE_BEGIN]${records.length}`);
      records.forEach(record => console.info(`[ALLEGRA_PERF_TRACE_RECORD]${JSON.stringify(record)}`));
      console.info('[ALLEGRA_PERF_TRACE_END]');
      return records.length;
    },
    dispose(): void {
      pendingPlayback = null;
      trace.dispose();
    },
  };
}

const perfTraceOptIn = process.env.EXPO_PUBLIC_PERF_TRACE === '1';
export const androidPerformance = createAndroidPerformanceInstrumentation(
  perfTraceOptIn,
  () => performance.now(),
);

type LocalPerformanceDebug = {
  snapshot(): readonly PerformanceTraceRecord[];
  clear(): void;
  dumpToLog(): number;
  dispose(): void;
};

if (androidPerformance.trace.enabled) {
  const debugGlobal = globalThis as typeof globalThis & {
    allegraPerformanceTrace?: LocalPerformanceDebug;
  };
  const debugApi: LocalPerformanceDebug = Object.freeze({
    snapshot: () => androidPerformance.trace.exportRecords(),
    clear: () => androidPerformance.clearSnapshot(),
    dumpToLog: () => androidPerformance.dumpSnapshotToLog(),
    dispose: () => {
      androidPerformance.dispose();
      if (debugGlobal.allegraPerformanceTrace === debugApi) delete debugGlobal.allegraPerformanceTrace;
    },
  });
  debugGlobal.allegraPerformanceTrace = debugApi;
}
