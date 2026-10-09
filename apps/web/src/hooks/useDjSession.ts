import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { parseDjSlashCommand } from '@shared/dj';
import type { DjCloudProvider, DjGoal, DjProvider, DjSessionState, DjTrackContext, DjTurnRequest, DjTurnResponse } from '@shared/dj';
import type { UnifiedSong } from '@shared/types';

import { requestDjTurn } from '../lib/api';
import { requestLocalDjTurn } from '../lib/djLocal';
import {
  applySlashCommand,
  defaultModelFor,
  readDjProviderChoice,
  writeDjProviderChoice,
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
  readonly onStartPlan: (turn: DjTurnResponse, fromId?: string) => void;
  readonly onReorder: (ids: readonly string[]) => boolean;
  readonly onRemove: (id: string) => boolean;
  readonly onPlayFrom: (song: UnifiedSong, list: readonly UnifiedSong[]) => boolean;
  readonly onSkip: () => void;
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
  /** Sends one message. Resolves true only when the turn completed (the prompt can be cleared). */
  readonly send: (message: string, options?: DjSendOptions) => Promise<boolean>;
  readonly submitPrompt: (value: string) => Promise<{ readonly clear: boolean; readonly prefill?: string }>;
  readonly savePlaylist: () => Promise<void>;
  readonly skipAndTeach: () => void;
  readonly removeFromDraft: (songId: string) => void;
  readonly startPlan: (turn: DjTurnResponse, fromId?: string) => void;
  readonly reorder: (ids: readonly string[]) => boolean;
  readonly removePick: (id: string) => boolean;
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
 * conversation survives leaving /dj. Only provider and model are stored; the API key lives in memory.
 */
export function useDjSessionState(inputs: DjSessionInputs): DjSession {
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const [choice, setChoice] = useState<DjProviderChoice>(initialChoice);
  const [apiKey, setApiKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [session, setSession] = useState<DjSessionState>(EMPTY_SESSION);
  const [goal, setGoal] = useState<DjGoal>('mix');
  const [songLimit, setSongLimit] = useState(8);
  const [draft, setDraft] = useState<readonly DjPick[]>([]);
  const [draftName, setDraftName] = useState('A little mix');
  const [savingPlaylist, setSavingPlaylist] = useState(false);
  const [history, setHistory] = useState<DjTurnRequest['history'][number][]>([]);
  const [skipped, setSkipped] = useState<UnifiedSong[]>([]);
  const [turn, setTurn] = useState<DjTurnResponse | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
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
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The DJ could not finish that request. Try again.');
      setEmotion('error');
      return false;
    } finally {
      setWorking(false);
    }
  }, [apiKey, draft, draftName, goal, history, model, provider, session, skipped, songLimit, working]);

  const submitPrompt = useCallback(async (raw: string): Promise<{ readonly clear: boolean; readonly prefill?: string }> => {
    const value = raw.trim();
    const parsed = parseDjSlashCommand(value);
    if (!parsed) {
      if (value.startsWith('/')) {
        setStatus('Unknown shortcut. Type / to see the DJ commands.');
        return { clear: false };
      }
      return { clear: await send(value) };
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
  }, [goal, send, songLimit]);

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

  const skipAndTeach = useCallback((): void => {
    const { currentSong, onSkip } = inputsRef.current;
    if (currentSong) setSkipped((items) => [currentSong, ...items.filter((item) => item.id !== currentSong.id)].slice(0, 8));
    setEmotion('curious');
    onSkip();
  }, []);

  const removeFromDraft = useCallback((songId: string): void => {
    setDraft((items) => items.filter((item) => item.song.id !== songId));
  }, []);

  const startPlan = useCallback((planned: DjTurnResponse, fromId?: string): void => inputsRef.current.onStartPlan(planned, fromId), []);
  const reorder = useCallback((ids: readonly string[]): boolean => inputsRef.current.onReorder(ids), []);
  const removePick = useCallback((id: string): boolean => inputsRef.current.onRemove(id), []);
  const playFrom = useCallback((song: UnifiedSong, list: readonly UnifiedSong[]): boolean => inputsRef.current.onPlayFrom(song, list), []);

  const { nextSongs } = inputs;
  return useMemo<DjSession>(() => ({
    provider, model, apiKey, settingsOpen, session, goal, songLimit, draft, draftName, savingPlaylist, history, skipped,
    turn, reasons, working, status, emotion, nextSongs,
    send, submitPrompt, savePlaylist, skipAndTeach, removeFromDraft, startPlan, reorder, removePick, playFrom,
    setStatus, setEmotion, setGoal, setSongLimit, setDraftName, setProvider, setModel, setApiKey, setSettingsOpen
  }), [
    provider, model, apiKey, settingsOpen, session, goal, songLimit, draft, draftName, savingPlaylist, history, skipped,
    turn, reasons, working, status, emotion, nextSongs,
    send, submitPrompt, savePlaylist, skipAndTeach, removeFromDraft, startPlan, reorder, removePick, playFrom,
    setProvider, setModel
  ]);
}
