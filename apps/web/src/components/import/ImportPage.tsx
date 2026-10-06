import { FileArchive, FileSpreadsheet, LogIn, Search, Upload } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type ChangeEvent, type ReactNode } from 'react';

import { creditedArtists, identityKey } from '@shared/identity';
import { playlistIdentity } from '@shared/importParse';
import type { ImportedTrack } from '@shared/importParse';
import type { SongSnapshot } from '@shared/songRef';

import { applyLibraryOps, matchImportTracks, searchSongs, sendImportSeed, snapshotForAccount } from '../../lib/api';
import type { ReadResult } from '../../lib/importFile';
import { runMatching } from '@shared/importRun';
import { checkpointFromState, clearCheckpoint, loadLatestCheckpoint, loadProgress, saveCheckpoint, saveProgress, stateFromCheckpoint, type ImportCheckpoint } from '../../lib/importProgressStore';
import { importReducer, INITIAL_IMPORT, selectedTracks, type ImportState, type MatchedTrack } from '../../lib/importReducer';
import { ImportPlanError, planImportOps, saveImportResumable } from '@shared/importPlan';
import { SpotifySyncPanel } from './SpotifySyncPanel';
import { paths } from '../../lib/routes';
import { useThrottled } from '../../hooks/useThrottled';
import { latestFoundText } from '@shared/importCrate';
import { itemVariants, LIVE_SUMMARY_MS, pageVariants, swapVariants, TICKER_PER_SECOND } from '../../motion';
import { ProgressBar, TactileButton } from '../ui';
import { InfoTour } from '../InfoTour';
import { IMPORT_TOUR } from '../pageTours';
import { importScene } from '../infoScenes';

/** PLAN.md §9. */
const COPY = {
  signin: 'Sign in to import your library, so it follows you to every device.',
  toolarge: "That file has more than 10,000 songs. We'll import the first 10,000.",
  unreadable: "We couldn't read that file. Pick the ZIP or the JSON files from Spotify's data download, or a CSV.",
  network: 'Matching paused because the connection dropped. Your progress is saved; carry on when you’re back online.',
  tooBig: 'That file is bigger than Allegra can read in the browser (200 MB for a ZIP, 20 MB per file).',
  empty: "We couldn't find any songs in that file.",
  saveFailed: 'Saving paused because the connection dropped. Songs already saved stay saved; carry on to add the rest.'
} as const;

const SEED_ARTISTS = 25;

