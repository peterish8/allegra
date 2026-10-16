/**
 * Small helpers over the origin-private file system, shared by the model and stem caches.
 * Every call fails soft: OPFS can be missing (old browsers, some private windows) or full.
 */

/** `createSyncAccessHandle` exists only in workers, whatever the DOM lib version says. */
interface SyncAccessHandle {
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

interface MaybeSyncFileHandle {
  readonly createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
}

export async function opfsDir(path: readonly string[], create = true): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
    let dir = await navigator.storage.getDirectory();
    for (const name of path) dir = await dir.getDirectoryHandle(name, { create });
    return dir;
  } catch {
    return null;
  }
}

export async function readFile(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

/**
 * A file opened for writing at chosen offsets. In a worker it is a sync access handle
 * (fast, no copy); elsewhere a writable stream, which commits on close.
 */
export interface FileWriter {
  write(data: Uint8Array, at: number): Promise<void>;
  close(): Promise<void>;
}

export async function openWriter(dir: FileSystemDirectoryHandle, name: string, keepBytes: number): Promise<FileWriter> {
  const handle = await dir.getFileHandle(name, { create: true });
  const maybeSync = handle as unknown as MaybeSyncFileHandle;
  if (typeof maybeSync.createSyncAccessHandle === 'function') {
    try {
      const sync = await maybeSync.createSyncAccessHandle.call(handle);
      sync.truncate(keepBytes);
      return {
        write: async (data, at) => {
          sync.write(data, { at });
        },
        close: async () => {
          sync.flush();
          sync.close();
        }
      };
    } catch {
      // Locked by another tab, or not allowed here: use the stream below.
    }
  }
  const writable = await handle.createWritable({ keepExistingData: keepBytes > 0 });
  await writable.truncate(keepBytes);
  return {
    write: async (data, at) => {
      await writable.write({ type: 'write', position: at, data: data as Uint8Array<ArrayBuffer> });
    },
    close: () => writable.close()
  };
}

/** Write a whole small file in one go. */
export async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Uint8Array): Promise<void> {
  const writer = await openWriter(dir, name, 0);
  try {
    await writer.write(data, 0);
  } finally {
    await writer.close();
  }
}

/** Total bytes under a directory, recursively; 0 when it does not exist. */
export async function directoryBytes(dir: FileSystemDirectoryHandle): Promise<number> {
  let total = 0;
  const entries = (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
  for await (const entry of entries) {
    try {
      if (entry.kind === 'file') total += (await (entry as FileSystemFileHandle).getFile()).size;
      else total += await directoryBytes(entry as FileSystemDirectoryHandle);
    } catch {
      // Removed meanwhile: skip it.
    }
  }
  return total;
}

/** Names of the subdirectories of `dir`. */
export async function childDirectories(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  const entries = (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
  for await (const entry of entries) if (entry.kind === 'directory') names.push(entry.name);
  return names;
}
