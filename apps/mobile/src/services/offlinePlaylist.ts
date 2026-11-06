/**
 * Downloads a playlist so it plays with no connection (1.41.0): your sleep playlist with the network off, your
 * favourites in one place on a flight. The decisions live in `offlinePlaylistPlan.ts`; this file carries them out.
 *
 * - Songs the phone already has are linked into the playlist, never downloaded again.
 * - Everything else is queued as playlist-only: it plays from the playlist (and the widget), but stays out of the
 *   Library's song list and the Downloads list. Saving such a song yourself later turns it into an ordinary download
 *   without fetching it again (BackgroundDownloader, `reuseBeforeDownload`).
 * - A downloaded playlist stays downloaded: songs added to it later follow (`refreshOfflinePlaylists`, run at start-up).
 * - Removing the download, or the playlist, deletes the playlist-only files nothing else uses.
 */
import { getOnlineLikes, getOnlinePlaylistSongs, type OnlineSongRow } from '../database/syncQueries';
import { useDownloadQueueStore } from '../store/downloadQueueStore';
import { usePlaylistStore } from '../store/playlistStore';
import { useSettingsStore } from '../store/settingsStore';
import { useSongsStore } from '../store/songsStore';
import type { Song, UnifiedSong } from '../types/song';
import { copiesToUnlink, planOfflinePlaylist, type StreamingEntry } from './offlinePlaylistPlan';
import { resolveOnlineRow } from './sync/onlineSongs';

/** Catalog look-ups at a time: enough to fill the download queue, not enough to flood the network. */
const PARALLEL_LOOKUPS = 3;

/** The playlist's streaming entries: Liked songs keeps its online likes in their own table. */
const streamingRows = async (playlistId: string): Promise<OnlineSongRow[]> => {
  const liked = usePlaylistStore.getState().playlists.find(p => p.id === playlistId)?.isDefault ?? false;
  return liked ? getOnlineLikes().catch(() => []) : getOnlinePlaylistSongs(playlistId).catch(() => []);
};

export interface OfflineRun {
  linked: number;
  queued: number;
  /** Songs the catalog could not find (offline, or gone): tried again next time. */
  missing: number;
}

/** Downloads (or tops up) a playlist for offline play and marks it so new songs follow. */
export const downloadPlaylist = async (playlistId: string): Promise<OfflineRun> => {
  useSettingsStore.getState().setPlaylistOffline(playlistId, true);
  const { getPlaylistSongs, addSongToPlaylistWithOrder } = await import('../database/playlistQueries');
  const [inPlaylist, rows] = await Promise.all([getPlaylistSongs(playlistId).catch(() => [] as Song[]), streamingRows(playlistId)]);
  const entries: StreamingEntry[] = rows.map((row, order) => ({ ref: row.ref, title: row.title, artist: row.artist, order: inPlaylist.length + order }));
  const plan = planOfflinePlaylist(inPlaylist, entries, useSongsStore.getState().songs);

  for (const link of plan.link) {
    await addSongToPlaylistWithOrder(playlistId, link.songId, link.order).catch(() => {});
  }

  // Already queued for this playlist (a second tap, or a top-up while the first run is going): not again.
  const queuedRefs = new Set(useDownloadQueueStore.getState().queue.filter(q => q.targetPlaylistId === playlistId).map(q => q.id));
  const byRef = new Map(rows.map(r => [r.ref, r]));
  const found: { song: UnifiedSong; order: number }[] = [];
  let missing = 0;
  let next = 0;
  const worker = async () => {
    while (next < plan.download.length) {
      const entry = plan.download[next++];
      const row = byRef.get(entry.ref);
      const song = row ? await resolveOnlineRow(row).catch(() => null) : null;
      if (!song) { missing += 1; continue; }
      if (!queuedRefs.has(song.id)) found.push({ song, order: entry.order });
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_LOOKUPS }, worker));
  found.sort((a, b) => a.order - b.order);
  if (found.length > 0) {
    useDownloadQueueStore.getState().addToQueue(found.map(f => f.song), playlistId, found.map(f => f.order), { playlistOnly: true });
  }
  if (plan.link.length > 0) await usePlaylistStore.getState().fetchPlaylists().catch(() => {});
  return { linked: plan.link.length, queued: found.length, missing };
};

/** Deletes playlist-only songs that no playlist holds any more (files and rows). */
export const pruneOrphanPlaylistOnlySongs = async (): Promise<number> => {
  const { getOrphanPlaylistOnlySongIds } = await import('../database/queries');
  const ids = await getOrphanPlaylistOnlySongIds().catch(() => [] as string[]);
  const songs = useSongsStore.getState();
  for (const id of ids) await songs.deleteSong(id).catch(() => {});
  return ids.length;
};

/**
 * Stops keeping a playlist offline: its playlist-only copies leave it (it streams them again, as before) and their
 * files are deleted unless another downloaded playlist still holds them. Songs you saved yourself stay.
 */
export const removePlaylistDownload = async (playlistId: string): Promise<void> => {
  useSettingsStore.getState().setPlaylistOffline(playlistId, false);
  const queue = useDownloadQueueStore.getState();
  for (const item of queue.queue) {
    if (item.playlistOnly && item.targetPlaylistId === playlistId) queue.removeItem(item.id);
  }
  const { getPlaylistSongs, removeSongFromPlaylist } = await import('../database/playlistQueries');
  const [inPlaylist, rows] = await Promise.all([getPlaylistSongs(playlistId).catch(() => [] as Song[]), streamingRows(playlistId)]);
  // Only copies the playlist still lists as streaming entries leave it; a song that exists only as this copy stays.
  for (const song of copiesToUnlink(inPlaylist, rows)) await removeSongFromPlaylist(playlistId, song.id).catch(() => {});
  await pruneOrphanPlaylistOnlySongs();
  await usePlaylistStore.getState().fetchPlaylists().catch(() => {});
};

/** Start-up: downloaded playlists pick up songs added since (here or on another device), then orphans go. */
export const refreshOfflinePlaylists = async (): Promise<void> => {
  const known = new Set(usePlaylistStore.getState().playlists.map(p => p.id));
  const marked = useSettingsStore.getState().offlinePlaylistIds;
  for (const id of marked) {
    if (!known.has(id)) { useSettingsStore.getState().setPlaylistOffline(id, false); continue; }
    await downloadPlaylist(id).catch(() => undefined);
  }
  await pruneOrphanPlaylistOnlySongs();
};
