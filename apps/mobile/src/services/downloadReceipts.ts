/**
 * @fileoverview Downloads that finished while the app was not running. On Android a download runs in WorkManager
 * and its library row is added by JavaScript when it hears the download succeed; if Android killed the app first,
 * the files were on disk with no row. The worker now leaves a receipt (DownloadReceipt.kt) before it reports, and at
 * the next start each receipt without a row gets one, then is cleared. Adding is idempotent: a song already in the
 * library is never added twice.
 */
import type { Song } from '../types/song';

/** The song's details a download carries into its receipt (DownloadReceipt.kt `meta`). */
export interface ReceiptMeta {
  title: string;
  artist: string;
  album?: string;
  /** Seconds. */
  duration?: number;
  /** The remote cover to show when the worker could not save one. */
  coverFallback?: string;
  /** The catalog song it came from (`saavn:<id>`), so another device can play it. */
  originId?: string;
  /** The catalog's https cover, the one that travels to other devices. */
  coverRemoteUri?: string;
}

/** A finished download, as the worker wrote it. */
export interface DownloadReceipt {
  id: string;
  audioUri: string;
  coverUri: string | null;
  meta: ReceiptMeta;
}

/** What `reconcileDownloadReceipts` needs from the phone; injected so it is tested without a database. */
export interface ReceiptStore {
  /** Every receipt's JSON text. */
  pending(): string[];
  hasSong(id: string): Promise<boolean>;
  addSong(song: Song): Promise<void>;
  clear(id: string): void;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseMeta(raw: unknown): ReceiptMeta | null {
  let meta: unknown;
  try {
    meta = JSON.parse(text(raw) || '{}');
  } catch {
    return null;
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return null;
  }
  const fields = meta as Record<string, unknown>;
  const title = text(fields.title);
  if (!title) {
    return null;
  }
  const duration = typeof fields.duration === 'number' && Number.isFinite(fields.duration) ? fields.duration : undefined;
  return {
    title,
    artist: text(fields.artist),
    album: text(fields.album) || undefined,
    duration,
    coverFallback: text(fields.coverFallback) || undefined,
    originId: text(fields.originId) || undefined,
    coverRemoteUri: text(fields.coverRemoteUri) || undefined,
  };
}

/** A receipt from its JSON text; null for anything incomplete (no id, no audio, no title). */
export function parseReceipt(json: string): DownloadReceipt | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const fields = raw as Record<string, unknown>;
  const id = text(fields.id);
  const audioUri = text(fields.audioUri);
  const meta = parseMeta(fields.meta);
  if (!id || !audioUri || !meta) {
    return null;
  }
  return { id, audioUri, coverUri: text(fields.coverUri) || null, meta };
}

/** The library row for a receipt: the same shape a download made in the app gets. */
export function songFromReceipt(receipt: DownloadReceipt, nowIso: string): Song {
  const { meta } = receipt;
  return {
    id: receipt.id,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    duration: meta.duration ?? 0,
    coverImageUri: receipt.coverUri ?? meta.coverFallback,
    audioUri: receipt.audioUri,
    playCount: 0,
    dateCreated: nowIso,
    dateModified: nowIso,
    lyrics: [],
    gradientId: '0',
    originId: meta.originId,
    coverRemoteUri: meta.coverRemoteUri,
  };
}

/**
 * Adds a library row for every receipt that has none, and clears each receipt once its song is in the library.
 * A receipt whose row could not be added stays for the next start. Resolves to the number of songs added.
 */
export async function reconcileDownloadReceipts(store: ReceiptStore, nowIso: string = new Date().toISOString()): Promise<number> {
  let added = 0;
  for (const json of store.pending()) {
    const receipt = parseReceipt(json);
    if (!receipt) {
      continue;
    }
    try {
      if (!(await store.hasSong(receipt.id))) {
        await store.addSong(songFromReceipt(receipt, nowIso));
        added += 1;
      }
      store.clear(receipt.id);
    } catch {
      // Kept for the next start: the files are on disk, the row will come.
    }
  }
  return added;
}

/**
 * The start-up run against the real library: a receipt's song is looked up by id in SQLite, added through the songs
 * store, and its queue entry is retired with its receipt, so the restored queue does not download it again. Run
 * before the download queue is restored.
 */
export async function reconcileFinishedDownloads(): Promise<number> {
  const [manager, queue, { getSongById }, { useSongsStore }] = await Promise.all([
    import('./DownloadManager'),
    import('../database/downloadQueueQueries'),
    import('../database/queries'),
    import('../store/songsStore'),
  ]);
  return reconcileDownloadReceipts({
    pending: manager.pendingDownloadReceipts,
    hasSong: async id => (await getSongById(id)) !== null,
    addSong: song => useSongsStore.getState().addSong(song),
    clear: id => {
      manager.clearDownloadReceipt(id);
      queue.deleteJob(id).catch(() => undefined);
    },
  });
}
