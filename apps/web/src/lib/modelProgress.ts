/**
 * Byte-weighted download progress for transformers.js `progress_callback` events.
 * The library reports one stream per file, so a per-file percentage jumps back to 0 for every file.
 * This sums `loaded` and `total` across every file seen and reports one percentage that never goes back.
 */

export interface ModelProgressEvent {
  readonly status?: string;
  readonly file?: string;
  readonly loaded?: number;
  readonly total?: number;
  readonly progress?: number;
}

interface FileState {
  loaded: number;
  total: number;
  done: boolean;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function createProgressTracker(onPercent: (percent: number) => void): (event: ModelProgressEvent) => void {
  const files = new Map<string, FileState>();
  let reported = -1;

  return (event) => {
    const name = event.file;
    if (!name) return;
    const status = event.status;
    if (status !== 'initiate' && status !== 'download' && status !== 'progress' && status !== 'done' && status !== 'ready') return;
    const state = files.get(name) ?? { loaded: 0, total: 0, done: false };
    files.set(name, state);
    if (status === 'progress') {
      if (finite(event.loaded)) state.loaded = Math.max(state.loaded, event.loaded);
      if (finite(event.total) && event.total > 0) state.total = Math.max(state.total, event.total);
    } else if (status === 'done') {
      state.done = true;
      if (state.total > 0) state.loaded = state.total;
    }

    let loaded = 0;
    let total = 0;
    let allDone = true;
    for (const file of files.values()) {
      loaded += Math.min(file.loaded, file.total || file.loaded);
      total += file.total;
      if (!file.done) allDone = false;
    }
    if (total <= 0 && !allDone) return;
    let percent = total > 0 ? Math.floor((100 * loaded) / total) : 0;
    // 100 only when every file seen has finished.
    percent = allDone ? 100 : Math.min(percent, 99);
    if (percent > reported) {
      reported = percent;
      onPercent(percent);
    }
  };
}
