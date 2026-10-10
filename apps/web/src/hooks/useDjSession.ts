import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { parseDjSlashCommand } from '@shared/dj';
import type { DjCloudProvider, DjGoal, DjProvider, DjSessionState, DjTrackContext, DjTurnRequest, DjTurnResponse } from '@shared/dj';
import type { UnifiedSong } from '@shared/types';

import { requestDjTurn } from '../lib/api';
import { parseDjAction, type DjAction, type DjActionResult } from '../lib/djActions';
import { requestLocalDjTurn } from '../lib/djLocal';
import {
  applySlashCommand,
  defaultModelFor,
  orderByIds,
  readDjMemory,
  readDjProviderChoice,
  sessionWithEnergy,
  sessionWithoutConstraint,
  sessionWithoutLanguage,
  writeDjMemory,
  writeDjProviderChoice,
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
  readonly onApplyPlan: (turn: DjTurnResponse) => boolean;
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
}

export interface DjSession {
  readonly provider: DjProvider;
  readonly model: string;
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
  readonly offer: DjOffer | null;
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
  readonly playFrom: (song: UnifiedSong, list: readonly UnifiedSong[]) => boolean;
  readonly setStatus: (status: string) => void;
  readonly setEmotion: (emotion: DjEmotion | ((current: DjEmotion) => DjEmotion)) => void;
  readonly setGoal: (goal: DjGoal) => void;
  readonly setSongLimit: (songLimit: number) => void;
  readonly setDraftName: (name: string) => void;
  readonly setProvider: (provider: DjProvider) => void;
  readonly setModel: (model: string) => void;
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
  const [undoable, setUndoable] = useState(0);
  const [offer, setOffer] = useState<DjOffer | null>(null);
  const [working, setWorking] = useState(false);
  const [emotion, setEmotion] = useState<DjEmotion>('idle');
  const [status, setStatus] = useState('');
  const { provider, model } = choice;

  const setProvider = useCallback((next: DjProvider): void => {
    const nextChoice = { provider: next, model: defaultModelFor(next) };
    setChoice(nextChoice);
    const storage = browserStorage();
    if (storage) writeDjProviderChoice(storage, nextChoice);
  }, []);

  const setModel = useCallback((next: string): void => {
    const nextChoice = { provider, model: next };
    setChoice(nextChoice);
    const storage = browserStorage();
    if (storage) writeDjProviderChoice(storage, nextChoice);
  }, [provider]);

  // The conversation survives a reload of this tab. Reasons are trimmed to the newest few dozen.
  useEffect(() => {
    const storage = sessionStore();
    if (!storage) return;
    const recentReasons = Object.fromEntries(Object.entries(reasons).slice(-60));
    writeDjMemory(storage, { session, history, goal, songLimit, draft, draftName, reasons: recentReasons });
  }, [draft, draftName, goal, history, reasons, session, songLimit]);

  useEffect(() => {
    if (emotion !== 'curious') return undefined;
    const timer = window.setTimeout(() => setEmotion(current => current === 'curious' ? 'idle' : current), 1100);
    return () => window.clearTimeout(timer);
  }, [emotion]);