interface ImportPageProps {
  /** Stable account identity; durable checkpoints are private to this account. */
  readonly accountKey: string | null;
  /** A signed-in account (not a guest). Import is for accounts only. */
  readonly signedIn: boolean;
  readonly onSignIn: () => void;
  /** Bare Saavn ids the listener already likes. */
  readonly likedIds: ReadonlySet<string>;
  /** After saving: reload liked songs and playlists. */
  readonly onSaved: () => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
const saavnId = (song: SongSnapshot): string | null => (song.ref.startsWith('saavn:') ? song.ref.slice('saavn:'.length) : null);

export function ImportPage({ accountKey, signedIn, onSignIn, likedIds, onSaved }: ImportPageProps) {
  const [state, dispatch] = useReducer(importReducer, INITIAL_IMPORT);
  const [checkpoint, setCheckpoint] = useState<ImportCheckpoint | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const matching = useRef<AbortController | null>(null);
  const saving = useRef<AbortController | null>(null);
  const savingJob = useRef(false);
  const runId = useRef(0);
  const readId = useRef(0);
  const activeAccount = useRef(accountKey);

  useEffect(() => () => {
    runId.current += 1;
    readId.current += 1;
    worker.current?.terminate();
    matching.current?.abort();
    saving.current?.abort();
  }, []);

  useEffect(() => {
    let current = true;
    if (activeAccount.current !== accountKey) {
      activeAccount.current = accountKey;
      runId.current += 1; readId.current += 1;
      worker.current?.terminate(); matching.current?.abort(); saving.current?.abort();
      dispatch({ type: 'reset' });
    }
    setCheckpoint(null);
    if (!signedIn || !accountKey) return () => { current = false; };
    void loadLatestCheckpoint(accountKey).then((found) => { if (current) setCheckpoint(found); });
    return () => {
      current = false;
      runId.current += 1;
      matching.current?.abort();
      saving.current?.abort();
    };
  }, [accountKey, signedIn]);

  useEffect(() => {
    if (!accountKey || !['preview', 'matching', 'review', 'saving'].includes(state.step)) return;
    const durable = checkpointFromState(accountKey, state as Exclude<ImportState, { step: 'choose' | 'reading' | 'done' | 'error' }>);
    void saveCheckpoint(durable).then(() => setCheckpoint(durable));
  }, [accountKey, state]);

  useEffect(() => {
    if (state.step !== 'saving' || savingJob.current || !accountKey) return;
    savingJob.current = true;
    const controller = new AbortController();
    saving.current = controller;
    void (async () => {
      const outcome = await saveImportResumable(state.chunks, {
        acknowledged: state.acknowledged,
        signal: controller.signal,
        apply: (ops) => applyLibraryOps(ops, { sentAt: state.sentAt, signal: controller.signal }),
        accepted: (reply, count) => {
          const result = reply as { applied?: number; superseded?: readonly number[]; rejected?: readonly unknown[] };
          return Array.isArray(result.rejected) && result.rejected.length === 0 && Number.isInteger(result.applied)
            && Array.isArray(result.superseded) && result.applied! + result.superseded.length === count;
        },
        sleep,
        onChunk: (index, count) => dispatch({ type: 'savedChunk', runId: state.runId, index, count })
      });
      if (outcome !== 'ok') {
        dispatch({ type: 'saveFailed', runId: state.runId, message: COPY.saveFailed });
        return;
      }
      await clearCheckpoint(accountKey, state.fileHash);
      setCheckpoint(null);
      const counts = new Map<string, number>();
      for (const op of state.chunks.flat()) if ((op.op === 'like' || op.op === 'playlist_add') && op.song) {
        const lead = creditedArtists(op.song.artist)[0];
        if (lead) counts.set(lead, (counts.get(lead) ?? 0) + 1);
      }
      const artists = [...counts].sort((a, b) => b[1] - a[1]).slice(0, SEED_ARTISTS).map(([name, count]) => ({ name, count }));
      if (artists.length > 0) void sendImportSeed(artists).catch(() => undefined);
      dispatch({ type: 'finish', runId: state.runId, added: state.added, already: state.already, playlists: state.playlists, unmatched: state.unmatched });
      onSaved();
    })().catch(() => dispatch({ type: 'saveFailed', runId: state.runId, message: COPY.saveFailed })).finally(() => {
      savingJob.current = false;
      saving.current = null;
    });
  }, [accountKey, onSaved, state]);

  const read = useCallback((file: File) => {
    const currentRead = ++readId.current;
    dispatch({ type: 'pick', fileName: file.name });
    worker.current?.terminate();
    const reader = new Worker(new URL('./importWorker.ts', import.meta.url), { type: 'module' });
    worker.current = reader;
    const finish = (): void => {
      reader.terminate();
      if (worker.current === reader) worker.current = null;
    };
    reader.onmessage = (event: MessageEvent<ReadResult>) => {
      finish();
      if (currentRead !== readId.current) return;
      const result = event.data;
      if ('bundle' in result) dispatch({ type: 'read', bundle: result.bundle, fileHash: result.fileHash });
      else dispatch({ type: 'fail', kind: 'file', resumable: false, message: result.error === 'too_large' ? COPY.tooBig : result.error === 'empty' ? COPY.empty : COPY.unreadable });
    };
    reader.onerror = () => {
      finish();
      if (currentRead !== readId.current) return;
      dispatch({ type: 'fail', kind: 'file', resumable: false, message: COPY.unreadable });
    };
    reader.postMessage({ file });
  }, []);

  const startMatching = useCallback(async (current: Extract<ImportState, { step: 'preview' }>) => {
    if (!accountKey) return;
    const tracks = selectedTracks(current.bundle, current.selection);
    const currentRun = ++runId.current;
    dispatch({ type: 'startMatching', total: tracks.size, runId: currentRun });
    const controller = new AbortController();
    matching.current?.abort();
    matching.current = controller;
    // Resume: what this file already matched (on this device) is not sent again.
    const previous = await loadProgress(accountKey, current.fileHash);
    if (currentRun !== runId.current || controller.signal.aborted) return;
    const known = [...previous].filter(([key, match]) => tracks.has(key) && !match.retryable);
    if (known.length > 0) dispatch({ type: 'matched', runId: currentRun, results: known });
    const missing = [...tracks.keys()].filter((key) => !previous.has(key) || previous.get(key)?.retryable === true);
    const outcome = await runMatching({
      keys: missing,
      tracks,
      signal: controller.signal,
      send: (batch: ImportedTrack[], signal: AbortSignal) => matchImportTracks(batch, signal),
      onBatch: async (results) => {
        if (currentRun !== runId.current) return;
        dispatch({ type: 'matched', runId: currentRun, results });
        await saveProgress(accountKey, current.fileHash, results);
      }
    });
    if (currentRun !== runId.current) return;
    if (outcome === 'done') dispatch({ type: 'finishMatching' });
    else if (outcome !== 'cancelled') dispatch({ type: 'fail', kind: 'network', resumable: true, message: COPY.network });
    if (matching.current === controller) matching.current = null;
  }, [accountKey]);

  const cancel = useCallback(() => {
    runId.current += 1;
    matching.current?.abort();
    if (matching.current) dispatch({ type: 'cancel' });
    saving.current?.abort();
  }, []);

  const save = useCallback(async (current: Extract<ImportState, { step: 'review' }>) => {
    const accepted = (track: ImportedTrack): SongSnapshot | null => {
      const match = current.results.get(selectedKey(track));
      return match?.accepted && match.song ? match.song : null;
    };
    const liked = current.selection.includeLiked ? current.bundle.liked.map(accepted).filter((song): song is SongSnapshot => song !== null) : [];
    const playlists = current.bundle.playlists
      .filter((playlist) => current.selection.playlists.has(playlistIdentity(playlist)))
      .map((playlist) => ({ name: playlist.name, sourceId: playlist.sourceId, songs: playlist.tracks.map(accepted).filter((song): song is SongSnapshot => song !== null) }));
    const alreadyLiked = new Set(liked.filter((song) => likedIds.has(saavnId(song) ?? '')).map((song) => song.ref));
    let plan: ReturnType<typeof planImportOps>;
    try {
      plan = planImportOps({ source: current.bundle.source, liked, playlists, alreadyLiked, now: Date.now() });
      setPlanError(null);
    } catch (error) {
      if (error instanceof ImportPlanError) {
        const title = error.operation && 'song' in error.operation ? error.operation.song?.title : undefined;
        setPlanError(title ? `“${title}” has metadata too large for one save request. Uncheck it in the review list and try again.` : 'One imported item is too large to save. Remove it from the review list and try again.');
        return;
      }
      throw error;
    }
    const unmatched = [...current.results.values()].filter((match) => !match.accepted || !match.song).length;
    dispatch({ type: 'save', runId: ++runId.current, chunks: plan.chunks, sentAt: Date.now(), total: plan.chunks.reduce((total, chunk) => total + chunk.length, 0), added: plan.added, already: plan.already, playlists: playlists.filter((playlist) => playlist.songs.length > 0).length, unmatched });
  }, [likedIds]);

  const restore = useCallback(() => {
    if (!checkpoint) return;
    if (accountKey && checkpoint.stage === 'matching') void saveProgress(accountKey, checkpoint.fileHash, checkpoint.results);
    const restored = stateFromCheckpoint(checkpoint);
    dispatch({ type: 'restore', state: restored.step === 'saving' ? { ...restored, runId: ++runId.current } : restored });
    setCheckpoint(null);
  }, [accountKey, checkpoint]);

  const forget = useCallback(() => {
    if (!checkpoint || !accountKey) return;
    void clearCheckpoint(accountKey, checkpoint.fileHash);
    setCheckpoint(null);
  }, [accountKey, checkpoint]);

  return (
    <motion.section className="import-page" aria-labelledby="import-title" variants={pageVariants} initial="hidden" animate="visible">
      <motion.header className="import-head" variants={itemVariants}>
        <div className="page-title-row"><h1 id="import-title">Bring your music</h1><InfoTour label="How importing works" steps={IMPORT_TOUR} stage={importScene} /></div>
      </motion.header>
      {!signedIn ? (
        <motion.div className="state-card" variants={itemVariants}>
          <h3>Import needs an account</h3>
          <p>{COPY.signin}</p>
          <TactileButton variant="accent" icon={LogIn} onClick={onSignIn}>Sign in</TactileButton>
        </motion.div>
      ) : (
        <motion.div variants={itemVariants}>
          {!accountKey ? <p className="import-note" role="status">Loading your account…</p> : null}
          <SpotifySyncPanel accountKey={accountKey} />
          <Step state={state} dispatch={dispatch} onFile={read} onMatch={startMatching} onCancel={cancel} onSave={save} checkpoint={state.step === 'choose' ? checkpoint : null} onRestore={restore} onForget={forget} planError={planError} />
        </motion.div>
      )}
    </motion.section>
  );
}

const selectedKey = (track: ImportedTrack): string => identityKey(track.title, track.artist);

function FileCard({ title, icon, accept, hint, children, onFile }: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly accept: string;
  readonly hint: string;
  readonly children?: ReactNode;
  readonly onFile: (file: File) => void;
}) {
  const id = useId();
  const pick = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onFile(file);
  };
  return (
    <div className="import-card">
      <h2 className="import-card__title"><span aria-hidden="true">{icon}</span>{title}</h2>
      {children}
      <label className="import-file" htmlFor={id}>
        <Upload size={16} aria-hidden="true" />
        <span>{hint}</span>
      </label>
      <input id={id} className="import-file__input" type="file" accept={accept} onChange={pick} />
    </div>
  );
}

