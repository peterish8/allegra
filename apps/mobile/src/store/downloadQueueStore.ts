import { create } from 'zustand';
import { UnifiedSong } from '../types/song';
import { downloadManager } from '../services/DownloadManager';
import { matchKey } from '@shared/songRef';

// Per-item throttle for progress-only store writes — max 4/sec (250ms)
const PROGRESS_THROTTLE_MS = 250;
const progressThrottleMap = new Map<string, number>();

export interface QueueItem {
  id: string; // song ID
  song: UnifiedSong;
  status: 'pending' | 'staging' | 'downloading' | 'completed' | 'failed' | 'paused';
  progress: number;
  stageStatus?: string; // e.g. "Fetching Lyrics...", "Downloading Audio..."
  error?: string;
  targetPlaylistId?: string;
  sortOrder?: number;
  /**
   * Saved only so `targetPlaylistId` plays offline (a downloaded playlist): the song stays out of the Library's list
   * and the Downloads list. Asked for by the listener too, it becomes an ordinary download.
   */
  playlistOnly?: boolean;
}

interface DownloadQueueStore {
  queue: QueueItem[];
  isProcessing: boolean;

  addToQueue: (songs: UnifiedSong[], targetPlaylistId?: string, sortOrders?: number[], options?: { playlistOnly?: boolean }) => void;
  updateItem: (id: string, updates: Partial<QueueItem>) => void;
  removeItem: (id: string) => void;
  clearCompleted: () => void;
  /** Drops the finished or failed items of a song that was deleted from the library, so its Download button is plain again. */
  removeFinishedFor: (song: { title: string; artist?: string; originId?: string }) => void;
  setProcessing: (isProcessing: boolean) => void;

  pauseItem: (id: string) => void;
  resumeItem: (id: string) => void;
  retryItem: (id: string) => void;

  hydrateFromDb: () => Promise<void>;
}

/**
 * New songs joined to the queue. A song already queued is not queued twice: if this request is the listener's own
 * (not only for a playlist), the queued copy stops being playlist-only, so it lands in the Library when it is done.
 */
export const mergeQueue = (
  current: readonly QueueItem[],
  songs: readonly UnifiedSong[],
  targetPlaylistId: string | undefined,
  sortOrders: readonly number[] | undefined,
  playlistOnly: boolean,
): { queue: QueueItem[]; added: QueueItem[]; upgraded: QueueItem[] } => {
  // A Set of queued ids: one pass instead of scanning the queue for every song (O(n + m)).
  const requested = new Set(songs.map(s => s.id));
  const upgraded: QueueItem[] = [];
  const queue = current.map(item => {
    if (!playlistOnly && item.playlistOnly && requested.has(item.id)) {
      const next = { ...item, playlistOnly: false };
      upgraded.push(next);
      return next;
    }
    return item;
  });
  const queued = new Set(current.map(q => q.id));
  const seen = new Set<string>();
  const added: QueueItem[] = [];
  songs.forEach((s, index) => {
    if (queued.has(s.id) || seen.has(s.id)) return;
    seen.add(s.id);
    added.push({
      id: s.id,
      song: s,
      status: 'pending',
      progress: 0,
      stageStatus: 'Waiting...',
      targetPlaylistId,
      sortOrder: sortOrders ? sortOrders[index] : undefined,
      playlistOnly,
    });
  });
  return { queue: [...queue, ...added], added, upgraded };
};

/** What the Downloads list shows: everything except songs saved only for a downloaded playlist (1.41.0). */
export const visibleDownloads = <T extends Pick<QueueItem, 'playlistOnly'>>(queue: readonly T[]): T[] =>
  queue.filter(item => !item.playlistOnly);

