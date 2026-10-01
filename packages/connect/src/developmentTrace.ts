import type {
  ConnectTraceEntry,
  ConnectTraceEvent,
  ConnectTraceEventName,
  ConnectTraceOperation,
  DevelopmentTraceBuffer,
  DevelopmentTraceOptions
} from './types.ts';

const MAX_TRACE_ENTRIES = 500;

const eventNames: readonly ConnectTraceEventName[] = [
  'input.started', 'input.confirmed', 'input.failed', 'input.timed_out',
  'receiver.delivered', 'receiver.completed', 'receiver.failed',
  'mutation.started', 'mutation.completed', 'mutation.failed', 'mutation.conflict',
  'query.delivered', 'catalog.requested', 'catalog.completed', 'renderer.tick',
  'adapter.ready', 'timer.scheduled', 'timer.fired', 'timer.cleared'
];

const operations: readonly ConnectTraceOperation[] = [
  'control', 'transfer', 'receiver', 'register', 'heartbeat', 'send', 'report', 'claim',
  'begin', 'prepare', 'release', 'complete',
  'watch', 'devices_query', 'state_query', 'inbox_query', 'outcomes_query', 'player', 'catalog', 'renderer_timer',
  'command_timeout', 'listen_retry', 'send_retry', 'inbox_retry', 'write_retry', 'claim_retry', 'release_retry',
  'handoff_deadline'
];

const outcomes = [
  'ok', 'failed', 'needs_gesture', 'not_found', 'offline', 'timeout', 'conflict', 'rejected', 'expired', 'superseded', 'disposed'
] as const;
const commandKinds = ['play', 'pause', 'seek', 'next', 'prev', 'volume', 'shuffle', 'repeat', 'play_song', 'queue_add', 'take_over'] as const;

/**
 * Creates a bounded, local-only development trace. There is deliberately no
 * callback, network sink, storage, or wall-clock fallback.
 */
export function createDevelopmentTrace(options: DevelopmentTraceOptions): DevelopmentTraceBuffer | undefined {
  if (!options.development || !options.enabled || !options.monotonicNow) return undefined;

  try {
    if (!Number.isFinite(options.monotonicNow())) return undefined;
  } catch {
    return undefined;
  }

  const requestedLimit = options.maxEntries ?? 250;
  const limit = Number.isInteger(requestedLimit)
    ? Math.max(1, Math.min(MAX_TRACE_ENTRIES, requestedLimit))
    : 250;
  const entries: ConnectTraceEntry[] = [];
  let disposed = false;

  return {
    record(event) {
      if (disposed) return;
      try {
        const atMs = options.monotonicNow?.();
        if (!Number.isFinite(atMs) || !isMember(eventNames, event.event) || !isMember(operations, event.operation)) return;
        const requestId = safeCorrelationId(event.requestId, true);
        const commandId = safeCorrelationId(event.commandId, false);
        const durationMs = safeNumber(event.durationMs);
        const payloadBytes = safeNumber(event.payloadBytes);
        const count = safeNumber(event.count);
        const concurrency = safeNumber(event.concurrency);
        const maxConcurrency = safeNumber(event.maxConcurrency);
        const queueLength = safeNumber(event.queueLength);
        const delayMs = safeNumber(event.delayMs);

        const candidate: ConnectTraceEntry = {
          atMs: atMs as number,
          event: event.event,
          operation: event.operation,
          ...(requestId !== undefined ? { requestId } : {}),
          ...(commandId !== undefined ? { commandId } : {}),
          ...(isMember(commandKinds, event.kind) ? { kind: event.kind } : {}),
          ...(isMember(outcomes, event.outcome) ? { outcome: event.outcome } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(payloadBytes !== undefined ? { payloadBytes } : {}),
          ...(count !== undefined ? { count } : {}),
          ...(concurrency !== undefined ? { concurrency } : {}),
          ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
          ...(queueLength !== undefined ? { queueLength } : {}),
          ...(delayMs !== undefined ? { delayMs } : {})
        };
        entries.push(candidate);
        if (entries.length > limit) entries.splice(0, entries.length - limit);
      } catch {
        // Trace collection is diagnostic-only and must never affect playback.
      }
    },
    snapshot() {
      return entries.map((entry) => ({ ...entry }));
    },
    clear() {
      entries.length = 0;
    },
    dispose() {
      disposed = true;
      entries.length = 0;
    }
  };
}

interface CatalogActivity {
  active: number;
  maximum: number;
}

const catalogActivityByTrace = new WeakMap<object, CatalogActivity>();

/** Wraps a catalog request and counts overlapping calls for this local trace. */
export async function traceCatalogLookup<T>(
  trace: import('./types.ts').ConnectTraceWriter | undefined,
  lookup: () => Promise<T>,
  monotonicNow: () => number | undefined = defaultMonotonicNow
): Promise<T> {
  if (!trace) return lookup();
  const activity = catalogActivityByTrace.get(trace as object) ?? { active: 0, maximum: 0 };
  catalogActivityByTrace.set(trace as object, activity);
  activity.active++;
  activity.maximum = Math.max(activity.maximum, activity.active);
  const startedAt = readMonotonic(monotonicNow);
  safeRecord(trace, {
    event: 'catalog.requested',
    operation: 'catalog',
    count: 1,
    concurrency: activity.active,
    maxConcurrency: activity.maximum
  });
  let outcome: 'ok' | 'failed' = 'ok';
  try {
    return await lookup();
  } catch (error) {
    outcome = 'failed';
    throw error;
  } finally {
    activity.active = Math.max(0, activity.active - 1);
    const endedAt = readMonotonic(monotonicNow);
    safeRecord(trace, {
      event: 'catalog.completed',
      operation: 'catalog',
      count: 1,
      concurrency: activity.active,
      maxConcurrency: activity.maximum,
      outcome,
      ...(startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt
        ? { durationMs: endedAt - startedAt }
        : {})
    });
  }
}

/** Returns only a byte count; serialized content is never returned or retained. */
export function estimateSerializedByteLength(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return undefined;
    let bytes = 0;
    for (let index = 0; index < serialized.length; index++) {
      const code = serialized.charCodeAt(index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < serialized.length) {
        const next = serialized.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          index++;
        } else bytes += 3;
      } else bytes += 3;
    }
    return bytes;
  } catch {
    return undefined;
  }
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function safeRecord(trace: import('./types.ts').ConnectTraceWriter, event: ConnectTraceEvent): void {
  try {
    trace.record(event);
  } catch {
    // A diagnostics writer is never allowed to change catalog behavior.
  }
}

function readMonotonic(clock: () => number | undefined): number | undefined {
  try {
    const value = clock();
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function defaultMonotonicNow(): number | undefined {
  const performanceClock = globalThis.performance;
  return typeof performanceClock?.now === 'function' ? performanceClock.now() : undefined;
}

function isMember<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}

function safeCorrelationId(value: unknown, allowLocalRequestId: boolean): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return undefined;
  if (allowLocalRequestId && /^req-[0-9]{1,12}$/.test(value)) return value;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `id-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
