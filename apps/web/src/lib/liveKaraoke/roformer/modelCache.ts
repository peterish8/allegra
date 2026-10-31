import { ROFORMER_MODEL } from './config';
import { opfsDir, openWriter, readFile, writeFile } from './opfs';
import { Sha256 } from './sha256';

export type ModelProgress = {
  readonly phase: 'checking' | 'downloading' | 'verifying' | 'caching' | 'ready' | 'error';
  readonly file?: string;
  /** Bytes of the whole model (graph + weights) on this device so far, for the loader. */
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
  readonly ratio: number;
  readonly message?: string;
};

const OPFS_DIR = 'allegra-roformer-v1';
/** Written once the weights hashed correctly, so later loads trust their size instead of re-hashing 741 MB. */
const VERIFIED_SUFFIX = '.verified';
const MODEL_BYTES = ROFORMER_MODEL.graphBytes + ROFORMER_MODEL.dataBytes;

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/** Bytes the downloaded model takes in this browser's private storage; 0 when none or unknown. */
export async function roformerCacheBytes(): Promise<number> {
  const dir = await opfsDir([OPFS_DIR], false);
  if (!dir) return 0;
  let total = 0;
  for (const name of [ROFORMER_MODEL.graphFile, ROFORMER_MODEL.dataFile]) total += (await readFile(dir, name))?.size ?? 0;
  return total;
}

/**
 * Delete the downloaded model. A model already loaded this visit keeps working until the
 * page reloads; the next Karaoke start downloads it again.
 */
export async function clearRoformerCache(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * A vendored copy counts only if it is really the model. Next's catch-all answers any
 * unknown path with the app's HTML and a 200, which would otherwise pass for the graph.
 */
async function hasLocalModel(path: string, bytes: number, signal?: AbortSignal): Promise<boolean> {
  try {
    const head = await fetch(path, { method: 'HEAD', signal });
    const type = head.headers.get('content-type') ?? '';
    return head.ok && !type.includes('text/html') && Number(head.headers.get('content-length') || 0) === bytes;
  } catch {
    return false;
  }
}

function localPaths(): { graph: string; data: string } {
  // Absolute: inside a worker a relative path resolves against the worker script, not the site.
  const dir = `${globalThis.location.origin}/models/roformer`;
  return { graph: `${dir}/${ROFORMER_MODEL.graphFile}`, data: `${dir}/${ROFORMER_MODEL.dataFile}` };
}

async function opfsHasVerifiedModel(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const [graph, data, marker] = await Promise.all([
    readFile(dir, ROFORMER_MODEL.graphFile),
    readFile(dir, ROFORMER_MODEL.dataFile),
    readFile(dir, ROFORMER_MODEL.dataFile + VERIFIED_SUFFIX)
  ]);
  return (
    graph?.size === ROFORMER_MODEL.graphBytes &&
    data?.size === ROFORMER_MODEL.dataBytes &&
    (await marker?.text()) === ROFORMER_MODEL.dataSha256
  );
}

/**
 * Whether Karaoke can load the model without downloading it: vendored, or fully cached and
 * verified. Cheap enough for the main thread; decides whether to ask before a download.
 */
export async function roformerModelOnDevice(): Promise<boolean> {
  const dir = await opfsDir([OPFS_DIR], false);
  // Complete by size is enough here (copies cached before the marker existed have none);
  // loading verifies it before use.
  if (dir && (await readFile(dir, ROFORMER_MODEL.dataFile))?.size === ROFORMER_MODEL.dataBytes) return true;
  const local = localPaths();
  return (
    (await hasLocalModel(local.graph, ROFORMER_MODEL.graphBytes)) &&
    (await hasLocalModel(local.data, ROFORMER_MODEL.dataBytes))
  );
}

/** Whole response body in memory: for the 10 MB graph, and when OPFS is unavailable. */
async function downloadToMemory(
  url: string,
  onBytes: (loaded: number) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal, mode: 'cors' });
  if (!res.ok) throw new Error(`Model download failed (${res.status})`);
  if (!res.body) return res.arrayBuffer();
  const total = Number(res.headers.get('content-length') || 0);
  const reader = res.body.getReader();
  // Preallocate when the size is known so the body is never held twice.
  let out = new Uint8Array(total > 0 ? total : 1 << 20);
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.byteLength > out.length) {
      const grown = new Uint8Array(Math.max(out.length * 2, loaded + value.byteLength));
      grown.set(out.subarray(0, loaded));
      out = grown;
    }
    out.set(value, loaded);
    loaded += value.byteLength;
    onBytes(loaded);
  }
  return loaded === out.length ? out.buffer : out.slice(0, loaded).buffer;
}

/**
 * Stream the weights straight into OPFS, hashing as they go. A cut-off download resumes
 * where it stopped (HTTP Range) instead of starting the 741 MB again, and nothing larger
 * than one network read is ever held in memory.
 */