type Dispatch = (action: Parameters<typeof importReducer>[1]) => void;

function Step({ state, dispatch, onFile, onMatch, onCancel, onSave, checkpoint, onRestore, onForget, planError }: {
  readonly state: ImportState;
  readonly dispatch: Dispatch;
  readonly onFile: (file: File) => void;
  readonly onMatch: (state: Extract<ImportState, { step: 'preview' }>) => void;
  readonly onCancel: () => void;
  readonly onSave: (state: Extract<ImportState, { step: 'review' }>) => void;
  readonly checkpoint: ImportCheckpoint | null;
  readonly onRestore: () => void;
  readonly onForget: () => void;
  readonly planError: string | null;
}) {
  switch (state.step) {
    case 'choose':
      return (
        <div className="import-choose">
          {checkpoint ? (
            <div className="state-card" role="status">
              <h2>Import in progress</h2>
              <p>{checkpoint.stage === 'saving' ? 'Some library changes may already be saved.' : 'Your song matches and review choices are saved on this device.'} Continue to finish this import, or forget its local progress.</p>
              <div className="import-actions">
                <TactileButton variant="accent" onClick={onRestore}>Continue import</TactileButton>
                <TactileButton variant="ghost" onClick={onForget}>Forget progress</TactileButton>
              </div>
            </div>
          ) : null}
          <FileCard title="Spotify data download" icon={<FileArchive size={18} />} accept=".zip,.json" hint="Choose the ZIP or JSON files" onFile={onFile}>
            <ol className="import-steps">
              <li>In Spotify, open Account, then Privacy settings.</li>
              <li>Under &ldquo;Download your data&rdquo;, request &ldquo;Account data&rdquo;.</li>
              <li>It can take a few days to arrive. When it does, pick the ZIP here.</li>
            </ol>
          </FileCard>
          <FileCard title="CSV file" icon={<FileSpreadsheet size={18} />} accept=".csv,text/csv" hint="Choose a CSV file" onFile={onFile}>
            <p className="import-note">From any exporter. Needs a title and an artist column.</p>
          </FileCard>
        </div>
      );

    case 'reading':
      return <p className="import-status" role="status">Reading {state.fileName}&hellip;</p>;

    case 'preview': {
      const { bundle, selection } = state;
      const total = selectedTracks(bundle, selection).size;
      return (
        <div className="import-panel">
          <p className="import-lead">{bundle.liked.length} liked {bundle.liked.length === 1 ? 'song' : 'songs'} and {bundle.playlists.length} {bundle.playlists.length === 1 ? 'playlist' : 'playlists'}</p>
          {bundle.truncated ? <p className="import-note" role="note">{COPY.toolarge}</p> : null}
          {bundle.skipped > 0 ? <p className="import-note">{bundle.skipped} podcasts, local files or unreadable rows are left out.</p> : null}
          <fieldset className="import-choices">
            <legend>What to bring</legend>
            {bundle.liked.length > 0 ? (
              <label className="import-check"><input type="checkbox" checked={selection.includeLiked} onChange={() => dispatch({ type: 'toggleLiked' })} /><span>Liked songs ({bundle.liked.length})</span></label>
            ) : null}
            {bundle.playlists.map((playlist, index) => (
              <label key={playlistIdentity(playlist)} className="import-check"><input type="checkbox" checked={selection.playlists.has(playlistIdentity(playlist))} onChange={() => dispatch({ type: 'togglePlaylist', name: playlistIdentity(playlist) })} /><span>{playlist.name}{bundle.playlists.filter((item) => item.name === playlist.name).length > 1 ? ` · ${index + 1}` : ''} ({playlist.tracks.length})</span></label>
            ))}
          </fieldset>
          <div className="import-actions">
            <TactileButton variant="accent" icon={Search} disabled={total === 0} onClick={() => onMatch(state)}>Find them in Allegra</TactileButton>
            <TactileButton variant="ghost" onClick={() => dispatch({ type: 'reset' })}>Pick another file</TactileButton>
          </div>
        </div>
      );
    }

    case 'matching':
      return <Matching done={state.done} total={state.total} results={state.results} onCancel={onCancel} />;

    case 'review':
      return <Review state={state} dispatch={dispatch} onSave={onSave} planError={planError} />;

    case 'saving':
      return (
        <div className="import-panel">
          <p className="import-lead">Saving {state.saved} of {state.total}</p>
          <ProgressBar value={state.saved} max={state.total} label="Saving to your library" />
          <p className="import-note">Large libraries take a few minutes. You can keep listening meanwhile. If you leave, this import can be resumed from this account on this device.</p>
          <div className="import-actions"><TactileButton variant="ghost" onClick={onCancel}>Pause saving</TactileButton></div>
        </div>
      );

    case 'done':
      return (
        <div className="import-panel">
          <p className="import-lead">Done.</p>
          <ul className="import-counts">
            <li><strong>{state.added}</strong> liked songs added</li>
            <li><strong>{state.already}</strong> already in your library</li>
            <li><strong>{state.playlists}</strong> playlists</li>
            <li><strong>{state.unmatched}</strong> not found</li>
          </ul>
          <div className="import-actions">
            <Link className="import-link" href={paths.liked}>Open Liked songs</Link>
            <Link className="import-link" href={paths.library}>Open playlists</Link>
            <TactileButton variant="ghost" onClick={() => dispatch({ type: 'reset' })}>Import another file</TactileButton>
          </div>
        </div>
      );

    case 'error':
      return (
        <div className="state-card" role="alert">
          <h3>{state.kind === 'file' ? 'That file did not work' : 'Paused'}</h3>
          <p>{state.message}</p>
          <div className="import-actions">
            {state.resumable && state.resume ? <TactileButton variant="accent" onClick={() => dispatch({ type: 'resume' })}>Carry on</TactileButton> : null}
            <TactileButton variant="ghost" onClick={() => dispatch({ type: 'reset' })}>Start again</TactileButton>
          </div>
        </div>
      );
  }
}

