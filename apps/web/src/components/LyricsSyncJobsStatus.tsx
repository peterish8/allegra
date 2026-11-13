import { useEffect, useRef, useState } from 'react';
import { Activity, Check, LoaderCircle, RotateCcw, X } from 'lucide-react';
import type { LyricsSyncJob } from '../lib/lyricAlign/jobs';

interface Props {
  readonly jobs: readonly LyricsSyncJob[];
  readonly onCancel: (jobId: string) => void;
  readonly onRetry: (jobId: string) => void;
  readonly onReview: (jobId: string) => void;
}

function statusLabel(job: LyricsSyncJob): string {
  switch (job.status) {
    case 'queued': return 'Waiting to sync';
    case 'downloading': return 'Preparing the model';
    case 'syncing': return 'Syncing lyrics';
    case 'ready': return 'Ready to review';
    case 'saving': return 'Saving timing';
    case 'saved': return 'Timing saved';
    case 'failed': return 'Could not finish';
    case 'cancelled': return 'Canceled';
  }
}

function isActive(job: LyricsSyncJob): boolean {
  return job.status === 'queued' || job.status === 'downloading' || job.status === 'syncing';
}

export function LyricsSyncJobsStatus({ jobs, onCancel, onRetry, onReview }: Props) {
  const [open, setOpen] = useState(false);
  const notified = useRef(new Set<string>());
  const readyIds = jobs.filter((job) => job.status === 'ready').map((job) => job.id).join('|');
  const activeCount = jobs.filter(isActive).length;
  const readyCount = jobs.filter((job) => job.status === 'ready').length;
  const latest = jobs.at(-1);

  useEffect(() => {
    const newReady = jobs.find((job) => job.status === 'ready' && !notified.current.has(job.id));
    if (newReady) {
      notified.current.add(newReady.id);
      setOpen(true);
    }
  }, [jobs, readyIds]);

  if (!jobs.length) return null;

  return <aside className="lyric-sync-jobs" aria-label="Background lyric sync">
    <button className="lyric-sync-jobs__toggle" type="button" aria-expanded={open} aria-controls="lyric-sync-jobs-panel" onClick={() => setOpen((value) => !value)}>
      {activeCount ? <LoaderCircle size={19} aria-hidden="true" className="lyric-sync-jobs__spinner" />
        : readyCount ? <Check size={19} aria-hidden="true" /> : <Activity size={19} aria-hidden="true" />}
      <span className="lyric-sync-jobs__count">{activeCount || readyCount || jobs.length}</span>
      <span className="sr-only">{activeCount ? `${activeCount} lyric syncs in progress` : readyCount ? `${readyCount} lyric syncs ready to review` : 'Open lyric sync status'}</span>
    </button>
    <p className="sr-only" role="status" aria-live="polite">{latest ? `${latest.target.song.title}: ${statusLabel(latest)}` : ''}</p>
    {open ? <section className="lyric-sync-jobs__panel" id="lyric-sync-jobs-panel" aria-label="Lyric sync status">
      <header><div><h2>Lyric sync</h2><p>Runs in this browser session.</p></div><button type="button" className="lyric-sync-jobs__close" onClick={() => setOpen(false)} aria-label="Close lyric sync status"><X size={18} aria-hidden="true" /></button></header>
      <ul>{[...jobs].reverse().slice(0, 8).map((job) => <li key={job.id} className={`lyric-sync-jobs__item lyric-sync-jobs__item--${job.status}`}>
        <div className="lyric-sync-jobs__heading"><strong>{job.target.song.title}</strong><span>{statusLabel(job)}</span></div>
        <p>{job.target.song.artist}</p>
        {isActive(job) ? <>
          <progress max={100} value={Math.min(100, Math.max(0, job.progress.overall))} aria-label={`${job.target.song.title}: ${job.progress.stage}`} />
          <small>{job.progress.stage} · {Math.round(job.progress.overall)}%</small>
          <button type="button" className="lyric-sync-jobs__text-action" onClick={() => onCancel(job.id)}>Cancel sync</button>
        </> : null}
        {job.status === 'failed' || job.status === 'cancelled' ? <>
          {job.error ? <small role="alert">{job.error}</small> : null}
          <button type="button" className="lyric-sync-jobs__text-action" onClick={() => onRetry(job.id)}><RotateCcw size={15} aria-hidden="true" /> Try again</button>
        </> : null}
        {job.status === 'ready' || job.status === 'saved' ? <>
          {job.status === 'ready' ? <button type="button" className="lyric-sync-jobs__review" onClick={() => onReview(job.id)}>Review timing</button> : <button type="button" className="lyric-sync-jobs__text-action" onClick={() => onReview(job.id)}>Open saved timing</button>}
        </> : null}
        {job.status === 'saving' ? <small role="status">Saving your reviewed timing…</small> : null}
      </li>)}</ul>
    </section> : null}
  </aside>;
}
