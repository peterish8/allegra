/** Account-scoped, local-only recovery for an import. Spotify files and match metadata never leave this device. */
import type { ImportBundle } from '@shared/importParse';
import type { LibraryOp } from '@shared/library';
import type { MatchedTrack } from '@shared/importRun';
import type { ImportState } from './importReducer';

const DB = 'allegra-import';
const VERSION = 2;
const MATCHES = 'matches';
const MANIFESTS = 'manifests';
export const IMPORT_RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ImportCheckpoint {
  readonly accountKey: string;
  readonly fileHash: string;
  readonly updatedAt: number;
  readonly stage: 'preview' | 'matching' | 'review' | 'saving';
  readonly bundle: ImportBundle;
  readonly selection: { readonly includeLiked: boolean; readonly playlists: readonly string[] };
  readonly results: readonly (readonly [string, MatchedTrack])[];
  readonly chunks?: readonly (readonly LibraryOp[])[];
  readonly sentAt?: number;
  readonly acknowledged?: readonly number[];
  readonly saved?: number;
  readonly total?: number;
  readonly added?: number;
  readonly already?: number;
  readonly playlistCount?: number;
  readonly unmatched?: number;
}

interface MatchRow { readonly accountKey: string; readonly fileHash: string; readonly key: string; readonly match: MatchedTrack }

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Version 1 rows had no account identity; discard them rather than leaking checkpoints
      // between profiles that happened to import the same file.
      if (db.objectStoreNames.contains(MATCHES)) db.deleteObjectStore(MATCHES);
      const matches = db.createObjectStore(MATCHES, { keyPath: ['accountKey', 'fileHash', 'key'] });
      matches.createIndex('accountFile', ['accountKey', 'fileHash']);
      if (!db.objectStoreNames.contains(MANIFESTS)) {
        const manifests = db.createObjectStore(MANIFESTS, { keyPath: ['accountKey', 'fileHash'] });
        manifests.createIndex('accountKey', 'accountKey');
        manifests.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('indexedDB write failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('indexedDB write aborted'));
  });
}

/** Old match-cache API retained for in-flight UI call sites; now scoped by account. */
export async function loadProgress(accountKey: string, fileHash: string): Promise<Map<string, MatchedTrack>> {
  try {
    const db = await open();
    try {
      const rows = await new Promise<MatchRow[]>((resolve, reject) => {
        const request = db.transaction(MATCHES, 'readonly').objectStore(MATCHES).index('accountFile').getAll(IDBKeyRange.only([accountKey, fileHash]));
        request.onsuccess = () => resolve(request.result as MatchRow[]);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
      });
      return new Map(rows.map((row) => [row.key, row.match]));
    } finally { db.close(); }
  } catch { return new Map(); }
}

export async function saveProgress(accountKey: string, fileHash: string, entries: readonly (readonly [string, MatchedTrack])[]): Promise<void> {
  try {
    const db = await open();
    try {
      const transaction = db.transaction(MATCHES, 'readwrite');
      const store = transaction.objectStore(MATCHES);
      for (const [key, match] of entries) store.put({ accountKey, fileHash, key, match } satisfies MatchRow);
      await done(transaction);
    } finally { db.close(); }
  } catch { /* Import still works; the visible checkpoint is best-effort on this browser. */ }
}

export async function saveCheckpoint(checkpoint: ImportCheckpoint): Promise<void> {
  try {
    const db = await open();
    try {
      const transaction = db.transaction(MANIFESTS, 'readwrite');
      transaction.objectStore(MANIFESTS).put(checkpoint);
      await done(transaction);
    } finally { db.close(); }
  } catch { /* The UI must still work when browser storage is disabled. */ }
}

export async function loadLatestCheckpoint(accountKey: string): Promise<ImportCheckpoint | null> {
  try {
    const db = await open();
    try {
      const rows = await new Promise<ImportCheckpoint[]>((resolve, reject) => {
        const request = db.transaction(MANIFESTS, 'readonly').objectStore(MANIFESTS).index('accountKey').getAll(IDBKeyRange.only(accountKey));
        request.onsuccess = () => resolve(request.result as ImportCheckpoint[]);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
      });
      const now = Date.now();
      const valid = rows.filter((row) => now - row.updatedAt <= IMPORT_RECOVERY_TTL_MS).sort((a, b) => b.updatedAt - a.updatedAt);
      const stale = rows.filter((row) => now - row.updatedAt > IMPORT_RECOVERY_TTL_MS);
      if (stale.length) void Promise.all(stale.map((row) => clearCheckpoint(accountKey, row.fileHash)));
      return valid[0] ?? null;
    } finally { db.close(); }
  } catch { return null; }
}

