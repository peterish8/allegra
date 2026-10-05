/**
 * Sends the import's tracks for matching in batches of 50, two requests at a time (PLAN.md I4).
 * Pure orchestration shared by the website and the phone: `send` and `sleep` are injected, so there
 * is no fetch or timer policy here and tests need no network.
 */
import type { ImportedTrack } from './importParse';
import type { SongSnapshot } from './songRef';

export type MatchConfidence = 'exact' | 'close' | 'none';

/** One imported track after matching, as both apps' import flows keep it. */
export interface MatchedTrack {
  /** identityKey(title, artist) of the imported track. */
  readonly key: string;
  readonly track: ImportedTrack;
  readonly song: SongSnapshot | null;
  readonly confidence: MatchConfidence;
  /** Will be saved. Only exact matches start accepted: a close match is a different recording until someone ticks it. */
  readonly accepted: boolean;
  /** Provider/search outage after bounded retries; safe to skip now and retry in a later session. */
  readonly retryable?: boolean;
}

export interface MatchReply {
  readonly index: number;
  readonly song: SongSnapshot | null;
  readonly confidence: 'exact' | 'close' | 'none';
  readonly retryable?: boolean;
}

/** What a failed `send` looks like to the runner: ApiError has both fields. */
interface SendFailure {
  readonly status?: number;
  readonly retryAfterSeconds?: number;
}

export const MATCH_RUN = { batchSize: 50, concurrency: 2, retries: 5, defaultRetryAfterSeconds: 10 } as const;
const TRANSIENT_RESULT_RETRIES = 2;

export type RunOutcome = 'done' | 'cancelled' | { readonly failed: 'network' };

export async function runMatching(input: {
  readonly keys: readonly string[];
  readonly tracks: ReadonlyMap<string, ImportedTrack>;
  readonly send: (tracks: ImportedTrack[], signal: AbortSignal) => Promise<readonly MatchReply[]>;
  readonly signal: AbortSignal;
  readonly onBatch: (results: [string, MatchedTrack][]) => void | Promise<void>;
  readonly batchSize?: number;
  readonly concurrency?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<RunOutcome> {
  const batchSize = input.batchSize ?? MATCH_RUN.batchSize;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const batches: string[][] = [];
  for (let i = 0; i < input.keys.length; i += batchSize) batches.push(input.keys.slice(i, i + batchSize));

  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && !input.signal.aborted && next < batches.length) {
      const keys = batches[next++] as string[];
      const tracks = keys.map((key) => input.tracks.get(key)).filter((track): track is ImportedTrack => track !== undefined);
      let replies: readonly MatchReply[] | null = null;
      for (let attempt = 0; attempt < MATCH_RUN.retries && replies === null; attempt++) {
        try {
          replies = await input.send(tracks, input.signal);
        } catch (error) {
          if (input.signal.aborted) return;
          const failure = (typeof error === 'object' && error !== null ? error : {}) as SendFailure;
          if (failure.status === 429 && attempt < MATCH_RUN.retries - 1) {
            await sleep((failure.retryAfterSeconds ?? MATCH_RUN.defaultRetryAfterSeconds) * 1000);
            continue;
          }
          failed = true;
          return;
        }
      }
      // A reply that lands after cancel is ignored: the page has moved on.
      if (input.signal.aborted || replies === null) return;
      // A successful HTTP request may still contain per-track provider failures. Retry only those
      // indexes in bounded smaller requests; after that they remain visible/skippable and are
      // tagged so a later explicit rematch can distinguish them from a genuine catalog miss.
      let finalReplies = [...(replies ?? [])];
      let pending = keys.flatMap((key, index) => finalReplies.find((reply) => reply.index === index)?.retryable ? [index] : []);
      for (let attempt = 0; pending.length > 0 && attempt < TRANSIENT_RESULT_RETRIES; attempt += 1) {
        if (input.signal.aborted) return;
        await sleep(500 * (attempt + 1));
        if (input.signal.aborted) return;
        try {
          const retry = await input.send(pending.map((index) => tracks[index] as ImportedTrack), input.signal);
          if (input.signal.aborted) return;
          for (const [retryIndex, originalIndex] of pending.entries()) {
            const updated = retry.find((reply) => reply.index === retryIndex);
            if (updated) finalReplies[originalIndex] = { ...updated, index: originalIndex };
          }
          pending = keys.flatMap((key, index) => finalReplies.find((reply) => reply.index === index)?.retryable ? [index] : []);
        } catch (error) {
          if (input.signal.aborted) return;
          const failure = (typeof error === 'object' && error !== null ? error : {}) as SendFailure;
          if (failure.status === 429 && attempt < TRANSIENT_RESULT_RETRIES - 1) continue;
          // A per-track retry transport error leaves only the affected rows retryable.
          break;
        }
      }
      const results = keys.map((key, index): [string, MatchedTrack] => {
        const reply = finalReplies.find((candidate) => candidate.index === index);
        const confidence = reply?.song ? reply.confidence : 'none';
        return [key, {
          key,
          track: input.tracks.get(key) as ImportedTrack,
          song: reply?.song ?? null,
          confidence,
          accepted: confidence === 'exact' && reply?.retryable !== true,
          ...(reply?.retryable ? { retryable: true } : {})
        }];
      });
      await input.onBatch(results);
    }
  };

  await Promise.all(Array.from({ length: Math.min(input.concurrency ?? MATCH_RUN.concurrency, batches.length) }, worker));
  if (input.signal.aborted) return 'cancelled';
  return failed ? { failed: 'network' } : 'done';
}
