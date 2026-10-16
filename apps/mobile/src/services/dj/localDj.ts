import type { DjGoal, DjLocalIntent, DjSessionState, DjTrackContext, DjTurnResponse } from '@shared/dj';
import type { DjLocalPick } from '@shared/djLocal';
import { applyDjLocalSession, resolveDjLocalIntent, rankDjLocalCandidates } from '@shared/djLocal';
import * as FileSystem from 'expo-file-system/legacy';

import { searchDjCatalog } from './djApi';

const MODEL_URL = 'https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q4_K_M.gguf';
const MODEL_FILENAME = 'allegra-qwen3-0.6b-q4-k-m.gguf';
const MODEL_MIN_BYTES = 400_000_000;

interface ModelProgress {
  readonly totalBytesWritten: number;
  readonly totalBytesExpectedToWrite: number;
}

interface LlamaContext {
  completion(options: {
    readonly messages: readonly { readonly role: 'system' | 'user'; readonly content: string }[];
    readonly n_predict: number;
    readonly temperature: number;
    readonly top_p: number;
    readonly chat_template_kwargs: { readonly enable_thinking: false };
  }): Promise<{ readonly text: string }>;
}

type LlamaInitializer = (options: { readonly model: string; readonly n_ctx: number; readonly n_gpu_layers: number }) => Promise<LlamaContext>;

let modelContext: LlamaContext | null = null;
let modelContextPromise: Promise<LlamaContext> | null = null;

function modelUri(): string {
  if (!FileSystem.documentDirectory) throw new Error('This device cannot store the local DJ model.');
  return `${FileSystem.documentDirectory}models/${MODEL_FILENAME}`;
}

export async function hasDownloadedDjModel(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(modelUri());
    return info.exists && typeof info.size === 'number' && info.size >= MODEL_MIN_BYTES;
  } catch {
    return false;
  }
}

export async function prepareDjModel(onProgress: (message: string) => void): Promise<void> {
  const destination = modelUri();
  if (await hasDownloadedDjModel()) return;
  if (!FileSystem.documentDirectory) throw new Error('This device cannot store the local DJ model.');
  const directory = `${FileSystem.documentDirectory}models/`;
  const temporary = `${destination}.partial`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  await FileSystem.deleteAsync(temporary, { idempotent: true });
  onProgress('Downloading Qwen3 0.6B · about 480 MB');

  const download = FileSystem.createDownloadResumable(MODEL_URL, temporary, {}, (progress: ModelProgress) => {
    const total = progress.totalBytesExpectedToWrite;
    if (total > 0) onProgress(`Downloading local DJ · ${Math.round(progress.totalBytesWritten / total * 100)}%`);
  });
  const result = await download.downloadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(temporary, { idempotent: true });
    throw new Error('The local DJ model could not be downloaded. Check your connection and try again.');
  }
  const info = await FileSystem.getInfoAsync(temporary);
  if (!info.exists || typeof info.size !== 'number' || info.size < MODEL_MIN_BYTES) {
    await FileSystem.deleteAsync(temporary, { idempotent: true });
    throw new Error('The local DJ model download was incomplete. Try again.');
  }
  await FileSystem.moveAsync({ from: temporary, to: destination });
}

async function getModel(onProgress: (message: string) => void): Promise<LlamaContext> {
  if (modelContext) return modelContext;
  if (!modelContextPromise) {
    modelContextPromise = (async () => {
      await prepareDjModel(onProgress);
      onProgress('Loading the local DJ model…');
      const native = await import('llama.rn');
      const initLlama = native.initLlama as unknown as LlamaInitializer;
      return initLlama({ model: `file://${modelUri()}`, n_ctx: 2_048, n_gpu_layers: 0 });
    })().then((context) => {
      modelContext = context;
      return context;
    }).catch((error: unknown) => {
      modelContextPromise = null;
      throw error;
    });
  }
  return modelContextPromise;
}

