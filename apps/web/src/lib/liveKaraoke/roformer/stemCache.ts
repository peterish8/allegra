import { STREAM_HOP_SAMPLES } from './chunks';
import { ROFORMER_MODEL } from './config';
import { childDirectories, directoryBytes, opfsDir, readFile, writeFile } from './opfs';
import { Sha256 } from './sha256';
import { decodeChunkStems, encodeChunkStems, type ChunkStemsPcm } from './stemCodec';

/**
 * Separated chunks kept in this browser's private storage, so a song is separated once:
 * replaying it, seeking around it or coming back after a reload costs no GPU time, and a
 * fully cached song needs no download either (its two stems sum to the original).
 *
 *   allegra-stems-v1/<model>-L<layout>/<song hash>/meta.json
 *                                                 /<chunk>.bin
 *
 * The middle directory is the cache key: a different model or chunk layout gets a fresh
 * directory and the stale one is deleted, so old results never outlive a separator change.
 * Nothing here leaves the device.
 */

const ROOT = 'allegra-stems-v1';
/** Bump when chunk boundaries or what a chunk holds change. */
const LAYOUT_VERSION = 1;
export const STEM_CACHE_LIMIT_BYTES = 1024 * 1024 * 1024;
const META = 'meta.json';

export function stemCacheKey(): string {
  return `${ROFORMER_MODEL.dataSha256.slice(0, 12)}-L${LAYOUT_VERSION}-h${STREAM_HOP_SAMPLES}`;
}

export interface StemMeta {
  readonly songId: string;
  readonly totalSamples: number;
  readonly chunkCount: number;
  readonly mono: boolean;
  readonly lastPlayed: number;
  readonly bytes: number;
}

export interface CachedSong {
  readonly name: string;
  readonly bytes: number;
  readonly lastPlayed: number;
}

/** Least recently played first, until what is left fits. The song in use is never picked. */
export function pickEvictions(songs: readonly CachedSong[], limit: number, keep: string | null): string[] {
  let total = songs.reduce((n, s) => n + s.bytes, 0);
  const picked: string[] = [];
  for (const song of [...songs].sort((a, b) => a.lastPlayed - b.lastPlayed)) {
    if (total <= limit) break;
    if (song.name === keep) continue;
    picked.push(song.name);
    total -= song.bytes;
  }
  return picked;
}

function songDirName(songId: string): string {
  return new Sha256().update(new TextEncoder().encode(songId)).hex().slice(0, 32);
}

function parseMeta(text: string | undefined): StemMeta | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<StemMeta>;
    if (
      typeof value.songId === 'string' &&
      typeof value.totalSamples === 'number' &&
      typeof value.chunkCount === 'number' &&
      typeof value.bytes === 'number'
    ) {
      return {
        songId: value.songId,
        totalSamples: value.totalSamples,
        chunkCount: value.chunkCount,
        mono: value.mono === true,
        lastPlayed: typeof value.lastPlayed === 'number' ? value.lastPlayed : 0,
        bytes: value.bytes
      };
    }
  } catch {
    // Damaged: treat as not cached.
  }
  return null;
}

export class StemCache {
  /** Writes run one at a time so meta.json byte counts never race. */
  private queue: Promise<void> = Promise.resolve();
  private readonly metas = new Map<string, StemMeta>();

  private constructor(private readonly dir: FileSystemDirectoryHandle) {}

  /** Null where OPFS is unavailable: karaoke works the same, it just does not remember. */
  public static async open(): Promise<StemCache | null> {
    const root = await opfsDir([ROOT]);
    if (!root) return null;
    const key = stemCacheKey();
    for (const name of await childDirectories(root).catch(() => [])) {
      if (name !== key) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
    }
    const dir = await opfsDir([ROOT, key]);
    return dir ? new StemCache(dir) : null;
  }

  private async songDir(songId: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    try {
      return await this.dir.getDirectoryHandle(songDirName(songId), { create });
    } catch {
      return null;
    }
  }

