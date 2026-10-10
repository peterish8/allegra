import { ArrowUp, Cpu, Ear, KeyRound, LoaderCircle, Mic, Play, Settings2, Sparkles, Square, Undo2 } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

import { getDjSlashSuggestions, type DjGoal } from '@shared/dj';
import type { UnifiedSong } from '@shared/types';

import { useAudioAnalyser } from '../hooks/useAudioAnalyser';
import { DJ_READY_STATUS, useDjSession, type DjEmotion, type DjPick } from '../hooks/useDjSession';
import { MIC_BLOCKED_COPY, MIC_INSECURE_COPY, useDjVoice } from '../hooks/useDjVoice';
import { LOCAL_VOICE_MB } from '../lib/djWhisper';
import { normalizeEndpoint } from '../lib/djCustom';
import { djTonePalette, djToneFor } from '../lib/djDance';
import { djDanceVibe, type DjMascotMode } from '../lib/djMascotMotion';
import { djEnergyWord, djSuggestions } from '../lib/djSession';
import type { Palette } from '../lib/palette';
import { DjBubble } from './dj/DjBubble';
import { DjCrate } from './dj/DjCrate';
import { DjHistory } from './dj/DjHistory';
import { DjMascot, DjTint } from './dj/DjMascot';
import { DjNowPlaying } from './dj/DjNowPlaying';
import { DjSessionChips } from './dj/DjSessionChips';
import { DjSettingsSheet } from './dj/DjSettingsSheet';
import { DJ_TOUR, djScene } from './dj/DjTour';
import { InfoTour } from './InfoTour';
import { useDjMascot } from './dj/useDjMascot';
import { useDjStageShape } from './dj/useDjStageShape';

interface DjPageProps {
  readonly currentSong: UnifiedSong | null;
  readonly isPlaying: boolean;
  readonly isLive: boolean;
  readonly isRemote: boolean;
  readonly isCurrentLiked: boolean;
  /** Colours of the playing cover; `null` when nothing plays (the DJ then uses its tone colours). */
  readonly palette?: Palette | null;
  /** Recently played songs, newest first: the starter suggestions read their language. */
  readonly recent: readonly UnifiedSong[];
  /** Everything after the song playing now, in order: the queue box lists as much of it as fits. */
  readonly upcoming: readonly UnifiedSong[];
  /** The app's search, as a small icon in the stage's corner. A song picked there is one the DJ notices. */
  readonly searchSlot?: ReactNode;
  readonly audioRef: RefObject<HTMLAudioElement | null>;
  readonly onToggle: () => void;
  readonly onLike: (song: UnifiedSong) => void;
}

const INITIAL_VARS = {
  '--dj-bass': '0', '--dj-energy': '0', '--dj-voice': '0', '--dj-onset': '0',
  '--dj-roam-x': '0', '--dj-roam-y': '0', '--dj-lift': '0', '--dj-squash': '0', '--dj-sway': '0',
  '--dj-look-x': '0', '--dj-look-y': '0', '--dj-blink': '0', '--dj-nod': '0'
} as CSSProperties;

function greeting(hour: number, song: UnifiedSong | null): string {
  const part = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  if (song) return `${part}. Enjoying “${song.title}”? Ask for more like it, or something new.`;
  return `${part}. Tell me a mood, a moment or a song.`;
}

const capitalised = (value: string): string => value.charAt(0).toLocaleUpperCase() + value.slice(1);

/** How many upcoming songs the queue box lists; the column scrolls past what fits. */
const QUEUE_SHOWN = 40;

/** Nothing playing and nobody touching the page for this long: the DJ dozes off until the next move. */
const SLEEP_AFTER_MS = 90_000;

function mascotModeFor(working: boolean, emotion: DjEmotion, playing: boolean, asleep: boolean): DjMascotMode {
  if (working) return 'think';
  if (emotion === 'listening') return 'listen';
  if (playing) return 'groove';
  return asleep ? 'sleep' : 'idle';
}