function Matching({ done, total, results, onCancel }: { readonly done: number; readonly total: number; readonly results: ReadonlyMap<string, MatchedTrack>; readonly onCancel: () => void }) {
  const reduced = useReducedMotion() ?? false;
  // Show the work: the latest real match, at most TICKER_PER_SECOND. Visual only; the summary below speaks.
  const found = useThrottled(useMemo(() => latestFoundText(results.values()), [results]), 1000 / TICKER_PER_SECOND);
  // Screen readers hear progress at most every 2 s, not on every batch.
  const [spoken, setSpoken] = useState(`Matched 0 of ${total}`);
  const last = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - last.current >= LIVE_SUMMARY_MS || done === total) {
      last.current = now;
      setSpoken(`Matched ${done} of ${total}`);
    }
  }, [done, total]);
  return (
    <div className="import-panel">
      <p className="import-lead" aria-hidden="true">Matched {done} of {total}</p>
      <ProgressBar value={done} max={total} label="Finding your songs" quiet />
      <p className="import-ticker" aria-hidden="true">
        <AnimatePresence mode="popLayout" initial={false}>
          {found ? <motion.span key={found} variants={reduced ? undefined : swapVariants} initial={reduced ? { opacity: 0 } : 'hidden'} animate={reduced ? { opacity: 1 } : 'visible'} exit={reduced ? { opacity: 0 } : 'exit'}>{found}</motion.span> : null}
        </AnimatePresence>
      </p>
      <p className="sr-only" aria-live="polite">{spoken}</p>
      <p className="import-note">Your progress is saved on this device, so you can close the tab and pick the same file later.</p>
      <div className="import-actions">
        <TactileButton variant="ghost" onClick={onCancel}>Cancel</TactileButton>
      </div>
    </div>
  );
}

