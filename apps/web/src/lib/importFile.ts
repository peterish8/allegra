/**
 * Reads an import file on the device (D14): the ZIP Spotify sends, its JSON files, or a CSV. Only
 * `YourLibrary.json` and `Playlist<N>.json` are ever inflated, and sizes are checked from the ZIP's
 * central directory before anything is inflated, so a huge or hostile archive costs nothing.
 * Runs inside the import Web Worker; also callable directly (tests).
 */
import { bundleFromSpotifyFiles, parseCsv, type ImportBundle } from '@shared/importParse';
import { scanImportZip } from '@shared/importZip';
import { unzipSync } from 'fflate';

export const IMPORT_FILE_LIMITS = {
  entryBytes: 20 * 1024 * 1024,
  archiveBytes: 200 * 1024 * 1024,
  expandedBytes: 100 * 1024 * 1024,
  entries: 500,
  csvBytes: 20 * 1024 * 1024
} as const;

export type ReadError = 'too_large' | 'unreadable' | 'empty';
export type ReadResult = { readonly bundle: ImportBundle; readonly fileHash: string } | { readonly error: ReadError };

/** The two kinds of file inside the Spotify download that hold songs. */
export function wantedEntry(name: string): boolean {
  const base = (name.split(/[\\/]/u).pop() ?? '').toLowerCase();
  return base === 'yourlibrary.json' || /^playlist\d+\.json$/u.test(base);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseJson(text: string): unknown {
  return JSON.parse(text.replace(/^\uFEFF/u, '')) as unknown;
}

function hasSongs(bundle: ImportBundle): boolean {
  return bundle.liked.length > 0 || bundle.playlists.some((playlist) => playlist.tracks.length > 0);
}

/**
 * The ZIP's wanted entries, inflated, or the reason not to. `inflate` is fflate's unzipSync; it is
 * a parameter only so a test can prove an oversized entry is refused before any inflating.
 */
export function readZipEntries(bytes: Uint8Array, inflate: typeof unzipSync = unzipSync): { name: string; text: string }[] | ReadError {
  const scan = scanImportZip(bytes, { ...IMPORT_FILE_LIMITS, wanted: wantedEntry });
  if (!scan.ok) return scan.error;
  let oversized = false;
  let files: Record<string, Uint8Array>;
  try {
    files = inflate(bytes, {
      filter: (file) => {
        if (!wantedEntry(file.name)) return false;
        if (file.originalSize > IMPORT_FILE_LIMITS.entryBytes || file.size > IMPORT_FILE_LIMITS.entryBytes) {
          oversized = true;
          return false;
        }
        return true;
      }
    });
  } catch {
    return 'unreadable';
  }
  if (oversized) return 'too_large';
  let expanded = 0;
  for (const [name, data] of Object.entries(files)) {
    if (!wantedEntry(name)) continue;
    expanded += data.byteLength;
    if (data.byteLength > IMPORT_FILE_LIMITS.entryBytes || expanded > IMPORT_FILE_LIMITS.expandedBytes) return 'too_large';
  }
  const decoder = new TextDecoder('utf-8');
  return Object.entries(files).map(([name, data]) => ({ name, text: decoder.decode(data) }));
}

export async function readImportFile(file: Blob & { readonly name: string }): Promise<ReadResult> {
  const name = file.name.toLowerCase();
  const isZip = name.endsWith('.zip');
  const isCsv = name.endsWith('.csv');
  const limit = isZip ? IMPORT_FILE_LIMITS.archiveBytes : isCsv ? IMPORT_FILE_LIMITS.csvBytes : IMPORT_FILE_LIMITS.entryBytes;
  if (file.size > limit) return { error: 'too_large' };

  const buffer = await file.arrayBuffer();
  const fileHash = await sha256Hex(buffer);
  let bundle: ImportBundle;
  try {
    if (isCsv) {
      bundle = parseCsv(new TextDecoder('utf-8').decode(buffer));
    } else if (isZip) {
      const entries = readZipEntries(new Uint8Array(buffer));
      if (typeof entries === 'string') return { error: entries };
      if (entries.length === 0) return { error: 'empty' };
      bundle = bundleFromSpotifyFiles(entries.map((entry) => ({ name: entry.name, json: parseJson(entry.text) })));
    } else if (name.endsWith('.json')) {
      bundle = bundleFromSpotifyFiles([{ name: wantedEntry(file.name) ? file.name : 'YourLibrary.json', json: parseJson(new TextDecoder('utf-8').decode(buffer)) }]);
      // A playlist file under another name: try it as one before giving up.
      if (!hasSongs(bundle)) bundle = bundleFromSpotifyFiles([{ name: 'Playlist1.json', json: parseJson(new TextDecoder('utf-8').decode(buffer)) }]);
    } else {
      return { error: 'unreadable' };
    }
  } catch {
    return { error: 'unreadable' };
  }
  return hasSongs(bundle) ? { bundle, fileHash } : { error: 'empty' };
}
