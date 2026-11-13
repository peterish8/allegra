import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LyricLine, LyricsPayload, UnifiedSong } from '@shared/types';
import type { LyricsSyncCandidate } from '@shared/lyricSync';
import { fromAllegraSong } from '@shared/songRef';
import { getLyricsSources, pasteLyrics } from '../lib/api';
import type { AlignedVersion } from '../lib/lyricAlign/client';
import { createLyricsSyncTarget, type LyricsSyncJob, type LyricsSyncTarget } from '../lib/lyricAlign/jobs';
import type { Playhead } from '../lib/playhead';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import { lockScroll } from '../lib/scrollLock';
import { LyricsPanel } from './LyricsPanel';
import { rememberLocalTiming } from '../lib/lyricAlign/localTiming';

interface Props {
  readonly song: UnifiedSong;
  readonly reviewJob?: LyricsSyncJob | null;
  readonly signedIn: boolean;
  readonly onSignIn: () => void;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly onStart: (target: LyricsSyncTarget) => void;
  readonly onSaveJob: (jobId: string) => Promise<boolean>;
  readonly onUse: (payload: LyricsPayload) => void;
  readonly playhead: Playhead;
  readonly isTargetCurrent: boolean;
  readonly playing: boolean;
  readonly onActivateLine: (seconds: number) => void;
}

export function alignedLines(version: AlignedVersion): LyricLine[] {
  let index = 0;
  return version.candidate.lines.map((text, lineOrder) => {
    const pieces = text.trim().split(/\s+/).filter(Boolean);
    const words = pieces.map((word, wordIndex) => {
      const timing = version.wordTimes[index++]!;
      return { text: wordIndex < pieces.length - 1 ? `${word} ` : word, start: timing.start, end: timing.end };
    });
    return { text, timestamp: words[0]?.start ?? 0, lineOrder, words };
  });
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}