  /** What is stored for a song: its shape, and which chunks exist. */
  public async probe(songId: string): Promise<{ meta: StemMeta | null; cached: number[] }> {
    const dir = await this.songDir(songId, false);
    if (!dir) return { meta: null, cached: [] };
    const meta = parseMeta(await (await readFile(dir, META))?.text());
    if (!meta || meta.songId !== songId) return { meta: null, cached: [] };
    this.metas.set(songId, meta);
    const cached: number[] = [];
    for (let k = 0; k < meta.chunkCount; k++) if (await readFile(dir, `${k}.bin`)) cached.push(k);
    return { meta, cached };
  }

  public async read(songId: string, index: number): Promise<ChunkStemsPcm | null> {
    const dir = await this.songDir(songId, false);
    const file = dir ? await readFile(dir, `${index}.bin`) : null;
    if (!file) return null;
    return decodeChunkStems(new Uint8Array(await file.arrayBuffer()));
  }

  /**
   * Encode and store one chunk. Queued, never awaited by the separator: the next chunk
   * must not wait for a disk write. The stems are copied before this returns, so the
   * caller may transfer their buffers right after.
   */
  public write(songId: string, index: number, stems: ChunkStemsPcm, shape: { totalSamples: number; chunkCount: number; mono: boolean }): void {
    const copy: ChunkStemsPcm = {
      instrumental: { left: stems.instrumental.left.slice(), right: stems.instrumental.right.slice() },
      vocals: { left: stems.vocals.left.slice(), right: stems.vocals.right.slice() }
    };
    this.enqueue(async () => {
      const dir = await this.songDir(songId, true);
      if (!dir) return;
      const bytes = await encodeChunkStems(copy);
      const previous = (await readFile(dir, `${index}.bin`))?.size ?? 0;
      await writeFile(dir, `${index}.bin`, bytes);
      const before = this.metas.get(songId) ?? parseMeta(await (await readFile(dir, META))?.text());
      const meta: StemMeta = {
        songId,
        ...shape,
        lastPlayed: Date.now(),
        bytes: Math.max(0, (before?.bytes ?? 0) - previous) + bytes.length
      };
      this.metas.set(songId, meta);
      await writeFile(dir, META, new TextEncoder().encode(JSON.stringify(meta)));
    });
  }

  /** Mark a song as just played, so eviction keeps it. */
  public touch(songId: string): void {
    this.enqueue(async () => {
      const dir = await this.songDir(songId, false);
      const meta = this.metas.get(songId) ?? (dir ? parseMeta(await (await readFile(dir, META))?.text()) : null);
      if (!dir || !meta) return;
      const next = { ...meta, lastPlayed: Date.now() };
      this.metas.set(songId, next);
      await writeFile(dir, META, new TextEncoder().encode(JSON.stringify(next)));
    });
  }

  /** Drop least recently played songs until the cache fits its limit again. */
  public evict(keepSongId: string | null): void {
    this.enqueue(async () => {
      const songs: CachedSong[] = [];
      for (const name of await childDirectories(this.dir)) {
        const dir = await this.dir.getDirectoryHandle(name);
        const meta = parseMeta(await (await readFile(dir, META))?.text());
        songs.push({ name, bytes: meta?.bytes ?? (await directoryBytes(dir)), lastPlayed: meta?.lastPlayed ?? 0 });
      }
      const keep = keepSongId ? songDirName(keepSongId) : null;
      for (const name of pickEvictions(songs, STEM_CACHE_LIMIT_BYTES, keep)) {
        await this.dir.removeEntry(name, { recursive: true }).catch(() => undefined);
        for (const [id] of this.metas) if (songDirName(id) === name) this.metas.delete(id);
      }
    });
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch(() => undefined);
  }
}

/** Bytes the stem cache takes in this browser; 0 when none or unknown. */
export async function stemCacheBytes(): Promise<number> {
  const root = await opfsDir([ROOT], false);
  return root ? directoryBytes(root).catch(() => 0) : 0;
}

/** Forget every separated song. Songs separate again the next time Karaoke plays them. */
export async function clearStemCache(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(ROOT, { recursive: true });
    return true;
  } catch (err) {
    return err instanceof DOMException && err.name === 'NotFoundError';
  }
}