function Review({ state, dispatch, onSave, planError }: {
  readonly state: Extract<ImportState, { step: 'review' }>;
  readonly dispatch: Dispatch;
  readonly onSave: (state: Extract<ImportState, { step: 'review' }>) => void;
  readonly planError: string | null;
}) {
  const matches = [...state.results.values()];
  const exact = matches.filter((match) => match.confidence === 'exact' && match.song);
  const close = matches.filter((match) => match.confidence === 'close' && match.song);
  const missing = matches.filter((match) => !match.song);
  const found = matches.filter((match) => match.accepted && match.song).length;
  return (
    <div className="import-panel">
      <p className="import-lead">Found {found} of {matches.length}</p>
      {planError ? <p className="import-note" role="alert">{planError}</p> : null}
      <details className="import-group">
        <summary>Found ({exact.length})</summary>
        <p className="import-note">These match by title and artist.</p>
      </details>
      {close.length > 0 ? (
        <details className="import-group" open>
          <summary>Check these ({close.length})</summary>
          <p className="import-note">Same title and artist, but the album or length differs. Tick the ones that are right.</p>
          {close.some((match) => !match.accepted) ? <button type="button" className="import-spotify-secondary" onClick={() => { for (const match of close) dispatch({ type: 'accept', key: match.key, accepted: true }); }}>Tick all {close.length}</button> : null}
          <ul className="import-list">
            {close.map((match) => (
              <li key={match.key} className="import-row">
                <label className="import-check">
                  <input type="checkbox" checked={match.accepted} onChange={(event) => dispatch({ type: 'accept', key: match.key, accepted: event.target.checked })} />
                  <span><span className="import-row__from">{match.track.title} — {match.track.artist}</span><span className="import-row__to">{match.song?.title} — {match.song?.artist}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {missing.length > 0 ? (
        <details className="import-group">
          <summary>Not found ({missing.length})</summary>
          <ul className="import-list">
            {missing.map((match) => <MissingRow key={match.key} match={match} onPick={(song) => dispatch({ type: 'replace', key: match.key, song })} />)}
          </ul>
        </details>
      ) : null}
      <div className="import-actions">
        <TactileButton variant="accent" disabled={found === 0} onClick={() => onSave(state)}>Add to my library</TactileButton>
      </div>
    </div>
  );
}

/** A song the catalog did not find: search for it by hand, or leave it out. */
function MissingRow({ match, onPick }: { readonly match: MatchedTrack; readonly onPick: (song: SongSnapshot) => void }) {
  const id = useId();
  const [query, setQuery] = useState(`${match.track.title} ${match.track.artist}`);
  const [options, setOptions] = useState<SongSnapshot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async (): Promise<void> => {
    setBusy(true);
    try {
      const { results } = await searchSongs(query);
      setOptions(results.slice(0, 5).flatMap((song) => {
        const account = snapshotForAccount(song);
        return account && account.ref.startsWith('saavn:') ? [account.snapshot] : [];
      }));
    } catch {
      setOptions([]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="import-row">
      <span className="import-row__from">{match.track.title} — {match.track.artist}</span>
      {match.retryable ? <p className="import-note">Allegra’s catalog was unavailable for this song. It stays out for now and will be tried again if you re-import this file.</p> : null}
      <form className="import-search" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <label className="sr-only" htmlFor={id}>Search for {match.track.title}</label>
        <input id={id} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        <TactileButton type="submit" variant="ghost" icon={Search} disabled={busy}>Search</TactileButton>
      </form>
      {options ? (
        options.length === 0 ? <p className="import-note">Nothing close. It stays out.</p> : (
          <ul className="import-options">
            {options.map((song) => (
              <li key={song.ref}><button type="button" className="import-option" onClick={() => onPick(song)}>{song.title} — {song.artist}</button></li>
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}