export function LyricsSyncDialog({
  song, reviewJob = null, signedIn, onSignIn, onClose, onSaved, onStart, onSaveJob,
  onUse, playhead, isTargetCurrent, playing, onActivateLine
}: Props) {
  const narrow = useNarrowViewport();
  const ref = fromAllegraSong(song);
  const [candidates, setCandidates] = useState<readonly LyricsSyncCandidate[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [gpu, setGpu] = useState(false);
  const [preview, setPreview] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState(0);
  const [finding, setFinding] = useState(true);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [passcode, setPasscode] = useState('');
  const [pasting, setPasting] = useState(false);
  const pasteController = useRef<AbortController | null>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    setGpu('gpu' in navigator);
    const unlock = lockScroll();
    return () => {
      pasteController.current?.abort();
      unlock();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (reviewJob) { setFinding(false); return; }
    if (!ref || narrow) { setFinding(false); return; }
    const abort = new AbortController();
    setFinding(true);
    const timer = window.setTimeout(() => {
      abort.abort();
      setFinding(false);
      setError('Finding online lyrics took too long. Retry, or paste the words below.');
    }, 12_000);
    void getLyricsSources(ref, abort.signal).then((response) => {
      if (abort.signal.aborted) return;
      setCandidates(previous => [...(previous?.filter(candidate => candidate.origin === 'manual') ?? []), ...response.candidates]);
      const first = response.candidates.find((candidate) => candidate.script === 'latin' && !candidate.synced)
        ?? response.candidates.find((candidate) => candidate.script === 'latin');
      setSelected(previous => previous ?? first?.id ?? null);
    }).catch((cause: unknown) => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not find lyrics.');
    }).finally(() => {
      window.clearTimeout(timer);
      if (!abort.signal.aborted) setFinding(false);
    });
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [ref, narrow, lookup, reviewJob]);

  const chosen = candidates?.filter((candidate) => candidate.id === selected) ?? [];
  const versions = reviewJob?.versions ?? [];
  const active = versions[preview];
  const lines = active ? alignedLines(active) : [];
  const reviewCount = active?.lineConfidence.filter((confidence) => confidence < 0.7).length ?? 0;
  const reviewCopy = reviewCount === 1 ? 'Review 1 line that needs checking' : `Review ${reviewCount} lines that need checking`;
  const canSave = versions.length > 0 && versions.every((version) => version.confidence >= 0.7);

  const addPaste = async (): Promise<void> => {
    if (!ref || pasting) return;
    setPasting(true);
    setError(null);
    const abort = new AbortController();
    pasteController.current = abort;
    try {
      const candidate = await pasteLyrics(ref, pasteText, passcode, abort.signal);
      if (abort.signal.aborted) return;
      setCandidates(previous => [...(previous ?? []).filter(item => item.id !== candidate.id), candidate]);
      setSelected(candidate.id);
      setPasteOpen(false);
      setPasscode('');
      setPasteText('');
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not approve these lyrics.');
    } finally {
      if (!abort.signal.aborted) setPasting(false);
      if (pasteController.current === abort) pasteController.current = null;
    }
  };

  const start = (): void => {
    if (!chosen.length) return;
    setError(null);
    try {
      onStart(createLyricsSyncTarget(song, chosen, gpu));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start this lyric sync.');
    }
  };

  const save = (): void => {
    if (!reviewJob || !canSave || reviewJob.status !== 'ready') return;
    void onSaveJob(reviewJob.id).then((saved) => { if (saved) onSaved(); });
  };

  const useOnDevice = (): void => {
    if (!active || !reviewJob) return;
    const payload: LyricsPayload = {
      source: 'On this device', type: 'synced', matchScore: active.confidence,
      matchReason: 'Timing you previewed and kept on this device.', lines
    };
    rememberLocalTiming(reviewJob.target.ref, payload);
    onUse(payload);
  };

  return createPortal(<div className="lyric-sync-backdrop" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]'));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><section className="lyric-sync-sheet" role="dialog" aria-modal="true" aria-labelledby="lyric-sync-title">
    <header><div><h2 id="lyric-sync-title">{reviewJob ? 'Review synced lyrics' : 'Sync lyrics'}</h2><p>{song.title} · {song.artist}</p></div>
      <button ref={close} type="button" onClick={onClose} aria-label="Close lyric sync">×</button></header>
    {narrow && !reviewJob ? <p>Sync on a computer at {typeof window === 'undefined' ? '' : window.location.host}. Your saved timing will appear here too.</p>
      : reviewJob && active ? <>
        {reviewJob.status === 'saved' ? <p role="status">Timing saved. Everyone can now follow these lyrics.</p> : null}
        <p>Test the timing with the original recording before you save it.</p>
        <div className="lyric-sync-versions" role="group" aria-label="Aligned lyric versions">{versions.map((version, index) => <button type="button" key={version.candidate.id} aria-pressed={index === preview} onClick={() => setPreview(index)}>{version.candidate.script === 'latin' ? 'English' : version.candidate.language}</button>)}</div>
        <button type="button" className="lyric-sync-test" onClick={() => onActivateLine(lines[0]?.timestamp ?? 0)}>Play this recording to test</button>
        <div className="lyric-sync-confidence" role="status">
          <span>Alignment confidence</span><strong>{Math.round(active.confidence * 100)}%</strong>
          <span>{reviewCount ? `${reviewCount} ${reviewCount === 1 ? 'line needs' : 'lines need'} checking` : 'Ready to share'}</span>
        </div>
        {reviewCount > 0 ? <details className="lyric-sync-review">
          <summary>{reviewCopy}</summary>
          <p>Choose a line to play the recording from its estimated start.</p>
          <ol>{lines.map((line, index) => active.lineConfidence[index]! < 0.7 ? <li key={`${index}-${line.timestamp}`}>
            <button type="button" onClick={() => onActivateLine(line.timestamp)}><span>{line.text}</span><time>{formatTime(line.timestamp)}</time></button>
          </li> : null)}</ol>
        </details> : null}
        <div className="lyric-sync-preview">{isTargetCurrent
          ? <LyricsPanel lines={lines} type={'synced' satisfies LyricsPayload['type']} playhead={playhead} playing={playing} loading={false} error={null} onRetry={() => undefined} onSeek={onActivateLine} onActivateLine={onActivateLine} hideBackdrop softFocus={false} compact />
          : <ol className="lyric-sync-preview__lines">{lines.map((line) => <li key={`${line.lineOrder}-${line.timestamp}`}>
            <button type="button" onClick={() => onActivateLine(line.timestamp)}><span>{line.text}</span><time>{formatTime(line.timestamp)}</time></button>
          </li>)}</ol>}
        </div>
        {!canSave ? <p>Confidence is too low to share. Check the flagged lines or try another lyric version; the words may not match this recording.</p> : null}
        <button type="button" onClick={useOnDevice}>Use timing on this device</button>
        {reviewJob.error ? <p role="alert">{reviewJob.error}</p> : null}
        <footer><button type="button" onClick={onClose}>Keep for later</button>
          {signedIn ? <button type="button" disabled={!canSave || reviewJob.status !== 'ready'} onClick={save}>{reviewJob.status === 'saving' ? 'Saving…' : reviewJob.status === 'saved' ? 'Saved' : 'Yes, save timing'}</button>
            : <button type="button" disabled={!canSave} onClick={onSignIn}>Sign in to share timing</button>}
        </footer>
      </> : reviewJob ? <p role="status">This timing preview is not available for review.</p> : <>
        <p>Choose the words for this recording. We’ll find each sung word’s timing in the background.</p>
        {finding ? <p role="status">Finding lyric versions… You can also paste the words below.</p> : null}
        {!finding && !candidates?.length ? <p>No online words available. Retry discovery or paste the lyrics.</p> : null}
        {!finding ? <button type="button" onClick={() => { setError(null); setLookup(value => value + 1); }}>Retry finding lyrics</button> : null}
        <button type="button" aria-expanded={pasteOpen} onClick={() => setPasteOpen(value => !value)}>Paste lyrics</button>
        {pasteOpen ? <form className="lyric-sync-paste" onSubmit={event => { event.preventDefault(); void addPaste(); }}>
          <p>Paste English or romanized words, one sung line per line. An admin passcode is required before these words can be synced and shared.</p>
          <label>Lyrics<textarea value={pasteText} onChange={event => setPasteText(event.target.value)} maxLength={24000} rows={8} required disabled={pasting}/></label>
          <label>Admin passcode<input type="password" value={passcode} onChange={event => setPasscode(event.target.value)} maxLength={256} autoComplete="off" required disabled={pasting}/></label>
          {signedIn ? <button type="submit" disabled={pasting || !pasteText.trim() || !passcode}>{pasting ? 'Checking passcode…' : 'Approve words for syncing'}</button>
            : <button type="button" onClick={onSignIn}>Sign in to paste lyrics</button>}
        </form> : null}
        <fieldset className="lyric-sync-candidates" disabled={finding || narrow}>
          <legend>Choose one lyric version</legend>
          {candidates?.map((candidate) => <label key={candidate.id}>
            <input type="radio" name="lyric-sync-candidate" checked={selected === candidate.id} disabled={candidate.script !== 'latin'} onChange={() => setSelected(candidate.id)}/>
            <span><strong>{candidate.script === 'latin' ? 'English / romanized' : candidate.language} · {candidate.source}</strong><small>{candidate.synced ? 'Already synced · can align again' : `${candidate.lines.length} lines`}{candidate.script !== 'latin' ? ' · Native-script support pending' : ''}</small>
              <details><summary>Show words</summary>{candidate.lines.map((line, index) => <p key={index}>{line}</p>)}</details>
            </span>
          </label>)}
        </fieldset>
        {chosen.length ? <div className="lyric-sync-consent">
          <p>Download the alignment model once ({gpu ? '197' : '241'} MB). It stays in this browser when storage is available. Audio is processed locally.</p>
          <label><input type="checkbox" checked={!gpu} onChange={(event) => setGpu(!event.target.checked)} disabled={typeof navigator === 'undefined' || !('gpu' in navigator)}/> Use CPU mode (241 MB; can take several minutes)</label>
          <small>MMS model · CC-BY-NC-4.0</small>
          <button type="button" onClick={start}>Confirm words and sync in background</button>
        </div> : null}
      </>}
    {error ? <p role="alert">{error}</p> : null}
  </section></div>, document.body);
}