export const useDownloadQueueStore = create<DownloadQueueStore>((set, get) => ({
  queue: [],
  isProcessing: false,

  addToQueue: (songs: UnifiedSong[], targetPlaylistId?: string, sortOrders?: number[], options?: { playlistOnly?: boolean }) => {
    set(state => {
      const { queue, added, upgraded } = mergeQueue(state.queue, songs, targetPlaylistId, sortOrders, options?.playlistOnly ?? false);
      if (added.length > 0 || upgraded.length > 0) {
        import('../database/downloadQueueQueries').then(m => {
          [...added, ...upgraded].forEach(item => m.insertJob(item).catch(() => {}));
        }).catch(() => {});
      }
      return { queue };
    });
  },

  updateItem: (id: string, updates: Partial<QueueItem>) => {
    // Throttle progress-only writes to max 4/sec to prevent flooding the store
    const keys = Object.keys(updates);
    if (keys.length === 1 && keys[0] === 'progress') {
      const now = Date.now();
      const last = progressThrottleMap.get(id) ?? 0;
      if (now - last < PROGRESS_THROTTLE_MS) return;
      progressThrottleMap.set(id, now);
    }

    // Persist status transitions — completed jobs are deleted, others updated
    if (updates.status) {
      import('../database/downloadQueueQueries').then(m => {
        if (updates.status === 'completed') {
          m.deleteJob(id).catch(() => {});
        } else {
          m.updateJobStatus(id, updates.status!, updates.error).catch(() => {});
        }
      }).catch(() => {});
    }

    set(state => ({
      queue: state.queue.map(item => item.id === id ? { ...item, ...updates } : item)
    }));
  },

  removeItem: (id: string) => {
    progressThrottleMap.delete(id);
    import('../database/downloadQueueQueries').then(m => m.deleteJob(id)).catch(() => {});
    set(state => ({
      queue: state.queue.filter(item => item.id !== id)
    }));
  },

  clearCompleted: () => {
    import('../database/downloadQueueQueries').then(m => m.deleteCompletedJobs()).catch(() => {});
    set(state => ({
      queue: state.queue.filter(item => item.status !== 'completed')
    }));
  },

  removeFinishedFor: (song) => {
    const key = matchKey(song.title, song.artist);
    const finished = get().queue.filter(item =>
      (item.status === 'completed' || item.status === 'failed') &&
      (matchKey(item.song.title, item.song.artist) === key || (!!song.originId && item.id === song.originId)));
    for (const item of finished) get().removeItem(item.id);
  },

  setProcessing: (isProcessing: boolean) => set({ isProcessing }),

  pauseItem: (id: string) => {
    downloadManager.pauseDownload(id);
    import('../database/downloadQueueQueries').then(m => m.updateJobStatus(id, 'paused')).catch(() => {});
    set(state => ({
      queue: state.queue.map(item =>
        item.id === id ? { ...item, status: 'paused', stageStatus: 'Paused' } : item
      )
    }));
  },

  resumeItem: (id: string) => {
    downloadManager.resumeDownload(id);
    import('../database/downloadQueueQueries').then(m => m.updateJobStatus(id, 'pending')).catch(() => {});
    set(state => ({
      queue: state.queue.map(item =>
        item.id === id ? { ...item, status: 'pending', stageStatus: 'Resuming...' } : item
      )
    }));
  },

  retryItem: (id: string) => {
    import('../database/downloadQueueQueries').then(m => m.updateJobStatus(id, 'pending')).catch(() => {});
    set(state => ({
      queue: state.queue.map(item =>
        item.id === id ? { ...item, status: 'pending', progress: 0, stageStatus: 'Retrying...' } : item
      )
    }));
  },

  hydrateFromDb: async () => {
    try {
      const { loadAllJobs } = await import('../database/downloadQueueQueries');
      const jobs = await loadAllJobs();
      if (jobs.length > 0) {
        set(state => {
          const queued = new Set(state.queue.map(q => q.id));
          return { queue: [...jobs.filter(j => !queued.has(j.id)), ...state.queue] };
        });
      }
    } catch (e) {
      if (__DEV__) console.warn('[DownloadQueueStore] hydrateFromDb failed:', e);
    }
  },
}));
