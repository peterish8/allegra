/**
 * Turns accepted matches into library operations and sends them (PLAN.md I4 "saving"). Requests
 * stay under the API's limits: at most LIBRARY_OPS_MAX operations and 28 KB of UTF-8 JSON envelope
 * each (the body limit is 32 KB). Spotify source IDs keep same-name lists distinct across re-imports,
 * and every operation carries the same `at`, so retrying a chunk is idempotent.
 */
import { LIBRARY_OPS_MAX, type LibraryOp } from './library';
import { sha256Hex } from './sha256';
import type { SongSnapshot } from './songRef';

export const CHUNK_JSON_MAX = 28_000;
export const SAVE_RETRIES = 5;
const DEFAULT_RETRY_AFTER_SECONDS = 10;

export interface ImportPlanInput {
  readonly source: 'spotify-export' | 'csv';
  /** Accepted liked-song matches. */
  readonly liked: readonly SongSnapshot[];
  readonly playlists: readonly { readonly name: string; readonly sourceId?: string; readonly songs: readonly SongSnapshot[] }[];
  /** Refs the listener already likes: counted as "already in your library", not re-sent. */
  readonly alreadyLiked: ReadonlySet<string>;
  readonly now: number;
}

/** 'import-' + the first 12 hex characters of SHA-256(source + ':' + sourceId-or-name). */
export function playlistIdFor(source: string, name: string, sourceId?: string): string {
  return `import-${sha256Hex(`${source}:${sourceId ?? name}`).slice(0, 12)}`;
}

/** Exact UTF-8 byte count without relying on TextEncoder (not present in every supported RN runtime). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export class ImportPlanError extends Error {
  public readonly code = 'operation_too_large';
  public readonly operation?: LibraryOp;

  public constructor(operation?: LibraryOp) {
    super('One imported library operation exceeds the safe request size.');
    this.name = 'ImportPlanError';
    this.operation = operation;
  }
}

const sizeOf = (ops: readonly LibraryOp[], sentAt: number): number =>
  utf8ByteLength(JSON.stringify({ ops, sentAt }));

/** Chunks in order: every like, then per playlist its upsert followed by its songs. */
export function planImportOps(input: ImportPlanInput): { chunks: LibraryOp[][]; already: number; added: number } {
  const ops: LibraryOp[] = [];
  const seen = new Set<string>();
  let already = 0;
  for (const song of input.liked) {
    if (seen.has(song.ref)) continue;
    seen.add(song.ref);
    if (input.alreadyLiked.has(song.ref)) {
      already += 1;
      continue;
    }
    ops.push({ op: 'like', ref: song.ref, song, origin: 'import', at: input.now });
  }
  const added = ops.length;
  for (const playlist of input.playlists) {
    if (playlist.songs.length === 0) continue;
    const playlistId = playlistIdFor(input.source, playlist.name, playlist.sourceId);
    ops.push({ op: 'playlist_upsert', playlistId, name: playlist.name.slice(0, 100), origin: 'import', at: input.now });
    const inList = new Set<string>();
    for (const song of playlist.songs) {
      if (inList.has(song.ref)) continue;
      inList.add(song.ref);
      ops.push({ op: 'playlist_add', playlistId, ref: song.ref, song, origin: 'import', at: input.now });
    }
  }

  const chunks: LibraryOp[][] = [];
  let chunk: LibraryOp[] = [];
  for (const op of ops) {
    if (sizeOf([op], input.now) > CHUNK_JSON_MAX) throw new ImportPlanError(op);
    if (chunk.length > 0 && (chunk.length >= LIBRARY_OPS_MAX || sizeOf([...chunk, op], input.now) > CHUNK_JSON_MAX)) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(op);
  }
  if (chunk.length > 0) chunks.push(chunk);
  return { chunks, already, added };
}

/** Sends the chunks in order; a 429 waits for Retry-After (default 10 s) and retries, up to 5 tries. */
export async function saveImport(chunks: readonly LibraryOp[][], deps: {
  readonly apply: (ops: LibraryOp[]) => Promise<unknown>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly onChunk: (count: number) => void;
}): Promise<'ok' | 'failed'> {
  for (const chunk of chunks) {
    let sent = false;
    for (let attempt = 0; attempt < SAVE_RETRIES && !sent; attempt++) {
      try {
        await deps.apply(chunk);
        sent = true;
      } catch (error) {
        const failure = (typeof error === 'object' && error !== null ? error : {}) as { status?: number; retryAfterSeconds?: number };
        if (failure.status !== 429) return 'failed';
        await deps.sleep((failure.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS) * 1000);
      }
    }
    if (!sent) return 'failed';
    deps.onChunk(chunk.length);
  }
  return 'ok';
}

/** Persistable chunk driver: only a fully accounted-for reply advances the durable cursor. */
export async function saveImportResumable(chunks: readonly (readonly LibraryOp[])[], deps: {
  readonly apply: (ops: LibraryOp[], index: number) => Promise<unknown>;
  readonly accepted: (reply: unknown, opCount: number) => boolean;
  readonly sleep: (ms: number) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly acknowledged?: ReadonlySet<number>;
  readonly onChunk: (index: number, count: number) => void | Promise<void>;
}): Promise<'ok' | 'failed' | 'cancelled'> {
  const acknowledged = new Set(deps.acknowledged ?? []);
  for (const [index, chunk] of chunks.entries()) {
    if (acknowledged.has(index)) continue;
    if (deps.signal?.aborted) return 'cancelled';
    let sent = false;
    for (let attempt = 0; attempt < SAVE_RETRIES && !sent; attempt += 1) {
      try {
        const reply = await deps.apply([...chunk], index);
        if (deps.signal?.aborted) return 'cancelled';
        if (!deps.accepted(reply, chunk.length)) return 'failed';
        sent = true;
      } catch (error) {
        if (deps.signal?.aborted) return 'cancelled';
        const failure = (typeof error === 'object' && error !== null ? error : {}) as { status?: number; retryAfterSeconds?: number };
        if (failure.status !== 429) return 'failed';
        await deps.sleep((failure.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS) * 1000);
      }
    }
    if (!sent) return 'failed';
    acknowledged.add(index);
    await deps.onChunk(index, chunk.length);
  }
  return deps.signal?.aborted ? 'cancelled' : 'ok';
}