  const send = useCallback(async (message: string, options?: DjSendOptions): Promise<boolean> => {
    const text = message.trim();
    if (!text || working) return false;
    const { currentSong, isRemote, recent, likedSongs, nextSongs, onApplyPlan } = inputsRef.current;
    const selectedGoal = options?.goal ?? goal;
    const selectedSongLimit = options?.songLimit ?? songLimit;
    if (provider !== 'local' && !apiKey.trim()) {
      setSettingsOpen(true);
      setStatus('Add your AI key to start a DJ conversation.');
      return false;
    }
    if (provider !== 'local' && !model.trim()) {
      setSettingsOpen(true);
      setStatus('Choose a model that supports tool calling.');
      return false;
    }
    setWorking(true);
    setUndoable(0);
    setOffer(null);
    setEmotion('thinking');
    setStatus('Reading your set and looking through the catalog…');
    try {
      const common = {
        goal: selectedGoal,
        songLimit: selectedGoal === 'mix' ? Math.min(selectedSongLimit, 8) : selectedSongLimit,
        message: text,
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
      setHistory((items) => [...items, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: result.reply }].slice(-8));
      if (result.queue.length > 0) {
        setReasons((current) => ({ ...current, ...Object.fromEntries(result.queue.map((item) => [item.song.id, item.reason])) }));
      }
      inputsRef.current.onReply?.(result.reply);
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
          if (result.operation === 'replace_upcoming') setUndoable(result.queue.length);
          setStatus(result.reply);
          setEmotion(result.reaction === 'excited' || result.reaction === 'dreamy' ? 'happy' : 'idle');
        } else {
          setStatus(isRemote ? 'Your set is ready. Switch playback to this device to use it.' : DJ_READY_STATUS);
          setEmotion('happy');
        }
      } else {
        setStatus(result.reply);
        setEmotion(result.reaction === 'confused' ? 'error' : 'idle');
      }
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The DJ could not finish that request. Try again.');
      setEmotion('error');
      return false;
    } finally {
      setWorking(false);
    }
  }, [apiKey, draft, draftName, goal, history, model, provider, session, skipped, songLimit, working]);

  /** Carries out an app request on the spot, and keeps it in the conversation so the model knows. */
  const act = useCallback(async (value: string, action: DjAction): Promise<boolean> => {
    setWorking(true);
    setUndoable(0);
    setOffer(null);
    setEmotion('thinking');
    try {
      const result = await inputsRef.current.onAction(action);
      setStatus(result.reply);
      inputsRef.current.onReply?.(result.reply);
      setEmotion(result.ok ? 'happy' : 'error');
      setHistory((items) => [...items, { role: 'user' as const, content: value }, { role: 'assistant' as const, content: result.reply }].slice(-8));
      if (result.ok && (action.kind === 'play-song' || action.kind === 'now-playing')) {
        setOffer({ label: 'Line up more like this', prompt: 'More songs like this one next' });
      }
      return result.ok;
    } finally {
      setWorking(false);
    }
  }, []);

  const submitPrompt = useCallback(async (raw: string, options?: { readonly goal?: DjGoal }): Promise<{ readonly clear: boolean; readonly prefill?: string }> => {
    const value = raw.trim();
    if (!value || working) return { clear: false };
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
  }, [act, goal, send, songLimit, working]);

  const notePick = useCallback((song: UnifiedSong): void => {
    setUndoable(0);
    setStatus(`“${song.title}”, nice pick. Want me to line up more like it after this?`);
    setOffer({ label: 'Yes, more like this', prompt: `More songs like ${song.title} by ${song.artist} next` });
    setEmotion('happy');
  }, []);

  const savePlaylist = useCallback(async (): Promise<void> => {
    if (draft.length === 0 || savingPlaylist) return;
    const { playlists } = inputsRef.current;
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
  }, [draft, draftName, savingPlaylist]);

  const undoPlan = useCallback((): void => {
    if (!inputsRef.current.onUndoPlan()) {
      setStatus('That set has already moved on, so there is nothing to put back.');
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
  const reorder = useCallback((ids: readonly string[]): boolean => inputsRef.current.onReorder(ids), []);
  const removePick = useCallback((id: string): boolean => inputsRef.current.onRemove(id), []);
  const playFrom = useCallback((song: UnifiedSong, list: readonly UnifiedSong[]): boolean => inputsRef.current.onPlayFrom(song, list), []);

  const { nextSongs } = inputs;
  return useMemo<DjSession>(() => ({
    provider, model, apiKey, settingsOpen, session, goal, songLimit, draft, draftName, savingPlaylist, history, skipped,
    turn, reasons, working, status, emotion, nextSongs, undoable, undoPlan, offer, notePick,
    send, submitPrompt, savePlaylist, skipAndTeach, removeFromDraft, startPlan, reorder, removePick, playFrom,
    reorderTurn, removeFromTurn, reorderDraft, setEnergy, removeConstraint, clearLanguage,
    setStatus, setEmotion, setGoal, setSongLimit, setDraftName, setProvider, setModel, setApiKey, setSettingsOpen
  }), [
    provider, model, apiKey, settingsOpen, session, goal, songLimit, draft, draftName, savingPlaylist, history, skipped,
    turn, reasons, working, status, emotion, nextSongs, undoable, undoPlan, offer, notePick,
    send, submitPrompt, savePlaylist, skipAndTeach, removeFromDraft, startPlan, reorder, removePick, playFrom,
    reorderTurn, removeFromTurn, reorderDraft, setEnergy, removeConstraint, clearLanguage,
    setProvider, setModel
  ]);
}
