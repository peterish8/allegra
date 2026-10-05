import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system/legacy';
import { unzipSync } from 'fflate';

import { bundleFromSpotifyFiles, parseCsv, type ImportBundle } from '@shared/importParse';
import { scanImportZip } from '@shared/importZip';
import { sha256Hex } from '@shared/sha256';

export const MOBILE_IMPORT_LIMITS = { zipBytes: 20 * 1024 * 1024, entryBytes: 5 * 1024 * 1024, expandedBytes: 30 * 1024 * 1024, entries: 250, jsonBytes: 5 * 1024 * 1024, csvBytes: 5 * 1024 * 1024 } as const;
export type MobileImportError = 'too_large' | 'unreadable' | 'empty' | 'cancelled';
export type MobileImportResult = { readonly bundle: ImportBundle; readonly fileHash: string } | { readonly error: MobileImportError };
export interface PickedImportAsset { readonly name: string; readonly uri: string; readonly size?: number | null }

export const wantedImportEntry = (name: string): boolean => {
  const base = name.split(/[\\/]/u).pop()?.toLowerCase() ?? '';
  return base === 'yourlibrary.json' || /^playlist\d+\.json$/u.test(base);
};

const parseJson = (text: string): unknown => JSON.parse(text.replace(/^\uFEFF/u, '')) as unknown;
const hasSongs = (bundle: ImportBundle): boolean => bundle.liked.length > 0 || bundle.playlists.some((playlist) => playlist.tracks.length > 0);

export function parseMobileImportBytes(name: string, bytes: Uint8Array): MobileImportResult {
  const lowerName = name.toLowerCase();
  const isZip = lowerName.endsWith('.zip');
  const isCsv = lowerName.endsWith('.csv');
  const limit = isZip ? MOBILE_IMPORT_LIMITS.zipBytes : isCsv ? MOBILE_IMPORT_LIMITS.csvBytes : MOBILE_IMPORT_LIMITS.jsonBytes;
  if (bytes.byteLength > limit) return { error: 'too_large' };
  const fileHash = sha256Hex(`allegra-import-base64:${Buffer.from(bytes).toString('base64')}`);
  let bundle: ImportBundle;
  try {
    const text = Buffer.from(bytes).toString('utf8');
    if (isCsv) bundle = parseCsv(text);
    else if (isZip) {
      const scan = scanImportZip(bytes, { archiveBytes: MOBILE_IMPORT_LIMITS.zipBytes, entryBytes: MOBILE_IMPORT_LIMITS.entryBytes, expandedBytes: MOBILE_IMPORT_LIMITS.expandedBytes, entries: MOBILE_IMPORT_LIMITS.entries, wanted: wantedImportEntry });
      if (scan.ok === false) return { error: scan.error };
      let expanded = 0;
      const files = unzipSync(bytes, { filter: (file) => wantedImportEntry(file.name) });
      for (const [entryName, data] of Object.entries(files)) {
        if (!wantedImportEntry(entryName)) continue;
        expanded += data.byteLength;
        if (data.byteLength > MOBILE_IMPORT_LIMITS.entryBytes || expanded > MOBILE_IMPORT_LIMITS.expandedBytes) return { error: 'too_large' };
      }
      const entries = Object.entries(files).filter(([entryName]) => wantedImportEntry(entryName)).map(([entryName, content]) => ({ name: entryName, json: parseJson(Buffer.from(content).toString('utf8')) }));
      if (!entries.length) return { error: 'empty' };
      bundle = bundleFromSpotifyFiles(entries);
    } else if (lowerName.endsWith('.json')) {
      const json = parseJson(text);
      bundle = bundleFromSpotifyFiles([{ name: wantedImportEntry(name) ? name : 'YourLibrary.json', json }]);
      if (!hasSongs(bundle)) bundle = bundleFromSpotifyFiles([{ name: 'Playlist1.json', json }]);
    } else return { error: 'unreadable' };
  } catch { return { error: 'unreadable' }; }
  return hasSongs(bundle) ? { bundle, fileHash } : { error: 'empty' };
}

export async function readPickedImport(asset: PickedImportAsset): Promise<MobileImportResult> {
  const lowerName = asset.name.toLowerCase();
  const maxBytes = lowerName.endsWith('.zip') ? MOBILE_IMPORT_LIMITS.zipBytes : lowerName.endsWith('.csv') ? MOBILE_IMPORT_LIMITS.csvBytes : MOBILE_IMPORT_LIMITS.jsonBytes;
  if (typeof asset.size === 'number' && asset.size > maxBytes) return { error: 'too_large' };
  try {
    const encoded = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
    const bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
    return parseMobileImportBytes(asset.name, bytes);
  } catch { return { error: 'unreadable' }; }
}
