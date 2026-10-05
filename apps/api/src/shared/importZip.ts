// GENERATED from packages/shared/importZip.ts by `npm run sync:shared`. Do not edit here.
/** ZIP central-directory guard used before decompression. Zip64 sizes fail closed. */
export interface ImportZipLimits {
  readonly archiveBytes: number;
  readonly entryBytes: number;
  readonly expandedBytes: number;
  readonly entries: number;
  readonly wanted: (name: string) => boolean;
}
export type ImportZipScan = { readonly ok: true; readonly entries: readonly { readonly name: string; readonly expandedBytes: number }[] } | { readonly ok: false; readonly error: 'too_large' | 'unreadable' };
const u16 = (bytes: Uint8Array, offset: number): number => (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
const u32 = (bytes: Uint8Array, offset: number): number => (u16(bytes, offset) + u16(bytes, offset + 2) * 0x1_0000) >>> 0;

export function scanImportZip(bytes: Uint8Array, limits: ImportZipLimits): ImportZipScan {
  if (bytes.byteLength > limits.archiveBytes) return { ok: false, error: 'too_large' };
  const searchStart = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (u32(bytes, offset) === 0x06054b50 && offset + 22 + u16(bytes, offset + 20) === bytes.length) { eocd = offset; break; }
  }
  if (eocd < 0 || u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) return { ok: false, error: 'unreadable' };
  const diskCount = u16(bytes, eocd + 8);
  const count = u16(bytes, eocd + 10);
  const size = u32(bytes, eocd + 12);
  const start = u32(bytes, eocd + 16);
  if (count === 0xffff || size === 0xffff_ffff || start === 0xffff_ffff) return { ok: false, error: 'too_large' };
  if (count > limits.entries) return { ok: false, error: 'too_large' };
  if (diskCount !== count || start + size > eocd) return { ok: false, error: 'unreadable' };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: { name: string; expandedBytes: number }[] = [];
  let offset = start;
  let expanded = 0;
  try {
    for (let index = 0; index < count; index += 1) {
      if (offset + 46 > bytes.length || u32(bytes, offset) !== 0x02014b50) return { ok: false, error: 'unreadable' };
      const expandedBytes = u32(bytes, offset + 24);
      const nameLength = u16(bytes, offset + 28);
      const extraLength = u16(bytes, offset + 30);
      const commentLength = u16(bytes, offset + 32);
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > bytes.length) return { ok: false, error: 'unreadable' };
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      expanded += expandedBytes;
      if (expanded > limits.expandedBytes || (limits.wanted(name) && expandedBytes > limits.entryBytes)) return { ok: false, error: 'too_large' };
      entries.push({ name, expandedBytes });
      offset = end;
    }
  } catch { return { ok: false, error: 'unreadable' }; }
  return { ok: true, entries };
}
