/**
 * Where a whole catalog album stands with downloads, for the one button on its page. Built from the same per-song
 * rule as every song row (`downloadStateOf`), so the album and its rows can never disagree: a song counts as saved
 * only when the queue finished it or the library holds it, never because a request was sent.
 */
import { downloadStateOf, matchKey } from './downloadState';

export interface AlbumSong { id: string; title: string; artist?: string }
export interface AlbumQueueItem { id: string; status: 'pending' | 'staging' | 'downloading' | 'completed' | 'failed' | 'paused'; progress: number }

export type AlbumDownloadPhase = 'unavailable' | 'idle' | 'partial' | 'queued' | 'downloading' | 'paused' | 'failed' | 'saved';

export interface AlbumDownloadState {
  phase: AlbumDownloadPhase;
  /** 0..1 across every song: saved songs count 1, running ones their own progress. */
  progress: number;
  total: number;
  saved: number;
  /** Songs a tap should queue: not saved, not queued, not failed. */
  missing: AlbumSong[];
  /** Songs a tap should retry. Completed songs are never restarted. */
  failed: AlbumSong[];
}

const unavailable = (total: number): AlbumDownloadState => ({ phase: 'unavailable', progress: 0, total, saved: 0, missing: [], failed: [] });

/**
 * `ready` is false while the album is loading, failed to load or is empty: a partial list is never called a
 * complete album, so nothing can be started from it.
 */
export function albumDownloadState(
  songs: readonly AlbumSong[],
  queue: readonly AlbumQueueItem[],
  library: ReadonlySet<string>,
  ready: boolean,
): AlbumDownloadState {
  if (!ready || songs.length === 0) return unavailable(songs.length);
  const byId = new Map(queue.map(item => [item.id, item] as const));
  const seen = new Set<string>();
  let saved = 0, queued = 0, running = 0, paused = 0, total = 0, progress = 0;
  const missing: AlbumSong[] = [];
  const failed: AlbumSong[] = [];
  for (const song of songs) {
    if (seen.has(song.id)) continue;
    seen.add(song.id);
    total += 1;
    const state = downloadStateOf(byId.get(song.id), library.has(matchKey(song.title, song.artist)));
    switch (state.phase) {
      case 'saved': saved += 1; progress += 1; break;
      case 'queued': queued += 1; break;
      case 'downloading': running += 1; progress += state.progress; break;
      case 'paused': paused += 1; progress += state.progress; break;
      case 'failed': failed.push(song); break;
      default: missing.push(song);
    }
  }
  let phase: AlbumDownloadPhase;
  if (saved === total) phase = 'saved';
  else if (running > 0) phase = 'downloading';
  else if (queued > 0) phase = 'queued';
  else if (paused > 0) phase = 'paused';
  else if (failed.length > 0) phase = 'failed';
  else phase = saved > 0 ? 'partial' : 'idle';
  return { phase, progress: progress / total, total, saved, missing, failed };
}

/** Whole percent, for a selector that should wake its screen only when the number moves. */
export const albumPercent = (songs: readonly AlbumSong[], queue: readonly AlbumQueueItem[], library: ReadonlySet<string>): number =>
  Math.round(albumDownloadState(songs, queue, library, true).progress * 100);