export async function clearCheckpoint(accountKey: string, fileHash: string): Promise<void> {
  try {
    const db = await open();
    try {
      const transaction = db.transaction([MANIFESTS, MATCHES], 'readwrite');
      transaction.objectStore(MANIFESTS).delete([accountKey, fileHash]);
      transaction.objectStore(MATCHES).delete(IDBKeyRange.bound([accountKey, fileHash, ''], [accountKey, fileHash, '\uffff']));
      await done(transaction);
    } finally { db.close(); }
  } catch { /* Stale local data expires on the next successful load. */ }
}

export async function clearAccountCheckpoints(accountKey: string): Promise<void> {
  try {
    const db = await open();
    try {
      const transaction = db.transaction([MANIFESTS, MATCHES], 'readwrite');
      const manifests = transaction.objectStore(MANIFESTS).index('accountKey');
      const matches = transaction.objectStore(MATCHES);
      const range = IDBKeyRange.only(accountKey);
      const request = manifests.openKeyCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { transaction.objectStore(MANIFESTS).delete(cursor.primaryKey); cursor.continue(); }
      };
      const matchRequest = matches.index('accountFile').openKeyCursor(IDBKeyRange.bound([accountKey, ''], [accountKey, '\uffff', '\uffff']));
      matchRequest.onsuccess = () => {
        const cursor = matchRequest.result;
        if (cursor) { matches.delete(cursor.primaryKey); cursor.continue(); }
      };
      await done(transaction);
    } finally { db.close(); }
  } catch { /* Local data can be forgotten manually from the import UI. */ }
}

/** Convert the in-memory reducer state to the durable JSON-like form. */
export function checkpointFromState(accountKey: string, state: Exclude<ImportState, { step: 'choose' | 'reading' | 'done' | 'error' }>): ImportCheckpoint {
  if (state.step === 'saving') return {
    accountKey, fileHash: state.fileHash, updatedAt: Date.now(), stage: 'saving', bundle: state.bundle,
    selection: { includeLiked: state.selection.includeLiked, playlists: [...state.selection.playlists] },
    results: [...state.results], chunks: state.chunks, sentAt: state.sentAt, acknowledged: [...state.acknowledged],
    saved: state.saved, total: state.total, added: state.added, already: state.already,
    playlistCount: state.playlists, unmatched: state.unmatched
  };
  return {
    accountKey, fileHash: state.fileHash, updatedAt: Date.now(), stage: state.step, bundle: state.bundle,
    selection: { includeLiked: state.selection.includeLiked, playlists: [...state.selection.playlists] },
    results: state.step === 'matching' || state.step === 'review' ? [...state.results] : []
  };
}

export function stateFromCheckpoint(checkpoint: ImportCheckpoint): Exclude<ImportState, { step: 'choose' | 'reading' | 'done' | 'error' | 'matching' }> {
  const selection = { includeLiked: checkpoint.selection.includeLiked, playlists: new Set(checkpoint.selection.playlists) };
  const results = new Map(checkpoint.results);
  if (checkpoint.stage === 'saving' && checkpoint.chunks && checkpoint.sentAt !== undefined) return {
    step: 'saving', runId: 0, bundle: checkpoint.bundle, fileHash: checkpoint.fileHash, selection, results,
    chunks: checkpoint.chunks, sentAt: checkpoint.sentAt, acknowledged: new Set(checkpoint.acknowledged ?? []),
    saved: checkpoint.saved ?? 0, total: checkpoint.total ?? checkpoint.chunks.flat().length,
    added: checkpoint.added ?? 0, already: checkpoint.already ?? 0, playlists: checkpoint.playlistCount ?? 0,
    unmatched: checkpoint.unmatched ?? 0
  };
  if (checkpoint.stage === 'review') return { step: 'review', bundle: checkpoint.bundle, fileHash: checkpoint.fileHash, selection, results };
  return { step: 'preview', bundle: checkpoint.bundle, fileHash: checkpoint.fileHash, selection };
}
