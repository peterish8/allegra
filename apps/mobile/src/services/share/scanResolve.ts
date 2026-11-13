/**
 * A scanned code -> what it stands for, resolved once. The scanner shows this as its result card and the Open button
 * reuses it, so opening is instant (no second lookup).
 */
import { parseSongRef } from '@shared/songRef';
import type { LuvCodePayload } from '@shared/luvCode';
import type { UnifiedSong } from '../../types/song';
import { fetchSharedPlaylist, fetchSharedSong, type SharedPlaylist } from './shareService';
import type { ScanFailure } from './scanFlow';

export type ScanResult =
  | { readonly kind: 'song'; readonly song: UnifiedSong }
  | { readonly kind: 'playlist'; readonly playlist: SharedPlaylist; readonly code: string };

export type ScanOutcome =
  | { readonly ok: true; readonly result: ScanResult }
  | { readonly ok: false; readonly failure: ScanFailure };

export async function resolveScanned(payload: LuvCodePayload): Promise<ScanOutcome> {
  try {
    if (payload.kind === 'playlist') {
      const playlist = await fetchSharedPlaylist(payload.code);
      return playlist ? { ok: true, result: { kind: 'playlist', playlist, code: payload.code } } : { ok: false, failure: 'gone' };
    }
    const ref = parseSongRef(`saavn:${payload.id}`);
    const song = ref ? await fetchSharedSong(`${ref.source}:${ref.id}`) : null;
    return song ? { ok: true, result: { kind: 'song', song } } : { ok: false, failure: 'gone' };
  } catch {
    return { ok: false, failure: 'unreachable' };
  }
}

/** What the card says under the name. */
export function resultSubtitle(result: ScanResult): string {
  if (result.kind === 'song') return result.song.artist || 'Song';
  const count = result.playlist.songs.length;
  return `By ${result.playlist.ownerName} · ${count} ${count === 1 ? 'song' : 'songs'}`;
}

export const resultTitle = (result: ScanResult): string => (result.kind === 'song' ? result.song.title : result.playlist.name);
export const resultCover = (result: ScanResult): string | undefined =>
  result.kind === 'song' ? (result.song.highResArt || result.song.thumbnail || undefined) : (result.playlist.coverUrl ?? result.playlist.songs[0]?.highResArt ?? undefined);
