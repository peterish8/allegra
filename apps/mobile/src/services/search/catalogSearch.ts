import type { AlbumSummary } from '@shared/types';
import type { AllegraSong } from '../account/allegraApi';
import { toPlayableAllegraSong } from '../account/allegraApi';
import { ALLEGRA_API_URL } from '../account/config';
import type { UnifiedSong } from '../../types/song';

/** The deadline covers headers, JSON parsing and body consumption. */
export async function catalogRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort);
  const timer = setTimeout(abort, 12000);
  try {
    const response = await fetch(`${ALLEGRA_API_URL}${path}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('The catalog could not be reached. Try again.');
    const envelope: { success: boolean; data?: T; error?: string } = await response.json();
    if (!envelope.success || !envelope.data) throw new Error(envelope.error || 'The catalog could not be reached. Try again.');
    return envelope.data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export const searchAlbums = async (query: string, signal?: AbortSignal): Promise<AlbumSummary[]> =>
  (await catalogRequest<{ results: AlbumSummary[] }>(`/api/search/albums?q=${encodeURIComponent(query)}&limit=12`, signal)).results;
export async function loadAlbum(id: string, signal?: AbortSignal): Promise<{ title: string; artist: string; artwork?: string; songs: UnifiedSong[] }> {
  const album = await catalogRequest<AlbumSummary & { songs: AllegraSong[] }>(`/api/albums/${encodeURIComponent(id)}`, signal);
  return { title: album.name, artist: album.artist, artwork: album.artwork ?? undefined, songs: album.songs.map(toPlayableAllegraSong).filter((s): s is UnifiedSong => s !== null) };
}
