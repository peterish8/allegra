/**
 * The album-level Download action. It adds nothing to the download engine: it reads the same queue and library the
 * song rows read, then hands the songs that still need work to the same `addToQueue` / `retryItem`.
 *
 * A second tap finds nothing left to do (queued songs are no longer missing, retried ones are pending), so rapid
 * taps cannot queue a song twice. Songs already on the phone are skipped, completed songs are never restarted.
 */
import { useDownloadQueueStore } from '../../store/downloadQueueStore';
import { useSongsStore } from '../../store/songsStore';
import type { UnifiedSong } from '../../types/song';
import { albumDownloadState } from '../../utils/catalogAlbumDownload';
import { libraryKeys } from '../../utils/downloadState';

export function startCatalogAlbumDownload(songs: readonly UnifiedSong[], ready: boolean): { queued: number; retried: number } {
  const queueStore = useDownloadQueueStore.getState();
  const state = albumDownloadState(songs, queueStore.queue, libraryKeys(useSongsStore.getState().songs), ready);
  if (state.phase === 'unavailable') return { queued: 0, retried: 0 };
  const wanted = new Set(state.missing.map(song => song.id));
  const toQueue = songs.filter(song => {
    if (!wanted.has(song.id)) return false;
    wanted.delete(song.id);
    return true;
  });
  if (toQueue.length > 0) queueStore.addToQueue(toQueue);
  for (const song of state.failed) queueStore.retryItem(song.id);
  return { queued: toQueue.length, retried: state.failed.length };
}
