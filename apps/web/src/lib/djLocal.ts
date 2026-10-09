import type { DjGoal, DjLocalIntent, DjSessionState, DjTrackContext, DjTurnResponse } from '@shared/dj';
import type { DjLocalPick } from '@shared/djLocal';
import { applyDjLocalSession, resolveDjLocalIntent, rankDjLocalCandidates } from '@shared/djLocal';

import { searchSongs } from './api';

const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX';

type ChatMessage = { readonly role: 'system' | 'user'; readonly content: string };
type GeneratedText = string | readonly { readonly role?: string; readonly content?: string }[];
type Generator = (messages: readonly ChatMessage[], options: { readonly max_new_tokens: number; readonly do_sample: false }) => Promise<readonly { readonly generated_text?: GeneratedText }[]>;
type ModelProgress = { readonly status?: string; readonly progress?: number; readonly file?: string };
type PipelineOptions = { readonly device: 'webgpu' | 'wasm'; readonly dtype: 'q4f16' | 'q4'; readonly progress_callback: (event: ModelProgress) => void };

let generatorPromise: Promise<Generator> | null = null;

async function getGenerator(onProgress: (message: string) => void): Promise<Generator> {
  if (!generatorPromise) {
    generatorPromise = (async () => {
      const { env, pipeline } = await import('@huggingface/transformers');
      env.useBrowserCache = true;
      const hasWebGpu = Boolean((navigator as Navigator & { readonly gpu?: unknown }).gpu);
      const options: PipelineOptions = {
        device: hasWebGpu ? 'webgpu' : 'wasm',
        dtype: hasWebGpu ? 'q4f16' : 'q4',
        progress_callback: (event) => {
          if (event.status === 'progress' && typeof event.progress === 'number') {
            onProgress(`Downloading the local DJ model · ${Math.round(event.progress)}%`);
          } else if (event.status === 'initiate' || event.status === 'download') {
            onProgress('Downloading the local DJ model…');
          }
        }
      };
      const load = async (pipelineOptions: PipelineOptions): Promise<Generator> =>
        await pipeline('text-generation', MODEL_ID, pipelineOptions) as unknown as Generator;
      try {
        return await load(options);
      } catch (error) {
        if (!hasWebGpu) throw error;
        onProgress('Using the compatible local runtime…');
        return load({ ...options, device: 'wasm', dtype: 'q4' });
      }
    })().catch((error: unknown) => {
      generatorPromise = null;
      throw error;
    });
  }
  return generatorPromise;
}

function promptForIntent(input: {
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
    task: 'Interpret a request for Allegra music recommendations. Return exactly one JSON object and no markdown.',
    userMessage: input.message,
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
    instructions: [
      'Return keys: reply, vibe, energy, operation, insertAfter, languageAction, language, addConstraints, removeConstraints, searchQueries, strategy, removeTrackIds, playlistName, reaction.',
      'operation is replace_upcoming, insert, or keep. insertAfter is 0 through 7 only for insert, otherwise null.',
      'Use 1 to 4 concise catalog search queries when songs are needed. Never output song IDs for new recommendations.',
      'strategy is replace or extend. For playlist removals, return only exact IDs from playlistDraft in removeTrackIds. Keep a draft song unless the user clearly asks to remove it.',
      'For a playlist, default to extend when a draft already exists; choose replace only when the user asks for a fresh/new playlist or to replace the whole draft.',
      'Retain existing language and constraints unless the user clearly changes them. Do not invent BPM, genre, mood, instrumentation, or other track facts.',
      'Use a short reply in the user’s language. Do not claim a playlist was saved or a queue was applied.',
      'For playlist goal, do not change playback; operation must be keep. Keep a short useful playlist name.'
    ]
  });
}

function generatedContent(value: GeneratedText | undefined): string {
  if (typeof value === 'string') return value;
  const last = value?.[value.length - 1];
  return typeof last?.content === 'string' ? last.content : '';
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
    input.onProgress('Loading Allegra’s on-device DJ…');
    const generator = await getGenerator(input.onProgress);
    input.onProgress('Reading your taste and shaping catalog searches…');
    const output = await generator([
      { role: 'system', content: 'You are a small local intent parser for a music DJ. Follow the JSON schema in the user message exactly. Reply with the JSON object only. /no_think' },
      { role: 'user', content: promptForIntent(input) }
    ], { max_new_tokens: 512, do_sample: false });
    modelText = generatedContent(output[0]?.generated_text);
  } catch {
    // The model could not load or run on this device; the request itself still drives a real catalog search.
    if (input.signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
    input.onProgress('Searching the catalog from your request…');
  }
  const intent = resolveDjLocalIntent(modelText, input);

  const queries = intent.searchQueries.slice(0, 4);
  const searchResults = await Promise.all(queries.map(async (query, queryIndex) => {
    try {
      const result = await searchSongs(query, input.signal);
      return result.results.map((song) => ({ song, queryIndex }));
    } catch {
      return [];
    }
  }));
  if (input.signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');

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
    removeTrackIds: intent.removeTrackIds,
    reaction: intent.reaction,
    queue
  };
}