async function downloadToOpfs(
  dir: FileSystemDirectoryHandle,
  name: string,
  url: string,
  bytes: number,
  sha256: string,
  onBytes: (loaded: number) => void,
  signal?: AbortSignal
): Promise<void> {
  let hasher = new Sha256();
  let have = (await readFile(dir, name))?.size ?? 0;
  if (have > bytes) have = 0;
  if (have > 0) {
    const existing = await readFile(dir, name);
    const reader = existing?.slice(0, have).stream().getReader();
    for (;;) {
      if (signal?.aborted) throw abortError();
      const next = await reader?.read();
      if (!next || next.done) break;
      hasher.update(next.value);
    }
    onBytes(have);
    if (have === bytes) {
      // Complete but unmarked: cached before the marker existed. Keep it if it is the model.
      if (hasher.hex() === sha256) {
        await writeFile(dir, name + VERIFIED_SUFFIX, new TextEncoder().encode(sha256));
        return;
      }
      have = 0;
      hasher = new Sha256();
    }
  }

  const res = await fetch(url, { signal, mode: 'cors', headers: have > 0 ? { Range: `bytes=${have}-` } : {} });
  if (have > 0 && res.status !== 206) {
    // The server sent the whole file: start over.
    have = 0;
    hasher = new Sha256();
  }
  if (!res.ok) throw new Error(`Model download failed (${res.status})`);
  if (!res.body) throw new Error('Model download returned no body');

  const writer = await openWriter(dir, name, have);
  let at = have;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value, at);
      hasher.update(value);
      at += value.byteLength;
      onBytes(at);
    }
  } finally {
    await writer.close();
  }
  if (at !== bytes || hasher.hex() !== sha256) {
    await dir.removeEntry(name).catch(() => undefined);
    throw new Error('RoFormer weights checksum mismatch');
  }
  await writeFile(dir, name + VERIFIED_SUFFIX, new TextEncoder().encode(sha256));
}

/** Graph + weights exactly as ORT wants them: bytes in memory, or same-origin URLs. */
export interface RoformerModelFiles {
  readonly graph: Uint8Array | string;
  readonly data: Uint8Array | string;
  readonly fromCache: boolean;
}

/**
 * Resolve the RoFormer graph and its external weights. Order: vendored files under
 * `/models/roformer/`, then the OPFS cache, then a verified, resumable download from the
 * pinned Hugging Face commit straight into OPFS. `signal` stops a download; what arrived
 * so far stays on disk for the next attempt.
 */
export async function ensureRoformerModel(
  onProgress?: (p: ModelProgress) => void,
  signal?: AbortSignal
): Promise<RoformerModelFiles> {
  onProgress?.({ phase: 'checking', ratio: 0.02 });

  const local = localPaths();
  if (
    (await hasLocalModel(local.graph, ROFORMER_MODEL.graphBytes, signal)) &&
    (await hasLocalModel(local.data, ROFORMER_MODEL.dataBytes, signal))
  ) {
    onProgress?.({ phase: 'ready', ratio: 1, message: 'Using local model' });
    return { graph: local.graph, data: local.data, fromCache: true };
  }

  const dir = await opfsDir([OPFS_DIR]);
  const graphUrl = `${ROFORMER_MODEL.baseUrl}/${ROFORMER_MODEL.graphFile}`;
  const dataUrl = `${ROFORMER_MODEL.baseUrl}/${ROFORMER_MODEL.dataFile}`;
  const report = (file: string, loaded: number): void =>
    onProgress?.({
      phase: 'downloading',
      file,
      loadedBytes: loaded,
      totalBytes: MODEL_BYTES,
      ratio: 0.05 + 0.85 * (loaded / MODEL_BYTES)
    });

  // The graph is small: hash it whole, from the cache or a fresh download.
  let graph = dir ? await (await readFile(dir, ROFORMER_MODEL.graphFile))?.arrayBuffer() : undefined;
  let fromCache = true;
  if (!graph || graph.byteLength !== ROFORMER_MODEL.graphBytes || (await sha256Hex(graph)) !== ROFORMER_MODEL.graphSha256) {
    fromCache = false;
    graph = await downloadToMemory(graphUrl, (n) => report(ROFORMER_MODEL.graphFile, n), signal);
    if ((await sha256Hex(graph)) !== ROFORMER_MODEL.graphSha256) throw new Error('RoFormer graph checksum mismatch');
    if (dir) await writeFile(dir, ROFORMER_MODEL.graphFile, new Uint8Array(graph)).catch(() => undefined);
  }

  if (dir) {
    try {
      if (!(await opfsHasVerifiedModel(dir))) {
        fromCache = false;
        await downloadToOpfs(
          dir,
          ROFORMER_MODEL.dataFile,
          dataUrl,
          ROFORMER_MODEL.dataBytes,
          ROFORMER_MODEL.dataSha256,
          (n) => report(ROFORMER_MODEL.dataFile, ROFORMER_MODEL.graphBytes + n),
          signal
        );
      }
      onProgress?.({ phase: 'caching', ratio: 0.93, message: 'Reading the model' });
      const data = await (await readFile(dir, ROFORMER_MODEL.dataFile))?.arrayBuffer();
      if (data?.byteLength === ROFORMER_MODEL.dataBytes) {
        onProgress?.({ phase: 'ready', ratio: 1 });
        return { graph: new Uint8Array(graph), data: new Uint8Array(data), fromCache };
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && /checksum/.test(err.message))) throw err;
      // OPFS refused (quota, locked): download to memory below.
    }
  }

  const data = await downloadToMemory(dataUrl, (n) => report(ROFORMER_MODEL.dataFile, ROFORMER_MODEL.graphBytes + n), signal);
  onProgress?.({ phase: 'verifying', ratio: 0.92 });
  if (new Sha256().update(new Uint8Array(data)).hex() !== ROFORMER_MODEL.dataSha256) {
    throw new Error('RoFormer weights checksum mismatch');
  }
  onProgress?.({ phase: 'ready', ratio: 1 });
  return { graph: new Uint8Array(graph), data: new Uint8Array(data), fromCache: false };
}
