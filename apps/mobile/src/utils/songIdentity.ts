import { fromMobileId, parseSongRef, type SongRef } from '@shared/songRef';
import type { Song } from '../types/song';

/** Resolve the same catalog identity for a streamed song and its downloaded library copy. */
export function canonicalSongRef(
  targetSongId: string,
  localCopy?: Pick<Song, 'id' | 'originId'>,
  currentSong?: Pick<Song, 'id' | 'originId'>,
): SongRef | null {
  const targetRef = fromMobileId(targetSongId) ?? (parseSongRef(targetSongId) ? targetSongId as SongRef : null);
  if (targetRef) return targetRef;
  if (localCopy?.id === targetSongId) {
    const ref = localCopy.originId ? parseSongRef(localCopy.originId) : null;
    if (ref) return `${ref.source}:${ref.id}`;
  }
  if (currentSong?.id === targetSongId) {
    const ref = currentSong.originId ? parseSongRef(currentSong.originId) : null;
    if (ref) return `${ref.source}:${ref.id}`;
  }
  return null;
}
