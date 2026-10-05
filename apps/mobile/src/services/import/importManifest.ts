import * as SQLite from 'expo-sqlite';

import type { ImportBundle } from '@shared/importParse';
import type { LibraryOp } from '@shared/library';
import type { MatchedTrack } from '@shared/importRun';

const DB_NAME = 'allegra-import.db';
export const MOBILE_IMPORT_RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export interface MobileImportManifest {
  readonly accountKey: string; readonly fileHash: string; readonly updatedAt: number;
  readonly stage: 'preview' | 'matching' | 'review' | 'saving'; readonly bundle: ImportBundle;
  readonly selection: { readonly includeLiked: boolean; readonly playlists: readonly string[] };
  readonly results: readonly (readonly [string, MatchedTrack])[];
  readonly chunks?: readonly (readonly LibraryOp[])[]; readonly sentAt?: number;
  readonly acknowledged?: readonly number[]; readonly saved?: number; readonly total?: number;
  readonly added?: number; readonly already?: number; readonly playlistCount?: number; readonly unmatched?: number;
}

let database: Promise<SQLite.SQLiteDatabase> | null = null;
async function open(): Promise<SQLite.SQLiteDatabase> {
  database ??= SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
    await db.execAsync('CREATE TABLE IF NOT EXISTS import_manifests (account_key TEXT NOT NULL, file_hash TEXT NOT NULL, updated_at INTEGER NOT NULL, manifest TEXT NOT NULL, PRIMARY KEY (account_key, file_hash))');
    await db.execAsync('CREATE INDEX IF NOT EXISTS import_manifests_account_updated ON import_manifests (account_key, updated_at DESC)');
    return db;
  });
  return database;
}

export async function saveMobileManifest(manifest: MobileImportManifest): Promise<void> {
  const db = await open();
  await db.runAsync('INSERT OR REPLACE INTO import_manifests (account_key, file_hash, updated_at, manifest) VALUES (?, ?, ?, ?)', manifest.accountKey, manifest.fileHash, manifest.updatedAt, JSON.stringify(manifest));
}

export async function loadMobileManifest(accountKey: string): Promise<MobileImportManifest | null> {
  const db = await open();
  const current = Date.now();
  await db.runAsync('DELETE FROM import_manifests WHERE account_key = ? AND updated_at < ?', accountKey, current - MOBILE_IMPORT_RECOVERY_TTL_MS);
  const rows = await db.getAllAsync<{ file_hash: string; manifest: string; updated_at: number }>('SELECT file_hash, manifest, updated_at FROM import_manifests WHERE account_key = ? ORDER BY updated_at DESC LIMIT 5', accountKey);
  for (const row of rows) {
    try { return JSON.parse(row.manifest) as MobileImportManifest; } catch { await db.runAsync('DELETE FROM import_manifests WHERE account_key = ? AND file_hash = ?', accountKey, row.file_hash); }
  }
  return null;
}

export async function clearMobileManifest(accountKey: string, fileHash: string): Promise<void> {
  const db = await open();
  await db.runAsync('DELETE FROM import_manifests WHERE account_key = ? AND file_hash = ?', accountKey, fileHash);
}
