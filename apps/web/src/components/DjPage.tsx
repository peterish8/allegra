import { Heart, LoaderCircle, Mic, Pause, Play, Send, SkipForward, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';

import { getDjSlashSuggestions, parseDjSlashCommand } from '@shared/dj';
import type { DjCloudProvider, DjGoal, DjProvider, DjSessionState, DjTrackContext, DjTurnRequest, DjTurnResponse } from '@shared/dj';
import type { UnifiedSong } from '@shared/types';

import { useAudioAnalyser } from '../hooks/useAudioAnalyser';
import { usePlaylistsContext } from '../hooks/usePlaylists';
import { requestDjTurn } from '../lib/api';
import { requestLocalDjTurn } from '../lib/djLocal';
import { Artwork } from './ui';

interface SpeechRecognitionResultLike { readonly transcript: string }
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { readonly results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
interface SpeechWindow extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

interface DjPageProps {
  readonly currentSong: UnifiedSong | null;
  readonly isPlaying: boolean;
  readonly isLive: boolean;
  readonly isRemote: boolean;
  readonly isCurrentLiked: boolean;
  readonly recent: readonly UnifiedSong[];
  readonly likedSongs: readonly UnifiedSong[];
  readonly nextSongs: readonly UnifiedSong[];
  readonly audioRef: RefObject<HTMLAudioElement | null>;
  readonly onToggle: () => void;
  readonly onSkip: () => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onApplyPlan: (turn: DjTurnResponse) => boolean;
  readonly onStartPlan: (turn: DjTurnResponse) => void;
}

const EMPTY_SESSION: DjSessionState = { vibe: '', energy: 3, language: null, constraints: [] };

function contextSong(song: UnifiedSong): DjTrackContext {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    ...(song.language ? { language: song.language } : {})
  };
}

function toneFor(vibe: string, energy: number): string {
  if (energy >= 4 || /hype|upbeat|energetic|workout/i.test(vibe)) return 'coral';
  if (/late|night|dream|melanchol|romantic/i.test(vibe)) return 'violet';
  if (/focus|calm|chill|easy/i.test(vibe)) return 'blue';
  return 'amber';
}

export function DjPage({
  currentSong, isPlaying, isLive, isRemote, isCurrentLiked, recent, likedSongs, nextSongs,
  audioRef, onToggle, onSkip, onLike, onApplyPlan, onStartPlan,
}: DjPageProps) {
  const playlists = usePlaylistsContext();
  const [provider, setProvider] = useState<DjProvider>('openai');
  const [model, setModel] = useState('gpt-4o-mini');
  const [apiKey, setApiKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [session, setSession] = useState<DjSessionState>(EMPTY_SESSION);
  const [goal, setGoal] = useState<DjGoal>('mix');
  const [songLimit, setSongLimit] = useState(8);
  const [draft, setDraft] = useState<{ readonly song: UnifiedSong; readonly reason: string }[]>([]);
  const [draftName, setDraftName] = useState('A little mix');
  const [savingPlaylist, setSavingPlaylist] = useState(false);
  const [history, setHistory] = useState<DjTurnRequest['history'][number][]>([]);
  const [skipped, setSkipped] = useState<UnifiedSong[]>([]);
  const [turn, setTurn] = useState<DjTurnResponse | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const [emotion, setEmotion] = useState<'idle' | 'listening' | 'thinking' | 'curious' | 'happy' | 'error'>('idle');
  const [status, setStatus] = useState('');
  const stageRef = useRef<HTMLElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const analyser = useAudioAnalyser(audioRef, isPlaying);

  useEffect(() => {
    if (provider === 'openai') setModel('gpt-4o-mini');
    else if (provider === 'openrouter') setModel('openai/gpt-4o-mini');
    else if (provider === 'gemini') setModel('gemini-3.8-flash');
    else setModel('Qwen3 0.6B (on-device)');
  }, [provider]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !isPlaying) return undefined;
    let frame = 0;
    let baseline = 0.025;
    let pulse = 0;
    let lastOnset = 0;
    const sample = (now: number): void => {
      const level = analyser.readLevel();
      baseline += (level - baseline) * 0.025;
      const onset = level > Math.max(0.095, baseline * 1.48) && now - lastOnset > 360;
      if (onset) {
        pulse = Math.min(0.9, Math.max(pulse, level * 2.4));
        lastOnset = now;
      } else {
        pulse *= 0.91;
      }
      stage.style.setProperty('--dj-audio-energy', String(Math.min(1, level * 2.6)));
      stage.style.setProperty('--dj-onset', String(pulse));
      frame = window.requestAnimationFrame(sample);
    };
    frame = window.requestAnimationFrame(sample);
    return () => {
      window.cancelAnimationFrame(frame);
      stage.style.setProperty('--dj-audio-energy', '0');
      stage.style.setProperty('--dj-onset', '0');
    };
  }, [analyser, isPlaying]);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  useEffect(() => {
    if (emotion !== 'curious') return undefined;
    const timer = window.setTimeout(() => setEmotion(current => current === 'curious' ? 'idle' : current), 1100);
    return () => window.clearTimeout(timer);
  }, [emotion]);

  const toggleVoice = useCallback((): void => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setEmotion('idle');
      return;
    }
    const speechWindow = window as SpeechWindow;
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setStatus('Voice input is not available in this browser. Type your request instead.');
      setEmotion('error');
      return;
    }
    const recognition = new Constructor();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
      if (transcript) setPrompt(transcript);
    };
    recognition.onerror = () => {
      setStatus('I could not hear that. Try again or type your request.');
      setEmotion('error');
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setEmotion('idle');
    };
    recognitionRef.current = recognition;
    setEmotion('listening');
    setStatus('Listening…');
    recognition.start();
  }, []);

  const send = useCallback(async (override?: string, options?: { readonly goal?: DjGoal; readonly songLimit?: number }): Promise<void> => {
    const message = (override ?? prompt).trim();
    if (!message || working) return;
    const selectedGoal = options?.goal ?? goal;
    const selectedSongLimit = options?.songLimit ?? songLimit;
    if (provider !== 'local' && !apiKey.trim()) {
      setSettingsOpen(true);
      setStatus('Add your AI key to start a DJ conversation.');
      return;
    }
    if (provider !== 'local' && !model.trim()) {
      setSettingsOpen(true);
      setStatus('Choose a model that supports tool calling.');
      return;
    }
    setWorking(true);
    setEmotion('thinking');
    setStatus('Reading your set and looking through the catalog…');
    try {
      const common = {
        goal: selectedGoal,
        songLimit: selectedGoal === 'mix' ? Math.min(selectedSongLimit, 8) : selectedSongLimit,
        message,
        history: history.slice(-8),
        current: currentSong ? contextSong(currentSong) : null,
        queue: nextSongs.slice(0, 8).map(contextSong),
        draft: draft.map(({ song }) => contextSong(song)),
        draftName,
        recent: recent.slice(0, 8).map(contextSong),
        liked: likedSongs.slice(0, 8).map(contextSong),
        skipped: skipped.slice(0, 8).map(contextSong),
        session
      };
      const result = provider === 'local'
        ? await requestLocalDjTurn({ ...common, draft, onProgress: setStatus })
        : await requestDjTurn({ ...common, provider: provider as DjCloudProvider, apiKey: apiKey.trim(), model: model.trim() });
      setTurn(result);
      setSession(result.session);
      setHistory((items) => [...items, { role: 'user' as const, content: message }, { role: 'assistant' as const, content: result.reply }].slice(-8));
      if (result.queue.length > 0) {
        setReasons((current) => ({ ...current, ...Object.fromEntries(result.queue.map((item) => [item.song.id, item.reason])) }));
      }
      if (selectedGoal === 'playlist') {
        const removed = new Set(result.removeTrackIds);
        const remaining = draft.filter(({ song }) => !removed.has(song.id));
        const nextDraft = result.draftOperation === 'replace' ? [...result.queue]
          : result.draftOperation === 'extend' ? [...remaining, ...result.queue]
            : remaining;
        setDraft(nextDraft.slice(0, selectedSongLimit));
        if (result.playlistName) setDraftName(result.playlistName);
        setStatus(result.reply);
        setEmotion(result.reaction === 'excited' || result.reaction === 'dreamy' ? 'happy' : 'idle');
      } else if (result.operation === 'replace_upcoming' || result.operation === 'insert') {
        setDraft([...result.queue]);
        if (currentSong && !isRemote && onApplyPlan(result)) {
          setStatus(result.reply);
          setEmotion(result.reaction === 'excited' || result.reaction === 'dreamy' ? 'happy' : 'idle');
        } else {
          setStatus(isRemote ? 'Your set is ready. Switch playback to this device to use it.' : 'Your set is ready when you are. Press Play to start it.');
          setEmotion('happy');
        }
      } else {
        setStatus(result.reply);
        setEmotion(result.reaction === 'confused' ? 'error' : 'idle');
      }
      setPrompt('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The DJ could not finish that request. Try again.');
      setEmotion('error');
    } finally {
      setWorking(false);
    }
  }, [apiKey, currentSong, draft, draftName, goal, history, isRemote, likedSongs, model, nextSongs, onApplyPlan, provider, prompt, recent, session, skipped, songLimit, working]);

  const submitPrompt = useCallback((): void => {
    const value = prompt.trim();
    const parsed = parseDjSlashCommand(value);
    if (!parsed) {
      if (value.startsWith('/')) { setStatus('Unknown shortcut. Type / to see the DJ commands.'); return; }
      void send(value);
      return;
    }

    const { command, remainder } = parsed;
    setPrompt('');
    setEmotion('idle');
    if (command.action === 'settings') { setSettingsOpen(true); setStatus('Choose your AI provider or set up a key below.'); return; }
    if (command.action === 'help') { setStatus('Try /late-night, /tamil, /energy, /focus, /similar, /keep, /mix, /playlist, /size, or /settings.'); return; }
    if (command.action === 'size') {
      if (!parsed.size) { setPrompt('/size '); setStatus('Choose a song count from the suggestions.'); return; }
      const minimum = goal === 'playlist' ? 5 : 1;
      const maximum = goal === 'playlist' ? 30 : 8;
      const selectedSongLimit = Math.max(minimum, Math.min(maximum, parsed.size));
      setSongLimit(selectedSongLimit);
      if (remainder) { void send(remainder, { songLimit: selectedSongLimit }); return; }
      setStatus(`I’ll line up ${selectedSongLimit} songs.`);
      return;
    }
    if (command.action === 'goal' && command.goal) {
      const selectedSongLimit = command.goal === 'mix' ? Math.min(songLimit, 8) : Math.max(songLimit, 10);
      setGoal(command.goal);
      setSongLimit(selectedSongLimit);
      if (remainder) { void send(remainder, { goal: command.goal, songLimit: selectedSongLimit }); return; }
      setStatus(command.goal === 'playlist' ? 'Playlist draft ready. Tell me the mood or first song.' : 'Live mix ready. What are we feeling?');
      return;
    }
    if (command.action === 'prompt') void send([command.prompt, remainder].filter(Boolean).join(' '));
  }, [goal, prompt, send, songLimit]);

  const skipAndTeach = (): void => {
    if (currentSong) setSkipped((items) => [currentSong, ...items.filter((item) => item.id !== currentSong.id)].slice(0, 8));
    setEmotion('curious');
    onSkip();
  };

  const needsStart = Boolean(goal === 'mix' && turn && turn.operation !== 'keep' && turn.queue.length > 0 && (!currentSong || isRemote));
  const displayTracks = useMemo(() => {
    if (goal === 'playlist') return draft;
    if (needsStart && turn) return turn.queue;
    return nextSongs.slice(0, 8).map((song) => ({ song, reason: reasons[song.id] ?? '' }));
  }, [draft, goal, needsStart, nextSongs, reasons, turn]);
  const tone = toneFor(session.vibe, session.energy);
  const commandSuggestions = getDjSlashSuggestions(prompt, goal);
  const currentIsPaused = Boolean(currentSong && !isPlaying);

  const savePlaylist = useCallback(async (): Promise<void> => {
    if (draft.length === 0 || savingPlaylist) return;
    setSavingPlaylist(true);
    setStatus('Saving your playlist…');
    try {
      const library = await playlists.create(draftName.trim() || 'A little mix');
      if (!library) throw new Error(playlists.actionError ?? 'That playlist could not be created.');
      const saved = await playlists.addSongs(library.id, draft.map(({ song }) => song));
      if (!saved) {
        await playlists.remove(library.id);
        throw new Error(playlists.actionError ?? 'The playlist could not be saved. Your draft is still here to retry.');
      }
      setStatus(`Saved “${draftName.trim() || 'A little mix'}” to your playlists.`);
      setEmotion('happy');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The playlist could not be saved.');
      setEmotion('error');
    } finally { setSavingPlaylist(false); }
  }, [draft, draftName, playlists, savingPlaylist]);

  return (
    <div className="dj-page">
      <h1 className="sr-only">Your DJ</h1>
      <section
        className={`dj-hero${isPlaying ? ' is-playing' : ''}${working ? ' is-thinking' : ''}`}
        aria-label="Your DJ companion"
        data-tone={tone}
        data-emotion={working ? 'thinking' : emotion}
        data-paused={currentIsPaused ? 'true' : 'false'}
        ref={stageRef}
        style={{ '--dj-audio-energy': '0', '--dj-onset': '0' } as CSSProperties}
      >
        <div
          className={`dj-mascot-stage${currentSong && isPlaying ? ' is-vibing' : ''}`}
          aria-hidden="true"
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
            const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
            stageRef.current?.style.setProperty('--dj-look-x', `${Math.round(x * 12)}px`);
            stageRef.current?.style.setProperty('--dj-look-y', `${Math.round(y * 8)}px`);
          }}
          onPointerLeave={() => {
            stageRef.current?.style.setProperty('--dj-look-x', '0px');
            stageRef.current?.style.setProperty('--dj-look-y', '0px');
          }}
        >
          <div className="dj-aura dj-aura--wide" />
          <div className="dj-aura dj-aura--soft" />
          <div className="dj-aura dj-aura--core" />
          <div className="dj-mascot-eyes"><span className="dj-mascot-eye dj-mascot-eye--left" /><span className="dj-mascot-eye dj-mascot-eye--right" /></div>
        </div>

        <form className="dj-compose" onSubmit={(event) => { event.preventDefault(); submitPrompt(); }}>
          <div className="dj-input-wrap">
            <input
              value={prompt}
              onFocus={() => { if (!working) setEmotion('listening'); }}
              onBlur={() => { if (!working && (emotion === 'listening' || emotion === 'curious')) setEmotion('idle'); }}
              onChange={(event) => { setPrompt(event.target.value); setStatus(''); }}
              maxLength={500}
              placeholder="Ask for a mood, a song, or type / for shortcuts…"
              aria-label="Tell your DJ what you want to hear"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={commandSuggestions.length > 0}
              aria-haspopup="listbox"
              aria-controls={commandSuggestions.length ? 'dj-command-menu' : undefined}
            />
            <button type="button" className={`dj-mic-button${emotion === 'listening' && status === 'Listening…' ? ' is-listening' : ''}`} onClick={toggleVoice} aria-label="Speak your request">
              <Mic size={17} />
            </button>
            <button type="submit" className="dj-send-button" disabled={working || !prompt.trim()} aria-label="Ask the DJ">
              {working ? <LoaderCircle size={18} className="dj-spin" /> : <Send size={17} />}
            </button>
            {commandSuggestions.length ? (
              <div className="dj-command-menu" id="dj-command-menu" role="listbox" aria-label="DJ shortcuts">
                {commandSuggestions.map((suggestion) => (
                  <button key={suggestion.command} type="button" role="option" aria-selected="false" onMouseDown={(event) => event.preventDefault()} onClick={() => { setPrompt(suggestion.command); setStatus(''); setEmotion('curious'); }}>
                    <span><strong>{suggestion.label}</strong><small>{suggestion.detail}</small></span><code>{suggestion.command}</code>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {status ? <p className="dj-inline-reply" role="status">{status}</p> : null}
          {settingsOpen ? (
            <div className="dj-provider-panel">
              <div className="dj-provider-heading"><strong>Your AI provider</strong><button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close AI setup"><X size={15} /></button></div>
              <div className="dj-provider-fields">
                <label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value as DjProvider)}><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option><option value="gemini">Gemini</option><option value="local">On-device · Qwen3</option></select></label>
                {provider !== 'local' ? <>
                  <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} maxLength={160} placeholder="Tool-calling model ID" /></label>
                  <label className="dj-key-field">API key<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} maxLength={512} placeholder={`Paste your ${provider === 'gemini' ? 'Gemini' : provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} key`} /></label>
                </> : <p>Qwen3 0.6B runs in your browser. The model downloads once and stays in this browser’s cache; about 390 MB. Catalog search still needs a connection.</p>}
              </div>
              {provider !== 'local' ? <p>Your key is sent for each request only and is not saved by Allegra. Your request and a short list of listening context go to the selected provider.</p> : null}
              {apiKey ? <button type="button" className="dj-clear-key" onClick={() => setApiKey('')}>Forget key</button> : null}
            </div>
          ) : null}
        </form>
      </section>

      {currentSong ? (
        <article className="dj-current">
          <Artwork song={currentSong} size="small" />
          <div className="dj-current-copy"><span>{isLive ? 'RIGHT NOW' : 'CURRENT TRACK'}</span><strong>{currentSong.title}</strong><small>{currentSong.artist}</small></div>
          <div className="dj-current-actions">
            <button type="button" className={`dj-icon-button${isCurrentLiked ? ' is-liked' : ''}`} aria-label={isCurrentLiked ? 'Unlike this song' : 'Love this song'} onClick={() => onLike(currentSong)}><Heart size={18} fill={isCurrentLiked ? 'currentColor' : 'none'} /></button>
            <button type="button" className="dj-icon-button" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={onToggle}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
            <button type="button" className="dj-icon-button" aria-label="Skip this song" onClick={skipAndTeach}><SkipForward size={19} fill="currentColor" /></button>
          </div>
        </article>
      ) : null}

      {isRemote ? <p className="dj-note" role="status">Switch playback to this device to use your DJ’s queue.</p> : null}

      {needsStart && turn && !isRemote ? (
        <button type="button" className="dj-primary dj-start-set" onClick={() => onStartPlan(turn)}><Play size={16} fill="currentColor" /> Start this set</button>
      ) : null}

      {goal === 'playlist' ? (
        <section className="dj-queue-section dj-playlist-draft" aria-label="Editable playlist draft">
          <div className="dj-subheading"><div><h3>Your draft</h3><span>{draft.length} of {songLimit} songs</span></div>{draft.length ? <label className="dj-draft-name"><span className="sr-only">Playlist name</span><input value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={100} aria-label="Playlist name" /></label> : null}</div>
          {draft.length === 0 ? <p className="dj-empty-draft">Tell your DJ a mood or a few songs to make a playlist draft.</p> : null}
          <div className="dj-queue">
            {displayTracks.map(({ song, reason }, index) => (
              <div className="dj-queue-row" key={`${song.id}:${index}`}>
                <span className="dj-queue-index">{String(index + 1).padStart(2, '0')}</span>
                <Artwork song={song} size="small" />
                <span className="dj-queue-copy"><strong>{song.title}</strong><small>{song.artist}</small>{reason ? <em>{reason}</em> : null}</span>
                <button type="button" className="dj-remove-track" onClick={() => setDraft((items) => items.filter((item) => item.song.id !== song.id))} aria-label={`Remove ${song.title}`}><X size={16} /></button>
              </div>
            ))}
          </div>
          {draft.length > 0 ? <button type="button" className="dj-primary dj-save-playlist" onClick={() => void savePlaylist()} disabled={savingPlaylist}><Sparkles size={16} /> {savingPlaylist ? 'Saving…' : 'Save playlist'}</button> : null}
        </section>
      ) : displayTracks.length > 0 ? (
        <section className="dj-queue-section" aria-label="Your next songs">
          <div className="dj-subheading"><h3>Coming up</h3><span>{displayTracks.length} catalog picks</span></div>
          <div className="dj-queue">
            {displayTracks.map(({ song, reason }, index) => (
              <div className="dj-queue-row" key={`${song.id}:${index}`}>
                <span className="dj-queue-index">{String(index + 1).padStart(2, '0')}</span>
                <Artwork song={song} size="small" />
                <span className="dj-queue-copy"><strong>{song.title}</strong><small>{song.artist}</small>{reason ? <em>{reason}</em> : null}</span>
                <Sparkles size={15} className="dj-pick-mark" aria-hidden="true" />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
