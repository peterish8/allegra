import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LyricLine, LyricsPayload, UnifiedSong } from '@shared/types';
import type { LyricsSyncCandidate } from '@shared/lyricSync';
import { fromAllegraSong } from '@shared/songRef';
import { getLyricsSources, saveLyricsSync } from '../lib/api';
import { syncInBrowser, type AlignedVersion } from '../lib/lyricAlign/client';
import type { AlignProgress } from '../lib/lyricAlign/config';
import type { Playhead } from '../lib/playhead';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import { lockScroll } from '../lib/scrollLock';
import { LyricsPanel } from './LyricsPanel';
import { rememberLocalTiming } from '../lib/lyricAlign/localTiming';

interface Props {
  readonly song: UnifiedSong;
  readonly signedIn: boolean;
  readonly onSignIn: () => void;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly onUse: (payload: LyricsPayload) => void;
  readonly playhead: Playhead;
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

export function LyricsSyncDialog({ song, signedIn, onSignIn, onClose, onSaved, onUse, playhead, playing, onActivateLine }: Props) {
  const narrow = useNarrowViewport();
  const ref = fromAllegraSong(song);
  const [candidates, setCandidates] = useState<readonly LyricsSyncCandidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [gpu, setGpu] = useState(false);
  const [progress, setProgress] = useState<AlignProgress | null>(null);
  const [versions, setVersions] = useState<AlignedVersion[] | null>(null);
  const [preview, setPreview] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    setGpu('gpu' in navigator);
    const unlock = lockScroll();
    return () => { controller.current?.abort(); unlock(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!ref || narrow) return;
    const abort = new AbortController();
    void getLyricsSources(ref, abort.signal).then((response) => {
      setCandidates(response.candidates);
      const first = response.candidates.find((c) => c.script === 'latin' && !c.synced) ?? response.candidates.find((c) => c.script === 'latin');
      setSelected(first ? [first.id] : []);
    }).catch((e: unknown) => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Could not find lyrics.'); });
    return () => abort.abort();
  }, [signedIn, ref, narrow]);
  const chosen = candidates?.filter((c) => selected.includes(c.id)) ?? [];
  const active = versions?.[preview];
  const lines = active ? alignedLines(active) : [];
  const reviewCount = active?.lineConfidence.filter((confidence) => confidence < 0.7).length ?? 0;
  const canSave = versions?.every((v) => v.confidence >= 0.7) ?? false;
  const start = async (): Promise<void> => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setError(null); setVersions(null);
    try {
      const result = await syncInBrowser(song.streamUrl, chosen, gpu, abort.signal, setProgress);
      if (!abort.signal.aborted) { setVersions(result); setPreview(0); setProgress(null); }
    } catch (e) { if (!abort.signal.aborted) { setError(e instanceof Error ? e.message : 'Could not sync this recording.'); setProgress(null); } }
  };
  const save = async (): Promise<void> => {
    if (!ref || !versions || !canSave) return;
    setSaving(true); setError(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const result = await saveLyricsSync({ ref, versions: versions.map((v) => ({ candidateId: v.candidate.id, script: v.candidate.script, wordTimes: v.wordTimes, confidence: v.confidence })) }, abort.signal);
      if (!abort.signal.aborted) {
        if (!result.versions.some((v) => v.saved)) setError('A higher-confidence version is already shared for this recording.');
        else { setSaved(true); onSaved(); }
      }
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Could not save the timing.'); }
    finally { if (!abort.signal.aborted) setSaving(false); }
  };
  return createPortal(<div className="lyric-sync-backdrop" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex="0"]'));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><section className="lyric-sync-sheet" role="dialog" aria-modal="true" aria-labelledby="lyric-sync-title">
    <header><div><h2 id="lyric-sync-title">Sync lyrics</h2><p>{song.title}</p></div><button ref={close} type="button" onClick={onClose} aria-label="Close lyric sync">×</button></header>
    {narrow ? <p>Sync on a computer at {typeof window === 'undefined' ? '' : window.location.host}. Your saved timing will appear here too.</p>
      : saved ? <><p role="status">Timing saved. Everyone can now follow these lyrics.</p><button type="button" onClick={onClose}>Done</button></>
      : progress ? <div role="status" aria-live="polite"><h3>{progress.stage}</h3><p>{progress.percent}% · Overall {progress.overall}%</p><progress max={100} value={progress.overall} aria-label="Lyric sync progress"/><p>Keep this tab open. Audio stays on your computer.</p><button type="button" onClick={() => { controller.current?.abort(); setProgress(null); }}>Cancel syncing</button></div>
      : active ? <>
        <p>Preview the timing with the recording. Is this syncing good?</p>
        <div className="lyric-sync-versions">{versions?.map((v, i) => <button type="button" key={v.candidate.id} aria-pressed={i === preview} onClick={() => setPreview(i)}>{v.candidate.script === 'latin' ? 'English' : v.candidate.language}</button>)}</div>
        <button type="button" onClick={() => onActivateLine(lines[0]?.timestamp ?? 0)}>Play from first line</button>
        <div className="lyric-sync-confidence" role="status">
          <span>Alignment confidence</span><strong>{Math.round(active.confidence * 100)}%</strong>
          <span>{reviewCount ? `${reviewCount} lines need checking` : 'Ready to share'}</span>
        </div>
        {reviewCount > 0 ? <details className="lyric-sync-review">
          <summary>Review {reviewCount} lines that need checking</summary>
          <p>Choose a line to play the recording from its estimated start.</p>
          <ol>{lines.map((line, index) => active.lineConfidence[index]! < 0.7 ? <li key={`${index}-${line.timestamp}`}>
            <button type="button" onClick={() => onActivateLine(line.timestamp)}><span>{line.text}</span><time>{formatTime(line.timestamp)}</time></button>
          </li> : null)}</ol>
        </details> : null}
        <div className="lyric-sync-preview"><LyricsPanel lines={lines} type={'synced' satisfies LyricsPayload['type']} playhead={playhead} playing={playing} loading={false} error={null} onRetry={() => undefined} onSeek={onActivateLine} onActivateLine={onActivateLine} hideBackdrop softFocus={false} compact /></div>
        {!canSave ? <p>Confidence is too low to share. Check the flagged lines or try another lyric version; the words may not match this recording.</p> : null}
        <button type="button" onClick={() => {
          const payload: LyricsPayload = { source: 'On this device', type: 'synced', matchScore: active.confidence, matchReason: 'Timing you previewed and kept on this device.', lines };
          if (ref) rememberLocalTiming(ref, payload);
          onUse(payload);
        }}>Use timing on this device</button>
        <footer><button type="button" onClick={() => setVersions(null)} disabled={saving}>Discard and retry</button>{signedIn ? <button type="button" disabled={!canSave || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Yes, save timing'}</button> : <button type="button" disabled={!canSave} onClick={onSignIn}>Sign in to share timing</button>}</footer>
      </> : <>
        <p>Choose the words for this recording. The model finds when each word is sung.</p>
        {!candidates && !error ? <p role="status">Finding lyric versions…</p> : null}
        {candidates?.length === 0 ? <p>No words found yet. Try this recording again later.</p> : null}
        <div className="lyric-sync-candidates">{candidates?.map((candidate) => <label key={candidate.id}>
          <input type="checkbox" checked={selected.includes(candidate.id)} disabled={candidate.script !== 'latin'} onChange={(event) => setSelected(event.target.checked ? [...selected.filter((id) => candidates.find((c) => c.id === id)?.script !== candidate.script), candidate.id] : selected.filter((id) => id !== candidate.id))}/>
          <span><strong>{candidate.script === 'latin' ? 'English / romanized' : candidate.language} · {candidate.source}</strong><small>{candidate.synced ? 'Already synced · can align again' : `${candidate.lines.length} lines`}{candidate.script !== 'latin' ? ' · Native-script support pending' : ''}</small><details><summary>Show words</summary>{candidate.lines.map((line, i) => <p key={i}>{line}</p>)}</details></span>
        </label>)}</div>
        {chosen.length ? <div className="lyric-sync-consent"><p>Download the alignment model once ({gpu ? '197' : '241'} MB). It stays in this browser when storage is available. Audio is processed locally.</p><label><input type="checkbox" checked={!gpu} onChange={(e) => setGpu(!e.target.checked)} disabled={typeof navigator === 'undefined' || !('gpu' in navigator)}/> Use CPU mode (241 MB; can take several minutes)</label><small>MMS model · CC-BY-NC-4.0</small><button type="button" onClick={() => void start()}>Download model and sync</button></div> : null}
      </>}
    {error ? <p role="alert">{error}</p> : null}
  </section></div>, document.body);
}