function intentPrompt(input: {
  readonly goal: DjGoal;
  readonly songLimit: number;
  readonly message: string;
  readonly history: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[];
  readonly session: DjSessionState;
  readonly current: DjTrackContext | null;
  readonly queue: readonly DjTrackContext[];
  readonly recent: readonly DjTrackContext[];
  readonly liked: readonly DjTrackContext[];
  readonly skipped: readonly DjTrackContext[];
  readonly draft: readonly DjLocalPick[];
  readonly draftName: string;
}): string {
  return JSON.stringify({
    request: input.message,
    recentConversation: input.history.slice(-6),
    goal: input.goal,
    songLimit: input.songLimit,
    session: input.session,
    currentTrack: input.current,
    upcomingQueue: input.queue.slice(0, 8),
    recentListening: input.recent.slice(0, 8),
    likedSongs: input.liked.slice(0, 8),
    skippedSongs: input.skipped.slice(0, 8),
    playlistDraft: input.draft.map(({ song }) => ({ id: song.id, title: song.title, artist: song.artist })),
    playlistName: input.draftName,
    instruction: 'Return exactly one JSON object with reply, vibe, energy (1..5), operation (replace_upcoming|insert|keep), insertAfter (0..7 only for insert, otherwise null), languageAction (keep|set|clear), language, addConstraints, removeConstraints, searchQueries (0..4 short catalog queries), strategy (replace|extend), removeTrackIds (only exact IDs from playlistDraft), playlistName, reaction (neutral|curious|excited|dreamy|confused). Do not invent tracks or catalog IDs. Preserve taste constraints unless clearly changed. For playlist goal, operation must be keep, preserve the draft unless asked to replace, append, or remove, default to extend when a draft exists, and return only exact IDs for removals. Do not claim anything is saved or played. No markdown or explanation outside JSON.'
  });
}

function generatedContent(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function draftOperation(intent: DjLocalIntent, goal: DjGoal): DjTurnResponse['draftOperation'] {
  if (goal !== 'playlist') return 'keep';
  if (intent.strategy === 'replace') return 'replace';
  if (intent.removeTrackIds.length > 0 && intent.searchQueries.length === 0) return 'remove';
  if (intent.searchQueries.length === 0) return 'keep';
  return 'extend';
}

export async function requestLocalDjTurn(input: {
  readonly goal: DjGoal;
  readonly songLimit: number;
  readonly message: string;
  readonly history: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[];
  readonly session: DjSessionState;
  readonly current: DjTrackContext | null;
  readonly queue: readonly DjTrackContext[];
  readonly recent: readonly DjTrackContext[];
  readonly liked: readonly DjTrackContext[];
  readonly skipped: readonly DjTrackContext[];
  readonly draft: readonly DjLocalPick[];
  readonly draftName: string;
  readonly onProgress: (message: string) => void;
  readonly signal?: AbortSignal;
}): Promise<DjTurnResponse> {
  let modelText = '';
  try {
    input.onProgress('Preparing your on-device DJ…');
    const context = await getModel(input.onProgress);
    const result = await context.completion({
      messages: [
        { role: 'system', content: 'You interpret small Allegra DJ requests into a bounded JSON plan. Return JSON only. Do not explain your reasoning.' },
        { role: 'user', content: intentPrompt(input) }
      ],
      n_predict: 512,
      temperature: 0.1,
      top_p: 0.9,
      chat_template_kwargs: { enable_thinking: false }
    });
    modelText = generatedContent(result.text);
  } catch {
    // The model could not load or run on this phone; the request itself still drives a real catalog search.
    if (input.signal?.aborted) throw new Error('The request was cancelled.');
  }
  const intent = resolveDjLocalIntent(modelText, input);

  input.onProgress('Searching Allegra’s catalog…');
  const queries = intent.searchQueries.slice(0, 4);
  const searchResults = await Promise.all(queries.map(async (query, queryIndex) => {
    try {
      const songs = await searchDjCatalog(query, input.signal);
      return songs.map((song) => ({ song, queryIndex }));
    } catch {
      return [];
    }
  }));
  if (input.signal?.aborted) throw new Error('The request was cancelled.');

  const session = applyDjLocalSession(intent, input.session);
  const ranked = rankDjLocalCandidates({
    candidates: searchResults.flat(),
    queries,
    goal: input.goal,
    songLimit: input.songLimit,
    language: session.language,
    current: input.current,
    recent: input.recent,
    liked: input.liked,
    skipped: input.skipped,
    draft: input.draft,
    strategy: intent.strategy,
    removeTrackIds: intent.removeTrackIds
  });
  const existingIds = new Set(input.draft.map(({ song }) => song.id));
  const queue = input.goal === 'playlist' && intent.strategy === 'extend'
    ? ranked.filter(({ song }) => !existingIds.has(song.id))
    : ranked;

  return {
    reply: intent.reply,
    session,
    goal: input.goal,
    playlistName: input.goal === 'playlist' ? intent.playlistName || input.draftName || session.vibe || 'A little mix' : null,
    operation: input.goal === 'playlist' ? 'keep' : intent.operation,
    insertAfter: input.goal === 'playlist' || intent.operation !== 'insert' ? null : intent.insertAfter,
    draftOperation: draftOperation(intent, input.goal),
    removeTrackIds: input.goal === 'playlist' ? intent.removeTrackIds : [],
    reaction: intent.reaction,
    queue
  };
}
