import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { parseDjSlashCommand } from '@shared/dj';
import type { DjCloudProvider, DjExploration, DjGoal, DjPlaylistSource, DjSessionState, DjSetShape, DjTrackContext, DjTurnRequest, DjTurnResponse } from '@shared/dj';
import { leadArtist, readArtistRules } from '@shared/djLocal';
import type { UnifiedSong } from '@shared/types';

import { requestDjTurn } from '../lib/api';
import { parseDjAction, type DjAction, type DjActionResult } from '../lib/djActions';
import { customChat, normalizeEndpoint } from '../lib/djCustom';
import { requestLocalDjTurn } from '../lib/djLocal';
import { samplePlaylistTracks } from '../lib/djPlaylistSources';
import { savePlaylistWithSongs } from '../lib/savePlaylist';
import {
  applySlashCommand,
  defaultModelFor,
  djOffersAfterSet,
  djOutcome,
  orderByIds,
  readDjMemory,
  readDjProviderChoice,
  sessionWithEnergy,
  sessionWithoutConstraint,
  sessionWithoutLanguage,
  withExcludedArtists,
  writeDjMemory,
  writeDjProviderChoice,
  type DjBrain,
  type DjMemory,
  type DjProviderChoice
} from '../lib/djSession';
import type { PlaylistsApi } from './usePlaylists';

export type DjEmotion = 'idle' | 'listening' | 'thinking' | 'curious' | 'happy' | 'error';

export interface DjPick {
  readonly song: UnifiedSong;
  readonly reason: string;
}

export interface DjSessionInputs {
  readonly playlists: PlaylistsApi;
  readonly currentSong: UnifiedSong | null;
  readonly isRemote: boolean;
  readonly recent: readonly UnifiedSong[];
  readonly likedSongs: readonly UnifiedSong[];
  /** The next few songs in the queue, in order (App passes `playingNext.slice(0, 8)`). */
  readonly nextSongs: readonly UnifiedSong[];
  /** Puts a mix set into the queue; returns how many songs it really placed (0 = none). */
  readonly onApplyPlan: (turn: DjTurnResponse) => number;
  /** Puts back the upcoming songs a set replaced. False when there is nothing to put back. */
  readonly onUndoPlan: () => boolean;
  readonly onStartPlan: (turn: DjTurnResponse, fromId?: string) => void;
  readonly onReorder: (ids: readonly string[]) => boolean;
  readonly onRemove: (id: string) => boolean;
  readonly onPlayFrom: (song: UnifiedSong, list: readonly UnifiedSong[]) => boolean;
  readonly onSkip: () => void;
  /** Does something in the app the listener asked for (play, karaoke, like, open…). Never throws. */
  readonly onAction: (action: DjAction) => Promise<DjActionResult>;
  /** The listener's playlist names, so "play Gym" finds the playlist called Gym. */
  readonly playlistNames: readonly string[];
  /** Each finished reply, for the DJ's voice to say out loud. */
  readonly onReply?: (text: string) => void;
}

/** One next step the DJ offers under its words, sent as a request when pressed. */
export interface DjOffer {
  readonly label: string;
  readonly prompt: string;
}

export interface DjSendOptions {
  readonly goal?: DjGoal;
  readonly songLimit?: number;
  readonly playlistSources?: readonly { readonly name: string; readonly songs: readonly UnifiedSong[] }[];
}

