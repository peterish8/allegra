import { Heart, LoaderCircle, Mic, Pause, Play, Send, SkipForward, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';

import { getDjSlashSuggestions } from '@shared/dj';
import type { DjProvider } from '@shared/dj';
import type { UnifiedSong } from '@shared/types';

import { useAudioAnalyser } from '../hooks/useAudioAnalyser';
import { useDjSession } from '../hooks/useDjSession';
import type { Palette } from '../lib/palette';
import { DjMascot } from './dj/DjMascot';
import { useDjPulse } from './dj/useDjPulse';
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
  /** Colours of the playing cover; `null` when nothing plays (the mascot then uses the tone colours). */
  readonly palette?: Palette | null;
  readonly audioRef: RefObject<HTMLAudioElement | null>;
  readonly onToggle: () => void;
  readonly onLike: (song: UnifiedSong) => void;
}

function toneFor(vibe: string, energy: number): string {
  if (energy >= 4 || /hype|upbeat|energetic|workout/i.test(vibe)) return 'coral';
  if (/late|night|dream|melanchol|romantic/i.test(vibe)) return 'violet';
  if (/focus|calm|chill|easy/i.test(vibe)) return 'blue';
  return 'amber';
}

export function DjPage({
  currentSong, isPlaying, isLive, isRemote, isCurrentLiked, palette = null, audioRef, onToggle, onLike,
}: DjPageProps) {
  const dj = useDjSession();
  const {
    provider, model, apiKey, settingsOpen, session, goal, songLimit, draft, draftName, savingPlaylist,
    turn, reasons, working, status, emotion, nextSongs,
    setStatus, setEmotion, setDraftName, setProvider, setModel, setApiKey, setSettingsOpen,
  } = dj;
  const [prompt, setPrompt] = useState('');
  const stageRef = useRef<HTMLElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const analyser = useAudioAnalyser(audioRef, isPlaying);

  useDjPulse(stageRef, analyser, isPlaying);

  useEffect(() => () => recognitionRef.current?.stop(), []);

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
  }, [setEmotion, setStatus]);

  const submitPrompt = (): void => {
    void dj.submitPrompt(prompt).then((outcome) => {
      if (outcome.prefill !== undefined) setPrompt(outcome.prefill);
      else if (outcome.clear) setPrompt('');
    });
  };

  const needsStart = Boolean(goal === 'mix' && turn && turn.operation !== 'keep' && turn.queue.length > 0 && (!currentSong || isRemote));
  const displayTracks = useMemo(() => {
    if (goal === 'playlist') return draft;
    if (needsStart && turn) return turn.queue;
    return nextSongs.slice(0, 8).map((song) => ({ song, reason: reasons[song.id] ?? '' }));
  }, [draft, goal, needsStart, nextSongs, reasons, turn]);
  const tone = toneFor(session.vibe, session.energy);
  const commandSuggestions = getDjSlashSuggestions(prompt, goal);

  return (
    <div className="dj-page">
      <h1 className="sr-only">Your DJ</h1>
      <section
        className="dj-hero"
        aria-label="Your DJ companion"
        data-tone={tone}
        ref={stageRef}
        style={{ '--dj-bass': '0', '--dj-energy': '0', '--dj-onset': '0' } as CSSProperties}
      >
        <div
          className="dj-mascot-stage"
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
          <DjMascot
            size="stage"
            emotion={working ? 'thinking' : emotion}
            palette={palette}
            cover={currentSong?.artwork ?? null}
            playing={Boolean(currentSong && isPlaying)}
          />
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
            <button type="button" className="dj-icon-button" aria-label="Skip this song" onClick={dj.skipAndTeach}><SkipForward size={19} fill="currentColor" /></button>
          </div>
        </article>
      ) : null}

      {isRemote ? <p className="dj-note" role="status">Switch playback to this device to use your DJ’s queue.</p> : null}

      {needsStart && turn && !isRemote ? (
        <button type="button" className="dj-primary dj-start-set" onClick={() => dj.startPlan(turn)}><Play size={16} fill="currentColor" /> Start this set</button>
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
                <button type="button" className="dj-remove-track" onClick={() => dj.removeFromDraft(song.id)} aria-label={`Remove ${song.title}`}><X size={16} /></button>
              </div>
            ))}
          </div>
          {draft.length > 0 ? <button type="button" className="dj-primary dj-save-playlist" onClick={() => void dj.savePlaylist()} disabled={savingPlaylist}><Sparkles size={16} /> {savingPlaylist ? 'Saving…' : 'Save playlist'}</button> : null}
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