export function DjPage({
  currentSong, isPlaying, isLive, isRemote, isCurrentLiked, palette = null, recent, upcoming, searchSlot, audioRef, onToggle, onLike,
}: DjPageProps) {
  const dj = useDjSession();
  const {
    provider, model, apiKey, settingsOpen, session, goal, songLimit, draft, draftName, savingPlaylist,
    turn, reasons, working, status, emotion, history, undoable, offers,
    setStatus, setEmotion, setDraftName, setProvider, setModel, setApiKey, setSettingsOpen, setGoal, setSongLimit,
  } = dj;
  const [prompt, setPrompt] = useState('');
  const pageRef = useRef<HTMLDivElement | null>(null);
  const mascotRef = useRef<HTMLDivElement | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const composeRef = useRef<HTMLFormElement | null>(null);
  const outlineRef = useRef<SVGPathElement | null>(null);
  useDjStageShape(heroRef, stageRef, composeRef, outlineRef);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const gearRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const voice = useDjVoice();
  const hearing = Boolean(voice?.listening || voice?.transcribing);
  const reduced = useReducedMotion() ?? false;
  const analyser = useAudioAnalyser(audioRef, isPlaying);
  const [hour] = useState(() => new Date().getHours());

  const tone = djToneFor(session.vibe, session.energy);
  const vibe = djDanceVibe(tone, session.energy);
  const playing = Boolean(currentSong && isPlaying);
  const songPalette = palette ?? djTonePalette(tone);

  // After a long quiet spell (nothing playing, no pointer or key) the DJ dozes; any move wakes it at once.
  const [asleep, setAsleep] = useState(false);
  const busy = playing || working || hearing || settingsOpen;
  useEffect(() => {
    if (busy) {
      setAsleep(false);
      return undefined;
    }
    let timer = window.setTimeout(() => setAsleep(true), SLEEP_AFTER_MS);
    const wake = (): void => {
      setAsleep(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAsleep(true), SLEEP_AFTER_MS);
    };
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [busy]);

  const react = useDjMascot(pageRef, mascotRef, analyser, { mode: mascotModeFor(working, hearing ? 'listening' : emotion, playing, asleep), vibe, playing });

  // A voice problem (blocked mic, no voice in this browser) is said by the DJ, once.
  const voiceError = voice?.error ?? null;
  useEffect(() => {
    if (!voiceError) return;
    setStatus(voiceError);
    setEmotion('error');
  }, [setEmotion, setStatus, voiceError]);

  // The DJ shows how a turn went with its whole body: a hop when it worked, a head shake when it did not.
  const lastEmotion = useRef(emotion);
  useEffect(() => {
    if (lastEmotion.current === emotion) return;
    lastEmotion.current = emotion;
    if (emotion === 'happy') react('joy');
    else if (emotion === 'error') react('shake');
  }, [emotion, react]);

  // The AI settings sheet is a floating panel: Esc and a press outside close it, and focus goes back to the gear.
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      // An Escape something inside already used (closing an open dropdown) leaves the sheet open.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setSettingsOpen(false);
      gearRef.current?.focus();
    };
    const onPress = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target || sheetRef.current?.contains(target) || gearRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-dj-opens-settings]')) return;
      const focusWasInside = Boolean(sheetRef.current?.contains(document.activeElement));
      setSettingsOpen(false);
      if (focusWasInside) gearRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [settingsOpen, setSettingsOpen]);

  const openSettings = (): void => {
    setSettingsOpen(true);
    window.requestAnimationFrame(() => {
      sheetRef.current?.querySelector<HTMLElement>('select, input, button')?.focus();
    });
  };
  const toggleSettings = (): void => {
    if (settingsOpen) setSettingsOpen(false);
    else openSettings();
  };

  // The box empties as soon as a request is sent (like a chat). If that request fails and nothing newer
  // was sent since, its words come back so they can be fixed and sent again.
  const submitCountRef = useRef(0);
  const submit = (value: string): void => {
    const sent = value.trim();
    if (!sent) return;
    const id = submitCountRef.current + 1;
    submitCountRef.current = id;
    if (!sent.startsWith('/')) setPrompt('');
    void dj.submitPrompt(sent).then((outcome) => {
      if (outcome.prefill !== undefined) setPrompt(outcome.prefill);
      else if (outcome.clear) {
        if (sent.startsWith('/')) setPrompt('');
      } else if (submitCountRef.current === id) setPrompt((current) => current || sent);
    });
  };

  const needsStart = Boolean(goal === 'mix' && turn && turn.operation !== 'keep' && turn.queue.length > 0 && (!currentSong || isRemote));
  // Set up means: on-device, a custom endpoint with a usable URL (its key is optional), or a cloud key.
  const needsSetup = history.length === 0 && (provider === 'custom'
    ? !normalizeEndpoint(dj.endpoint)
    : provider !== 'local' && !apiKey.trim());

  // "Ready when you are" is only true until the set starts, whichever control starts it.
  useEffect(() => {
    if (status === DJ_READY_STATUS && !needsStart) setStatus(turn?.reply ?? '');
  }, [needsStart, setStatus, status, turn]);

  // What the queue box lists. A started mix lists the DJ's own picks still waiting in the queue; with no
  // DJ turn (an album queue) it lists what is coming up, and nothing in it can be moved.
  const crate = useMemo<{ readonly items: readonly DjPick[]; readonly editable: boolean }>(() => {
    if (goal === 'playlist') return { items: draft, editable: true };
    if (needsStart && turn) return { items: turn.queue, editable: true };
    const shown = upcoming.slice(0, QUEUE_SHOWN);
    if (!turn) return { items: shown.map((song) => ({ song, reason: reasons[song.id] ?? '' })), editable: false };
    return {
      items: shown.filter((song) => reasons[song.id] !== undefined).map((song) => ({ song, reason: reasons[song.id] ?? '' })),
      editable: true
    };
  }, [draft, goal, needsStart, upcoming, reasons, turn]);

  const commandSuggestions = getDjSlashSuggestions(prompt, goal);
  const starters = useMemo(
    () => djSuggestions(currentSong, recent.slice(0, 12), hour, session),
    [currentSong, hour, recent, session]
  );
  // The set at a glance, from what the DJ actually holds: vibe · energy · language, and whether its set plays.
  const strip = [session.vibe ? capitalised(session.vibe) : '', session.vibe || session.language ? djEnergyWord(session.energy) : '', session.language ? capitalised(session.language) : '']
    .filter(Boolean)
    .join(' · ');
  const chooseGoal = (next: DjGoal): void => {
    setGoal(next);
    setSongLimit(next === 'mix' ? Math.min(songLimit, 8) : Math.max(songLimit, 10));
  };
  // Under the console: the Mix / energy dial and just two ideas, so the row stays one line.
  const showStarters = !prompt && !working && !hearing;

  const playPick = (song: UnifiedSong): void => {
    if (song.id === currentSong?.id) {
      onToggle();
      return;
    }
    if (goal === 'playlist') dj.playFrom(song, draft.map((pick) => pick.song));
    else if (needsStart && turn) dj.startPlan(turn, song.id);
    else dj.playFrom(song, crate.items.map((pick) => pick.song));
  };
  const reorderPicks = (ids: readonly string[]): boolean | void => {
    if (goal === 'playlist') dj.reorderDraft(ids);
    else if (needsStart) dj.reorderTurn(ids);
    else return dj.reorder(ids);
    return undefined;
  };
  const removePick = (id: string): void => {
    if (goal === 'playlist') dj.removeFromDraft(id);
    else if (needsStart) dj.removeFromTurn(id);
    else dj.removePick(id);
  };

  const chooseLocal = (): void => {
    setProvider('local');
    setSettingsOpen(false);
    setStatus('I’ll think on this device. The first request downloads my model once, about 390 MB.');
    inputRef.current?.focus();
  };

  const voiceLine = !voice ? null
    : voice.localProgress !== null ? (voice.localProgress >= 100 ? 'Almost ready, warming up my ears…' : `Getting my ears ready · ${voice.localProgress}%`)
      : voice.needsLocalDownload ? `Here I listen on your device, so nothing you say leaves it. That needs a one-time ${LOCAL_VOICE_MB} MB download.`
        : voice.transcribing ? 'Writing that down…'
          : voice.listening ? (voice.transcript || (voice.micState === 'prompt' || voice.micState === 'unknown' ? 'Your browser is asking to use the microphone. Choose Allow, then speak.' : 'Listening…'))
            : null;
  const bubbleText = voiceLine ?? (status || (needsSetup ? 'Hi, I’m your DJ. Before we start, how should I think?' : greeting(hour, currentSong)));
  const bubbleActions = voice?.needsLocalDownload ? (
    <>
      <button type="button" className="dj-chip-button dj-chip-button--accent" onClick={() => void voice.downloadLocal()}><Mic size={14} aria-hidden="true" />Download · {LOCAL_VOICE_MB} MB</button>
      <button type="button" className="dj-chip-button" onClick={voice.dismissDownload}>Not now</button>
    </>
  ) : status === MIC_BLOCKED_COPY || status === MIC_INSECURE_COPY ? (
    <>
      {status === MIC_BLOCKED_COPY ? <button type="button" className="dj-chip-button dj-chip-button--accent" onClick={() => { setStatus(''); voice?.listen(); }}><Mic size={14} aria-hidden="true" />Try again</button> : null}
      <button type="button" className="dj-chip-button" data-dj-opens-settings="" onClick={openSettings}><Settings2 size={14} aria-hidden="true" />Voice settings</button>
    </>
  ) : voiceLine ? null : needsSetup && !status ? (
    <>
      <button type="button" className="dj-chip-button" onClick={chooseLocal}><Cpu size={14} aria-hidden="true" />On this device · free</button>
      <button type="button" className="dj-chip-button" data-dj-opens-settings="" onClick={openSettings}><KeyRound size={14} aria-hidden="true" />Use my AI key</button>
    </>
  ) : (offers.length > 0 || undoable > 0) && status && !working ? (
    <>
      {undoable > 0 ? <button type="button" className="dj-chip-button" onClick={dj.undoPlan}><Undo2 size={14} aria-hidden="true" />Undo</button> : null}
      {offers.map((item) => (
        <button key={item.label} type="button" className="dj-chip-button" onClick={() => submit(item.prompt)}>{item.label}</button>
      ))}
    </>
  ) : needsStart && turn && !isRemote ? (
    <button type="button" className="dj-chip-button dj-chip-button--accent" onClick={() => dj.startPlan(turn)}><Play size={13} fill="currentColor" aria-hidden="true" />Start this set</button>
  ) : null;

  const showNow = Boolean(currentSong && goal === 'mix');
  // "From your DJ" only when the DJ really picked the song playing now (radio and search plays are not its set).
  const djPickPlaying = Boolean(isLive && currentSong && reasons[currentSong.id] !== undefined);
  const nowRow = currentSong && showNow ? (
    <DjNowPlaying
      song={currentSong}
      playing={isPlaying}
      liked={isCurrentLiked}
      live={djPickPlaying}
      reason={reasons[currentSong.id] ?? ''}
      palette={songPalette}
      onToggle={onToggle}
      onLike={() => onLike(currentSong)}
      onSkip={dj.skipAndTeach}
    />
  ) : null;

  return (
    <div className="dj-page" ref={pageRef} data-tone={tone} data-hearing={hearing ? 'true' : 'false'} style={{ ...INITIAL_VARS, '--dj-a': songPalette.primary, '--dj-b': songPalette.secondary } as CSSProperties}>
      <h1 className="sr-only">Your DJ</h1>
      <div className="dj-layout">
        <section className="dj-hero" aria-label="Your DJ companion" ref={heroRef}>
          <DjTint palette={songPalette} className="dj-stage-wash" />
          <svg className="dj-hero-edge" aria-hidden="true" preserveAspectRatio="none">
            <defs>
              <linearGradient id="dj-hero-edge-light" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity=".26" />
                <stop offset=".55" stopColor="#fff" stopOpacity=".12" />
                <stop offset="1" stopColor="#fff" stopOpacity=".2" />
              </linearGradient>
            </defs>
            <path ref={outlineRef} />
          </svg>
          <div className="dj-mascot-stage" ref={stageRef}>
            <DjMascot
              ref={mascotRef}
              size="stage"
              emotion={working ? 'thinking' : asleep && !playing ? 'sleeping' : emotion}
              palette={songPalette}
              playing={playing}
              vibe={vibe}
            />
            <DjBubble text={bubbleText} working={working || Boolean(voice?.transcribing) || voice?.localProgress !== null && voice?.localProgress !== undefined} reduced={reduced} actions={bubbleActions} />
            <div className="dj-stage-info">
              <InfoTour label="How your DJ works" steps={DJ_TOUR} stage={djScene} />
              <DjHistory history={history} reduced={reduced} />
            </div>
            {strip || (djPickPlaying && goal === 'mix') ? (
              <p className="dj-session-strip">
                {djPickPlaying && goal === 'mix' ? <span className="dj-session-live"><i aria-hidden="true" />DJ set playing</span> : null}
                {strip ? <span className="dj-session-vibe">{strip}</span> : null}
              </p>
            ) : null}
            <div className="dj-stage-tools">
              {voice && voice.engine !== 'none' ? (
                <button
                  type="button"
                  className={`dj-tool-button dj-wake-button${voice.wakeOn ? ' is-on' : ''}`}
                  onClick={() => voice.setWake(!voice.wakeOn)}
                  aria-pressed={voice.wakeOn}
                  aria-label="Hey DJ: listen for my voice"
                  title={voice.wakeAvailable ? (voice.wakeOn ? '“Hey DJ” is on. Say “Hey DJ, play …”' : 'Turn on “Hey DJ”') : '“Hey DJ” needs voice on this device: pick it in the settings'}
                >
                  <Ear size={17} />
                </button>
              ) : null}
              <button
                type="button"
                ref={gearRef}
                className="dj-tool-button"
                onClick={toggleSettings}
                aria-label="DJ settings"
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
                aria-controls="dj-settings-sheet"
              >
                <Settings2 size={17} />
              </button>
              {searchSlot}
              {settingsOpen ? (
                <DjSettingsSheet
                  ref={sheetRef}
                  provider={provider}
                  model={model}
                  endpoint={dj.endpoint}
                  apiKey={apiKey}
                  onProvider={setProvider}
                  onModel={setModel}
                  onEndpoint={dj.setEndpoint}
                  onApiKey={setApiKey}
                  voice={voice}
                  onClose={() => { setSettingsOpen(false); gearRef.current?.focus(); }}
                />
              ) : null}
            </div>
          </div>

          <form className="dj-compose" ref={composeRef} onSubmit={(event) => { event.preventDefault(); submit(prompt); }}>
            <div className="dj-input-wrap" data-busy={working || hearing ? 'true' : 'false'}>
              <span className="dj-input-ring" aria-hidden="true"><i /></span>
              <input
                ref={inputRef}
                value={hearing ? voice?.transcript ?? '' : prompt}
                readOnly={hearing}
                onFocus={() => { if (!working) setEmotion('listening'); }}
                onBlur={() => { if (!working && (emotion === 'listening' || emotion === 'curious')) setEmotion('idle'); }}
                onChange={(event) => { setPrompt(event.target.value); if (status && !working) setStatus(''); }}
                maxLength={500}
                placeholder={hearing ? 'Listening…' : goal === 'playlist' ? 'What should this playlist be?' : 'What should we play next?'}
                aria-label="Tell your DJ what you want to hear"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={commandSuggestions.length > 0}
                aria-haspopup="listbox"
                aria-controls={commandSuggestions.length ? 'dj-command-menu' : undefined}
              />
              <button
                type="button"
                className="dj-mic-button"
                data-state={voice?.transcribing ? 'writing' : voice?.listening ? 'listening' : 'ready'}
                onClick={() => {
                  if (!voice || voice.engine === 'none') {
                    setStatus('Voice isn’t available in this browser. Type your request instead.');
                    setEmotion('error');
                  } else if (voice.listening) voice.stop();
                  else if (!voice.transcribing) {
                    voice.stopSpeaking();
                    voice.listen();
                  }
                }}
                aria-label={voice?.transcribing ? 'Writing down what you said' : voice?.listening ? 'Stop listening' : 'Speak your request'}
                aria-pressed={hearing}
              >
                {voice?.transcribing ? <LoaderCircle size={17} className="dj-spin" /> : <Mic size={17} />}
              </button>
              {/* Like a chat box: an arrow to send; while the DJ works and nothing new is typed, a square to stop it. */}
              {working && !prompt.trim() ? (
                <button type="button" className="dj-send-button is-stop" onClick={dj.cancel} aria-label="Stop the DJ" title="Stop">
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button type="submit" className="dj-send-button" disabled={!prompt.trim()} aria-label="Ask the DJ">
                  <ArrowUp size={18} strokeWidth={2.4} />
                </button>
              )}
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

            <div className="dj-compose-row">
              <DjSessionChips
                session={session}
                goal={goal}
                draftCount={draft.length}
                shape={dj.shape}
                exploration={dj.exploration}
                excludeArtists={dj.excludeArtists}
                onEnergy={dj.setEnergy}
                onRemoveConstraint={dj.removeConstraint}
                onClearLanguage={dj.clearLanguage}
                onGoal={chooseGoal}
                onShape={dj.setShape}
                onExploration={dj.setExploration}
                onAllowArtist={dj.allowArtist}
              />
              {showStarters ? (
                <ul className="dj-starters" aria-label="Try asking">
                  {starters.slice(0, 2).map((chip) => (
                    <li key={chip.label}><button type="button" className="dj-starter" title={chip.hint} onClick={() => submit(chip.prompt)}>{chip.label}</button></li>
                  ))}
                </ul>
              ) : null}
            </div>
          </form>
        </section>

        {isRemote ? <p className="dj-note" role="status">Switch playback to this device to use your DJ’s queue.</p> : null}

        {goal === 'playlist' ? (
          <DjCrate
            items={crate.items}
            editable
            reduced={reduced}
            label="Editable playlist draft"
            header={(
              <>
                <div className="dj-crate-title"><h3>Your playlist draft</h3><span>{draft.length} of {songLimit} songs · nothing plays until you choose</span></div>
                {draft.length > 0 ? <>
                  <label className="dj-draft-name"><span className="sr-only">Playlist name</span><input value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={100} aria-label="Playlist name" /></label>
                  <button type="button" className="dj-primary dj-crate-action" onClick={() => void dj.savePlaylist()} disabled={savingPlaylist}><Sparkles size={14} /> {savingPlaylist ? 'Saving…' : 'Save playlist'}</button>
                </> : null}
              </>
            )}
            empty={<p className="dj-crate-empty">Tell your DJ a mood or a few songs to start a playlist draft.</p>}
            onPlay={playPick}
            onReorder={reorderPicks}
            onRemove={removePick}
          />
        ) : crate.items.length > 0 || nowRow ? (
          <DjCrate
            items={crate.items}
            editable={crate.editable}
            reduced={reduced}
            label={needsStart ? 'Your DJ’s set' : 'Now playing and coming up'}
            lead={nowRow}
            header={(
              <>
                <div className="dj-crate-title">
                  <h3>{needsStart ? 'Your set' : 'Up next'}<span className="dj-crate-count"> · {crate.items.length} {crate.items.length === 1 ? 'song' : 'songs'}</span></h3>
                  <span>{needsStart ? 'Planned by your DJ · starts when you press Start' : turn && crate.editable ? 'Picked by your DJ · your own queued songs stay first' : 'Your queue'}</span>
                </div>
                {needsStart && turn && !isRemote ? (
                  <button type="button" className="dj-primary dj-crate-action" onClick={() => dj.startPlan(turn)}><Play size={14} fill="currentColor" /> Start this set</button>
                ) : null}
              </>
            )}
            empty={<p className="dj-crate-empty">Nothing lined up yet. Ask your DJ and its picks land here, each with the reason it chose them.</p>}
            onPlay={playPick}
            onReorder={reorderPicks}
            onRemove={removePick}
          />
        ) : null}
      </div>
    </div>
  );
}