export interface DjSession {
  readonly provider: DjBrain;
  readonly model: string;
  /** A custom endpoint's URL as typed (its usable form is what gets stored). */
  readonly endpoint: string;
  readonly apiKey: string;
  readonly settingsOpen: boolean;
  readonly session: DjSessionState;
  readonly goal: DjGoal;
  readonly songLimit: number;
  readonly draft: readonly DjPick[];
  readonly draftName: string;
  readonly savingPlaylist: boolean;
  readonly history: readonly DjTurnRequest['history'][number][];
  readonly skipped: readonly UnifiedSong[];
  readonly turn: DjTurnResponse | null;
  readonly reasons: Readonly<Record<string, string>>;
  readonly working: boolean;
  readonly status: string;
  readonly emotion: DjEmotion;
  readonly nextSongs: readonly UnifiedSong[];
  /** Songs the last set replaced in the queue; 0 when there is nothing to undo. */
  readonly undoable: number;
  readonly undoPlan: () => void;
  /** Next steps the DJ offers under its words (at most two), sent as requests when pressed. */
  readonly offers: readonly DjOffer[];
  /** Stops the turn in progress; its result, if it still arrives, is dropped. */
  readonly cancel: () => void;
  /** The listener picked a song themselves (search): the DJ notices and offers to follow it. */
  readonly notePick: (song: UnifiedSong) => void;
  /** Sends one message. Resolves true only when the turn completed (the prompt can be cleared). */
  readonly send: (message: string, options?: DjSendOptions) => Promise<boolean>;
  /** A typed or spoken request: a slash shortcut, something to do in the app, or a turn for the DJ's model. */
  readonly submitPrompt: (value: string, options?: { readonly goal?: DjGoal }) => Promise<{ readonly clear: boolean; readonly prefill?: string }>;
  readonly savePlaylist: () => Promise<void>;
  readonly skipAndTeach: () => void;
  readonly removeFromDraft: (songId: string) => void;
  readonly startPlan: (turn: DjTurnResponse, fromId?: string) => void;
  readonly reorder: (ids: readonly string[]) => boolean;
  readonly removePick: (id: string) => boolean;
  /** Edits the set the DJ has planned but not started: order and removal act on the turn's own queue. */
  readonly reorderTurn: (ids: readonly string[]) => void;
  readonly removeFromTurn: (id: string) => void;
  readonly reorderDraft: (ids: readonly string[]) => void;
  /** The DJ's memory, edited by hand; the next turn sends the edited session. */
  readonly setEnergy: (energy: number) => void;
  readonly removeConstraint: (constraint: string) => void;
  readonly clearLanguage: () => void;
  /** Artists ruled out for this session; every turn hard-filters them. */
  readonly excludeArtists: readonly string[];
  /** Rules an artist out for the rest of the session ("Less like this artist"). */
  readonly avoidArtist: (artist: string) => void;
  readonly allowArtist: (name: string) => void;
  readonly exploration: DjExploration;
  readonly setExploration: (exploration: DjExploration) => void;
  /** The planned shape of the next set; a plan, never measured energy. */
  readonly shape: DjSetShape;
  readonly setShape: (shape: DjSetShape) => void;
  readonly playFrom: (song: UnifiedSong, list: readonly UnifiedSong[]) => boolean;
  readonly setStatus: (status: string) => void;
  readonly setEmotion: (emotion: DjEmotion | ((current: DjEmotion) => DjEmotion)) => void;
  readonly setGoal: (goal: DjGoal) => void;
  readonly setSongLimit: (songLimit: number) => void;
  readonly setDraftName: (name: string) => void;
  readonly setProvider: (provider: DjBrain) => void;
  readonly setModel: (model: string) => void;
  readonly setEndpoint: (endpoint: string) => void;
  readonly setApiKey: (apiKey: string) => void;
  readonly setSettingsOpen: (open: boolean) => void;
}

/** Shown when a set is planned but nothing plays yet. It must not outlive the start of the set. */
export const DJ_READY_STATUS = 'Your set is ready when you are. Press Play to start it.';

const EMPTY_SESSION: DjSessionState = { vibe: '', energy: 3, language: null, constraints: [] };

function contextSong(song: UnifiedSong): DjTrackContext {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    ...(song.language ? { language: song.language } : {})
  };
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function sessionStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function initialMemory(): DjMemory | null {
  const storage = sessionStore();
  return storage ? readDjMemory(storage) : null;
}

function initialChoice(): DjProviderChoice {
  const storage = browserStorage();
  return (storage ? readDjProviderChoice(storage) : null) ?? { provider: 'openai', model: defaultModelFor('openai') };
}

export const DjSessionContext = createContext<DjSession | null>(null);

export function useDjSession(): DjSession {
  const value = useContext(DjSessionContext);
  if (!value) throw new Error('useDjSession needs a DjSessionContext provider.');
  return value;
}

/**
 * The one DJ session of the app. App calls this once and provides it through DjSessionContext, so the
 * conversation survives leaving /dj. Provider and model are stored; the conversation (session, history,
 * draft) lives in this tab's sessionStorage so a reload keeps it; the API key lives in memory only.
 */
export function useDjSessionState(inputs: DjSessionInputs): DjSession {
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const [memory] = useState<DjMemory | null>(initialMemory);
  const [choice, setChoice] = useState<DjProviderChoice>(initialChoice);
  const [apiKey, setApiKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [session, setSession] = useState<DjSessionState>(memory?.session ?? EMPTY_SESSION);
  const [goal, setGoal] = useState<DjGoal>(memory?.goal ?? 'mix');
  const [songLimit, setSongLimit] = useState(memory?.songLimit ?? 8);
  const [draft, setDraft] = useState<readonly DjPick[]>(memory?.draft ?? []);
  const [draftName, setDraftName] = useState(memory?.draftName ?? 'A little mix');
  const [savingPlaylist, setSavingPlaylist] = useState(false);
  const [history, setHistory] = useState<DjTurnRequest['history'][number][]>(() => [...(memory?.history ?? [])]);
  const [skipped, setSkipped] = useState<UnifiedSong[]>([]);
  const [turn, setTurn] = useState<DjTurnResponse | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>(() => ({ ...(memory?.reasons ?? {}) }));
  const [excludeArtists, setExcludeArtists] = useState<readonly string[]>(() => [...(memory?.excludeArtists ?? [])]);
  const [exploration, setExploration] = useState<DjExploration>(memory?.exploration ?? 'balanced');
  const [shape, setShape] = useState<DjSetShape>(memory?.shape ?? 'steady');
  const [undoable, setUndoable] = useState(0);
  const [offers, setOffers] = useState<readonly DjOffer[]>([]);
  /** The turn in flight. A newer request aborts it; a result for any other id is stale and dropped. */
  const runRef = useRef<{ readonly id: number; readonly controller: AbortController } | null>(null);
  const runCounterRef = useRef(0);
  const [working, setWorking] = useState(false);
  const [emotion, setEmotion] = useState<DjEmotion>('idle');
  const [status, setStatus] = useState('');
  const { provider, model, endpoint = '' } = choice;

  /** Stores a choice; the endpoint is written only once it is a usable URL (it is typed a letter at a time). */
  const storeChoice = useCallback((next: DjProviderChoice): void => {
    setChoice(next);
    const storage = browserStorage();
    const usable = next.endpoint ? normalizeEndpoint(next.endpoint) : null;
    if (storage) writeDjProviderChoice(storage, { provider: next.provider, model: next.model, ...(usable ? { endpoint: usable } : {}) });
  }, []);

  const setProvider = useCallback((next: DjBrain): void => {
    storeChoice({ provider: next, model: defaultModelFor(next), ...(endpoint ? { endpoint } : {}) });
  }, [endpoint, storeChoice]);

  const setModel = useCallback((next: string): void => {
    storeChoice({ provider, model: next, ...(endpoint ? { endpoint } : {}) });
  }, [endpoint, provider, storeChoice]);

  const setEndpoint = useCallback((next: string): void => {
    storeChoice({ provider, model, endpoint: next.slice(0, 300) });
  }, [model, provider, storeChoice]);

  // The conversation survives a reload of this tab. Reasons are trimmed to the newest few dozen.
  useEffect(() => {
    const storage = sessionStore();
    if (!storage) return;
    const recentReasons = Object.fromEntries(Object.entries(reasons).slice(-60));
    writeDjMemory(storage, { session, history, goal, songLimit, draft, draftName, reasons: recentReasons, excludeArtists, exploration, shape });
  }, [draft, draftName, excludeArtists, exploration, goal, history, reasons, session, shape, songLimit]);

  useEffect(() => {
    if (emotion !== 'curious') return undefined;
    const timer = window.setTimeout(() => setEmotion(current => current === 'curious' ? 'idle' : current), 1100);
    return () => window.clearTimeout(timer);
  }, [emotion]);

  const cancel = useCallback((): void => {
    const run = runRef.current;
    if (!run) return;
    run.controller.abort();
    runRef.current = null;
    setWorking(false);
    setStatus('Stopped. Nothing was changed.');
    setEmotion('idle');
  }, []);

  const send = useCallback(async (message: string, options?: DjSendOptions): Promise<boolean> => {
    const text = message.trim();
    if (!text) return false;
    const { currentSong, isRemote, recent, likedSongs, nextSongs, onApplyPlan } = inputsRef.current;
    const selectedGoal = options?.goal ?? goal;
    const selectedSongLimit = options?.songLimit ?? songLimit;
    // A custom endpoint's key is optional (a local router may not ask for one); its URL is not.
    if (provider !== 'local' && provider !== 'custom' && !apiKey.trim()) {
      setSettingsOpen(true);
      setStatus('Add your AI key to start a DJ conversation.');
      return false;
    }
    const customEndpoint = provider === 'custom' ? normalizeEndpoint(endpoint) : null;
    if (provider === 'custom' && !customEndpoint) {
      setSettingsOpen(true);
      setStatus('Add your endpoint’s URL, like http://localhost:20128/v1.');
      return false;
    }
    if (provider !== 'local' && !model.trim()) {
      setSettingsOpen(true);
      setStatus(provider === 'custom' ? 'Choose one of your endpoint’s models.' : 'Choose a model that supports tool calling.');
      return false;
    }
    // A newer request replaces the one in flight: the older one is aborted and its answer dropped.
    runRef.current?.controller.abort();
    const controller = new AbortController();
    const runId = runCounterRef.current + 1;
    runCounterRef.current = runId;
    runRef.current = { id: runId, controller };
    const isCurrent = (): boolean => runRef.current?.id === runId;
    setWorking(true);
    setUndoable(0);
    setOffers([]);
    setEmotion('thinking');
    setStatus(selectedGoal === 'playlist' ? 'Finding tracks for your playlist…' : 'Finding tracks that match your request…');
    // What this request says about artists, read the same way on both paths. An explicit "only X" or
    // "more from X" lifts an earlier "no X"; a new "no X" joins the session's ruled-out list.
    const currentContext = currentSong ? contextSong(currentSong) : null;
    const rules = readArtistRules(text.toLowerCase(), currentContext);
    const asked = rules.only ?? text.toLowerCase().match(/\bmore (?:from|by) ([\p{L}][\p{L}\p{N} .'&-]{1,40})/u)?.[1]?.trim() ?? null;
    const kept = asked ? excludeArtists.filter((name) => !asked.includes(name) && !name.includes(asked)) : excludeArtists;
    const turnExclusions = withExcludedArtists(kept, rules.exclude);
    try {
      const common = {
        excludeArtists: turnExclusions,
        exploration,
        shape,
        goal: selectedGoal,
        songLimit: selectedGoal === 'mix' ? Math.min(selectedSongLimit, 8) : selectedSongLimit,
        message: text,
        history: history.slice(-8),
        current: currentContext,
        queue: nextSongs.slice(0, 8).map(contextSong),
        draft: draft.map(({ song }) => contextSong(song)),
        draftName,
        recent: recent.slice(0, 8).map(contextSong),
        liked: likedSongs.slice(0, 8).map(contextSong),
        skipped: skipped.slice(0, 8).map(contextSong),
        ...(options?.playlistSources?.length ? {
          playlistSources: options.playlistSources.slice(0, 2).map((source): DjPlaylistSource => ({
            name: source.name.slice(0, 100),
            tracks: samplePlaylistTracks(source.songs, 40).map(contextSong)
          }))
        } : {}),
        session
      };
      // On-device and custom-endpoint turns run in this browser; only the cloud key path uses the API.
      const local = provider === 'local' || customEndpoint
        ? await requestLocalDjTurn({
          ...common,
          draft,
          onProgress: (line) => { if (isCurrent()) setStatus(line); },
          signal: controller.signal,
          ...(customEndpoint ? { think: (messages) => customChat(customEndpoint, apiKey.trim(), model.trim(), messages, controller.signal) } : {})
        })
        : null;
      const result: DjTurnResponse = local ?? await requestDjTurn({ ...common, provider: provider as DjCloudProvider, apiKey: apiKey.trim(), model: model.trim() }, controller.signal);
      // Stopped, or overtaken by a newer request: this answer is stale and changes nothing.
      if (!isCurrent()) return false;
      setTurn(result);
      setSession(result.session);
      // The on-device path may rule out more (its model reads the request too); the cloud path keeps ours.
      setExcludeArtists(withExcludedArtists(turnExclusions, local?.excludeArtists ?? []));
      setHistory((items) => [...items, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: result.reply }].slice(-8));
      if (result.queue.length > 0) {
        setReasons((current) => ({ ...current, ...Object.fromEntries(result.queue.map((item) => [item.song.id, item.reason])) }));
      }
      const happy = result.reaction === 'excited' || result.reaction === 'dreamy';
      let said: string;
      if (selectedGoal === 'playlist') {
        const removed = new Set(result.removeTrackIds);
        const remaining = draft.filter(({ song }) => !removed.has(song.id));
        const nextDraft = (result.draftOperation === 'replace' ? [...result.queue]
          : result.draftOperation === 'extend' ? [...remaining, ...result.queue]
            : remaining).slice(0, selectedSongLimit);
        setDraft(nextDraft);
        if (result.playlistName) setDraftName(result.playlistName);
        said = djOutcome(result, {
          draftSize: nextDraft.length,
          added: Math.max(0, nextDraft.length - remaining.length),
          removed: draft.length - remaining.length
        });
        setEmotion(happy ? 'happy' : 'idle');
      } else if (result.operation === 'replace_upcoming' || result.operation === 'insert') {
        // The set is also kept as the draft, so switching to Playlist can save it.
        setDraft([...result.queue]);
        const applied = currentSong && !isRemote ? onApplyPlan(result) : 0;
        if (applied > 0) {
          if (result.operation === 'replace_upcoming') setUndoable(applied);
          setOffers(djOffersAfterSet(result.session.energy));
          said = djOutcome(result, { applied });
          setEmotion('happy');
        } else {
          said = isRemote ? 'Your set is ready. Switch playback to this device to use it.' : DJ_READY_STATUS;
          setEmotion('happy');
        }
      } else {
        said = result.reply;
        setEmotion(result.reaction === 'confused' ? 'error' : 'idle');
      }
      setStatus(said);
      inputsRef.current.onReply?.(said);
      return true;
    } catch (error) {
      if (controller.signal.aborted || !isCurrent()) return false;
      const fallback = selectedGoal === 'playlist' ? 'Couldn’t update the draft. Nothing in it was lost.' : 'Couldn’t update the queue. Your music is still playing.';
      setStatus(error instanceof Error && error.message ? error.message : fallback);
      setEmotion('error');
      return false;
    } finally {
      if (isCurrent()) {
        runRef.current = null;
        setWorking(false);
      }
    }
  }, [apiKey, draft, draftName, endpoint, excludeArtists, exploration, goal, history, model, provider, session, shape, skipped, songLimit]);

  /**
   * Carries out an app request on the spot, and keeps it in the conversation so the model knows. It may
   * run while a set is being planned ("pause" mid-plan); it then leaves that turn's working state alone.
   */
  const act = useCallback(async (value: string, action: DjAction): Promise<boolean> => {
    const planning = runRef.current !== null;
    if (!planning) setWorking(true);
    setUndoable(0);
    setOffers([]);
    if (!planning) setEmotion('thinking');
    try {
      const result = await inputsRef.current.onAction(action);
      setStatus(result.reply);
      inputsRef.current.onReply?.(result.reply);
      setEmotion(result.ok ? 'happy' : 'error');
      setHistory((items) => [...items, { role: 'user' as const, content: value }, { role: 'assistant' as const, content: result.reply }].slice(-8));
      if (result.ok && (action.kind === 'play-song' || action.kind === 'now-playing')) {
        setOffers([{ label: 'Line up more like this', prompt: 'More songs like this one next' }]);
      }
      return result.ok;
    } finally {
      if (!runRef.current) setWorking(false);
    }
  }, []);

  const submitPrompt = useCallback(async (raw: string, options?: { readonly goal?: DjGoal }): Promise<{ readonly clear: boolean; readonly prefill?: string }> => {
    // No "busy" guard: an app command runs at once even mid-plan, and a new request replaces the one in flight.
    const value = raw.trim();
    if (!value) return { clear: false };
    const parsed = parseDjSlashCommand(value);
    if (!parsed) {
      if (value.startsWith('/')) {
        setStatus('Unknown shortcut. Type / to see the DJ commands.');
        return { clear: false };
      }
      const action = parseDjAction(value, { playlistNames: inputsRef.current.playlistNames });
      if (action) return { clear: await act(value, action) };
      return { clear: await send(value, options?.goal ? { goal: options.goal } : undefined) };
    }
    setEmotion('idle');
    const outcome = applySlashCommand({ goal, songLimit }, parsed);
    if (outcome.next.goal) setGoal(outcome.next.goal);
    if (outcome.next.songLimit !== undefined) setSongLimit(outcome.next.songLimit);
    if (outcome.next.settingsOpen !== undefined) setSettingsOpen(outcome.next.settingsOpen);
    if (outcome.status) setStatus(outcome.status);
    if (outcome.send) {
      const { message, goal: sendGoal, songLimit: sendLimit } = outcome.send;
      void send(message, {
        ...(sendGoal ? { goal: sendGoal } : {}),
        ...(sendLimit !== undefined ? { songLimit: sendLimit } : {})
      });
    }
    return outcome.prompt;
  }, [act, goal, send, songLimit]);

  const notePick = useCallback((song: UnifiedSong): void => {
    setUndoable(0);
    setStatus(`“${song.title}”, nice pick. Want me to line up more like it after this?`);
    setOffers([{ label: 'Yes, more like this', prompt: `More songs like ${song.title} by ${song.artist} next` }]);
    setEmotion('happy');
  }, []);

  const savePlaylist = useCallback(async (): Promise<void> => {
    if (draft.length === 0 || savingPlaylist) return;
    const { playlists } = inputsRef.current;
    setSavingPlaylist(true);
    setStatus('Saving your playlist…');
    try {
      const result = await savePlaylistWithSongs(draftName.trim() || 'A little mix', draft.map(({ song }) => song), playlists);
      if (!result.ok) throw new Error(result.error);
      setStatus(`Saved “${result.playlist.name}” to your playlists.`);
      setEmotion('happy');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The playlist could not be saved.');
      setEmotion('error');
    } finally { setSavingPlaylist(false); }
  }, [draft, draftName, savingPlaylist]);

  const undoPlan = useCallback((): void => {
    if (!inputsRef.current.onUndoPlan()) {
      setStatus('The queue has changed since that set, so I left it as it is.');
      setUndoable(0);
      return;
    }
    setUndoable(0);
    setStatus('Put your queue back the way it was.');
    setEmotion('idle');
  }, []);

  const skipAndTeach = useCallback((): void => {
    const { currentSong, onSkip } = inputsRef.current;
    if (currentSong) setSkipped((items) => [currentSong, ...items.filter((item) => item.id !== currentSong.id)].slice(0, 8));
    setEmotion('curious');
    onSkip();
  }, []);

  const removeFromDraft = useCallback((songId: string): void => {
    setDraft((items) => items.filter((item) => item.song.id !== songId));
  }, []);

  const startPlan = useCallback((planned: DjTurnResponse, fromId?: string): void => {
    inputsRef.current.onStartPlan(planned, fromId);
    setUndoable(0);
    // The set is going: the DJ's own words replace "ready when you are".
    setStatus(planned.reply);
    setEmotion('happy');
  }, []);
  const reorderTurn = useCallback((ids: readonly string[]): void => {
    setTurn((current) => current ? { ...current, queue: orderByIds(current.queue, ids, (item) => item.song.id) } : current);
  }, []);
  const removeFromTurn = useCallback((id: string): void => {
    setTurn((current) => current ? { ...current, queue: current.queue.filter((item) => item.song.id !== id) } : current);
  }, []);
  const reorderDraft = useCallback((ids: readonly string[]): void => {
    setDraft((items) => orderByIds(items, ids, (item) => item.song.id));
  }, []);
  const setEnergy = useCallback((energy: number): void => setSession((current) => sessionWithEnergy(current, energy)), []);
  const removeConstraint = useCallback((constraint: string): void => setSession((current) => sessionWithoutConstraint(current, constraint)), []);
  const clearLanguage = useCallback((): void => setSession((current) => sessionWithoutLanguage(current)), []);
  const avoidArtist = useCallback((artist: string): void => {
    const name = leadArtist(artist);
    setExcludeArtists((current) => withExcludedArtists(current, [name]));
    setStatus(`Got it. No more ${name} this session.`);
  }, []);
  const allowArtist = useCallback((name: string): void => setExcludeArtists((current) => current.filter((item) => item !== name)), []);
  const reorder = useCallback((ids: readonly string[]): boolean => inputsRef.current.onReorder(ids), []);
  const removePick = useCallback((id: string): boolean => inputsRef.current.onRemove(id), []);
  const playFrom = useCallback((song: UnifiedSong, list: readonly UnifiedSong[]): boolean => inputsRef.current.onPlayFrom(song, list), []);

  const { nextSongs } = inputs;
  return useMemo<DjSession>(() => ({
    provider, model, endpoint, setEndpoint, apiKey, settingsOpen, session, goal, songLimit, draft, draftName, savingPlaylist, history, skipped,
    turn, reasons, working, status, emotion, nextSongs, undoable, undoPlan, offers, cancel, notePick,
    send, submitPrompt, savePlaylist, skipAndTeach, removeFromDraft, startPlan, reorder, removePick, playFrom,
    reorderTurn, removeFromTurn, reorderDraft, setEnergy, removeConstraint, clearLanguage,
    excludeArtists, avoidArtist, allowArtist, exploration, setExploration, shape, setShape,
    setStatus, setEmotion, setGoal, setSongLimit, setDraftName, setProvider, setModel, setApiKey, setSettingsOpen
  }), [
    provider, model, endpoint, setEndpoint, apiKey, settingsOpen, session, goal, songLimit, draft, draftName, savingPlaylist, history, skipped,
    turn, reasons, working, status, emotion, nextSongs, undoable, undoPlan, offers, cancel, notePick,
    send, submitPrompt, savePlaylist, skipAndTeach, removeFromDraft, startPlan, reorder, removePick, playFrom,
    reorderTurn, removeFromTurn, reorderDraft, setEnergy, removeConstraint, clearLanguage,
    excludeArtists, avoidArtist, allowArtist, exploration, shape,
    setProvider, setModel
  ]);
}
