import { Router } from 'express';

import type { CatalogService } from '../catalog/catalog.js';
import type { UnifiedSong } from '../types.js';
import { createLogger } from '../lib/logger.js';
import { asRecord } from './common.js';

/** Shared with djVoice. Silent outside production, like the other service loggers. */
export const djLog = createLogger(process.env.NODE_ENV === 'production');

const MAX_TURN_MS = 45_000;
const MAX_MODEL_CALLS = 6;
const MAX_SEARCHES = 4;
const MAX_TOOL_CALLS_PER_RESPONSE = 4;
const MAX_CONTEXT_SONGS = 8;
const MAX_DRAFT_SONGS = 30;
const MAX_MESSAGES = 8;

type Provider = 'openai' | 'openrouter' | 'gemini';
type Goal = 'mix' | 'playlist';
type DraftOperation = 'replace' | 'extend' | 'keep' | 'remove';
type Reaction = 'neutral' | 'curious' | 'excited' | 'dreamy' | 'confused';
type Operation = 'replace_upcoming' | 'insert' | 'keep';
type ContextSong = Pick<UnifiedSong, 'id' | 'title' | 'artist'> & { language?: string };
type SessionState = { vibe: string; energy: number; language: string | null; constraints: string[] };
type Candidate = { song: UnifiedSong; reason: string };
type CatalogSearchOperation = { id: unknown; query: string } | { id: unknown; error: string };

interface DjRequest {
  readonly provider: Provider;
  readonly apiKey: string;
  readonly model: string;
  readonly goal: Goal;
  readonly songLimit: number;
  readonly message: string;
  readonly history: { readonly role: 'user' | 'assistant'; readonly content: string }[];
  readonly current: ContextSong | null;
  readonly queue: ContextSong[];
  readonly draft: ContextSong[];
  readonly draftName: string;
  readonly recent: ContextSong[];
  readonly liked: ContextSong[];
  readonly skipped: ContextSong[];
  readonly session: SessionState;
  /** Artists the listener ruled out; any committed song credited to one is dropped. */
  readonly excludeArtists: string[];
  readonly exploration: Exploration;
  readonly shape: SetShape;
}

type Exploration = 'familiar' | 'balanced' | 'discover';
type SetShape = 'steady' | 'build' | 'wind' | 'dynamic';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function djRouter(catalog: CatalogService, fetchImpl: FetchLike = fetch): Router {
  const router = Router();
  router.post('/ai/dj/turn', async (request, response) => {
    let controller: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let provider: Provider | null = null;
    let goal: Goal | null = null;
    let songs: number | null = null;
    try {
      const input = parseRequest(request.body);
      if (input) { provider = input.provider; goal = input.goal; }
      if (!input) {
        response.status(400).json({ success: false, data: null, error: 'Check the DJ request and try again.' });
        return;
      }
      controller = new AbortController();
      timeout = setTimeout(() => controller?.abort(), MAX_TURN_MS);
      const data = await runDjTurn(catalog, input, controller.signal, fetchImpl);
      songs = data.queue.length;
      response.status(200).json({ success: true, data });
    } catch (error) {
      if (controller?.signal.aborted) {
        response.status(504).json({ success: false, data: null, error: 'The DJ took too long to plan this set. Try again.' });
      } else if (error instanceof DjProviderError) {
        response.status(error.status).json({ success: false, data: null, error: error.message });
      } else if (error instanceof Error && error.message === 'catalog_unavailable') {
        response.status(502).json({ success: false, data: null, error: 'The music catalog is having a moment. Try again shortly.' });
      } else {
        response.status(502).json({ success: false, data: null, error: 'The DJ could not finish that request. Try again shortly.' });
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      // The key is request-scoped and never written to app storage or logs.
      controller = undefined;
      // Only route, provider, goal, timing, status and count. Never the key, message, history or songs' text.
      djLog.info({ route: 'dj/turn', provider, goal, ms: Date.now() - startedAt, status: response.statusCode, songs }, 'dj request');
    }
  });
  return router;
}

class DjProviderError extends Error {
  public constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'DjProviderError';
  }
}

function parseRequest(value: unknown): DjRequest | null {
  const body = asRecord(value);
  const provider = body.provider === 'openai' || body.provider === 'openrouter' || body.provider === 'gemini' ? body.provider : null;
  const apiKey = bounded(body.apiKey, 512);
  const model = bounded(body.model, 160);
  const goal = body.goal === 'mix' || body.goal === 'playlist' ? body.goal : null;
  const songLimit = numberBetween(body.songLimit, 1, 30);
  const message = bounded(body.message, 500);
  const sessionValue = asRecord(body.session);
  const history = parseHistory(body.history);
  if (!provider || !apiKey || !model || !goal || !songLimit || (goal === 'mix' && songLimit > 8) || !message || !history) return null;

  return {
    provider,
    apiKey,
    model,
    goal,
    songLimit,
    message,
    history,
    current: parseSong(body.current),
    queue: parseSongs(body.queue),
    draft: parseSongs(body.draft, MAX_DRAFT_SONGS),
    draftName: bounded(body.draftName, 100) ?? '',
    recent: parseSongs(body.recent),
    liked: parseSongs(body.liked),
    skipped: parseSongs(body.skipped),
    session: {
      vibe: bounded(sessionValue.vibe, 100) ?? '',
      energy: numberBetween(sessionValue.energy, 1, 5) ?? 3,
      language: nullableBounded(sessionValue.language, 40),
      constraints: parseStrings(sessionValue.constraints, 8, 100)
    },
    // Optional and forgiving: an old client sends none of these and gets the old behaviour.
    excludeArtists: parseStrings(body.excludeArtists, 12, 80),
    exploration: body.exploration === 'familiar' || body.exploration === 'discover' ? body.exploration : 'balanced',
    shape: body.shape === 'build' || body.shape === 'wind' || body.shape === 'dynamic' ? body.shape : 'steady'
  };
}

/** Lower case, letters and digits only: "A. R. Rahman" → "a r rahman". */
function plain(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** A song credited (as whole words) to one of the ruled-out names. */
function creditedToAny(song: Pick<UnifiedSong, 'artist'>, names: readonly string[]): boolean {
  const credit = ` ${plain(song.artist)} `;
  return names.some((name) => {
    const key = plain(name);
    return key.length > 1 && credit.includes(` ${key} `);
  });
}

function bounded(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
}

function nullableBounded(value: unknown, max: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  return bounded(value, max);
}

function numberBetween(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function parseSong(value: unknown): ContextSong | null {
  const song = asRecord(value);
  const id = bounded(song.id, 200);
  const title = bounded(song.title, 200);
  const artist = bounded(song.artist, 200);
  if (!id || /^https?:/i.test(id) || !title || !artist) return null;
  const language = bounded(song.language, 40);
  return { id, title, artist, ...(language ? { language } : {}) };
}

function parseSongs(value: unknown, maxItems = MAX_CONTEXT_SONGS): ContextSong[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).flatMap((item) => {
    const song = parseSong(item);
    return song ? [song] : [];
  });
}

function parseStrings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, maxItems).flatMap((item) => {
    const text = bounded(item, maxLength);
    return text ? [text] : [];
  }))];
}

function parseHistory(value: unknown): DjRequest['history'] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) return null;
  let totalLength = 0;
  const history: DjRequest['history'][number][] = [];
  for (const entry of value) {
    const item = asRecord(entry);
    if ((item.role !== 'user' && item.role !== 'assistant') || typeof item.content !== 'string' || item.content.length > 500) return null;
    totalLength += item.content.length;
    if (totalLength > 3_000) return null;
    history.push({ role: item.role, content: item.content });
  }
  return history;
}

async function runDjTurn(catalog: CatalogService, input: DjRequest, signal: AbortSignal, fetchImpl: FetchLike) {
  const endpoint = input.provider === 'openai'
    ? 'https://api.openai.com/v1/chat/completions'
    : input.provider === 'gemini'
      ? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: systemPrompt(input) },
    ...input.history.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: input.message }
  ];
  const candidates = new Map<string, UnifiedSong>();
  let contextRead = false;
  let searchCount = 0;

  for (let callIndex = 0; callIndex < MAX_MODEL_CALLS; callIndex += 1) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model: input.model,
        messages,
        tools: input.provider === 'gemini' ? geminiToolDefinitions : toolDefinitions,
        tool_choice: 'auto',
        temperature: 0.35,
        max_tokens: 1_800,
        // Gemini thinks by default; a DJ turn needs a quick plan, not a long chain of thought.
        ...(input.provider === 'gemini' ? { reasoning_effort: 'low' } : {})
      })
    });
    if (!response.ok) throw providerError(response.status, await errorText(response));
    const payload = asRecord(await response.json());
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const choice = asRecord(choices[0]);
    const assistant = asRecord(choice.message);
    const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    if (toolCalls.length === 0) {
      const text = typeof assistant.content === 'string' ? assistant.content.trim() : '';
      return emptyPlan(input, text || 'I could not finish shaping that set. Try again.');
    }
    messages.push({ role: 'assistant', content: typeof assistant.content === 'string' ? assistant.content : null, tool_calls: toolCalls });

    const responseToolCalls = toolCalls.slice(0, MAX_TOOL_CALLS_PER_RESPONSE);
    let toolIndex = 0;
    while (toolIndex < responseToolCalls.length) {
      const rawCall = responseToolCalls[toolIndex];
      const call = asRecord(rawCall);
      const fn = asRecord(call.function);
      const name = typeof fn.name === 'string' ? fn.name : '';

      if (name === 'search_catalog') {
        const operations: CatalogSearchOperation[] = [];
        while (toolIndex < responseToolCalls.length) {
          const searchCall = asRecord(responseToolCalls[toolIndex]);
          const searchFn = asRecord(searchCall.function);
          if (searchFn.name !== 'search_catalog') break;

          const rawSearchArgs = typeof searchFn.arguments === 'string' ? searchFn.arguments : '{}';
          let searchArgs: Record<string, unknown>;
          try { searchArgs = asRecord(JSON.parse(rawSearchArgs)); }
          catch { throw new DjProviderError(502, 'The DJ could not read its plan. Try again.'); }

          if (!contextRead) {
            operations.push({ id: searchCall.id, error: 'Read the session context before searching.' });
          } else if (searchCount >= MAX_SEARCHES) {
            operations.push({ id: searchCall.id, error: 'This turn has reached its catalog search limit.' });
          } else {
            const query = bounded(searchArgs.query, 140);
            if (!query) {
              operations.push({ id: searchCall.id, error: 'Give the catalog search a short, specific query.' });
            } else {
              searchCount += 1;
              operations.push({ id: searchCall.id, query });
            }
          }
          toolIndex += 1;
        }

        await appendCatalogSearchMessages(catalog, operations, candidates, messages, signal);
        continue;
      }

      const rawArgs = typeof fn.arguments === 'string' ? fn.arguments : '{}';
      let args: Record<string, unknown>;
      try { args = asRecord(JSON.parse(rawArgs)); }
      catch { throw new DjProviderError(502, 'The DJ could not read its plan. Try again.'); }

      if (name === 'get_session_context') {
        contextRead = true;
        messages.push(toolMessage(call.id, {
          current: input.current,
          queue: input.queue,
          goal: input.goal,
          songLimit: input.songLimit,
          draft: input.draft,
          draftName: input.draftName,
          recentlyPlayed: input.recent,
          liked: input.liked,
          skipped: input.skipped,
          session: input.session,
          excludeArtists: input.excludeArtists,
          exploration: input.exploration,
          plannedShape: input.shape
        }));
        toolIndex += 1;
        continue;
      }

      if (name === 'commit_dj_plan') {
        if (!contextRead) throw new DjProviderError(502, 'The DJ did not inspect the listening session. Try again.');
        const plan = parsePlan(args, input, candidates, input.current?.id ?? null);
        if (!plan) throw new DjProviderError(502, 'The DJ could not validate that music plan. Try another request.');
        return plan;
      }

      messages.push(toolMessage(call.id, { error: 'That tool is not available to the DJ.' }));
      toolIndex += 1;
    }
  }
  return emptyPlan(input, 'I found the direction, but could not finish validating a set. Try again.');
}

async function appendCatalogSearchMessages(
  catalog: CatalogService,
  operations: CatalogSearchOperation[],
  candidates: Map<string, UnifiedSong>,
  messages: Record<string, unknown>[],
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) throw signal.reason ?? new Error('The DJ turn was aborted.');
  const queries = [...new Set(operations.flatMap((operation) => 'query' in operation ? [operation.query] : []))];
  if (queries.length === 0) {
    for (const operation of operations) {
      if ('error' in operation) messages.push(toolMessage(operation.id, { error: operation.error }));
    }
    return;
  }

  // Promise.all preserves query order, while each independent catalog lookup runs at once.
  // Exact trimmed query strings are deduplicated; each tool call still counts against the turn cap.
  const searches = Promise.all(queries.map(async (query) => {
    try {
      return { query, result: await catalog.search(query, 14, 0, { enrich: false }), failed: false as const };
    } catch {
      return { query, failed: true as const };
    }
  }));
  const outcomes = await waitForAbort(searches, signal);
  const byQuery = new Map(outcomes.map((outcome) => [outcome.query, outcome]));

  // Merge candidates and append tool replies in the model's original call order.
  for (const operation of operations) {
    if ('error' in operation) {
      messages.push(toolMessage(operation.id, { error: operation.error }));
      continue;
    }
    const outcome = byQuery.get(operation.query);
    if (!outcome || outcome.failed) {
      messages.push(toolMessage(operation.id, { error: 'Catalog search failed. Try a broader query.' }));
      continue;
    }
    for (const song of outcome.result.results) candidates.set(song.id, song);
    messages.push(toolMessage(operation.id, {
      query: operation.query,
      results: outcome.result.results.map(({ id, title, artist, album, language, source }) => ({ id, title, artist, album, language, source }))
    }));
  }
}

function waitForAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('The DJ turn was aborted.'));

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('The DJ turn was aborted.'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([task, aborted]).finally(() => {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

function toolMessage(id: unknown, value: unknown): Record<string, unknown> {
  return { role: 'tool', tool_call_id: typeof id === 'string' ? id : '', content: JSON.stringify(value) };
}

function emptyPlan(input: DjRequest, reply: string) {
  return {
    reply: reply.slice(0, 240),
    session: input.session,
    goal: input.goal,
    playlistName: input.goal === 'playlist' ? input.draftName || input.session.vibe || 'A little mix' : null,
    draftOperation: 'keep' as const,
    removeTrackIds: [],
    operation: 'keep' as const,
    insertAfter: null,
    reaction: 'curious' as const,
    queue: []
  };
}

function parsePlan(args: Record<string, unknown>, input: DjRequest, candidates: Map<string, UnifiedSong>, currentId: string | null) {
  const old = input.session;
  const reply = bounded(args.reply, 240);
  const vibe = bounded(args.vibe, 100);
  const suggestedPlaylistName = bounded(args.playlistName, 100);
  const draftOperation = args.draftOperation;
  const removeTrackIds = parseStrings(args.removeTrackIds, MAX_DRAFT_SONGS, 200);
  const energy = numberBetween(args.energy, 1, 5);
  const languageAction = args.languageAction;
  const language = nullableBounded(args.language, 40);
  const addConstraints = parseStrings(args.addConstraints, 8, 100);
  const removeConstraints = parseStrings(args.removeConstraints, 8, 100);
  const operation = args.operation;
  const reaction = args.reaction;
  const insertAfter = args.insertAfter === null ? null : numberBetween(args.insertAfter, 0, 7);
  if (!reply || !vibe || !energy || !['keep', 'set', 'clear'].includes(String(languageAction))
    || (languageAction === 'set' && !language) || (languageAction !== 'set' && language !== null)
    || !['replace_upcoming', 'insert', 'keep'].includes(String(operation))
    || !['neutral', 'curious', 'excited', 'dreamy', 'confused'].includes(String(reaction))) return null;
  if (operation === 'insert' && insertAfter === null) return null;
  if (input.goal === 'playlist' && operation !== 'keep') return null;
  if (input.goal === 'playlist' && !['replace', 'extend', 'keep', 'remove'].includes(String(draftOperation))) return null;
  if (input.goal === 'mix' && (draftOperation !== 'keep' || removeTrackIds.length > 0)) return null;
  const draftIds = new Set(input.draft.map(({ id }) => id));
  if (removeTrackIds.some((id) => !draftIds.has(id))) return null;

  const rawSongs = Array.isArray(args.songs) ? args.songs : [];
  const maxSongs = input.goal === 'playlist' ? input.songLimit : Math.min(input.songLimit, 8);
  if (rawSongs.length > maxSongs || (input.goal === 'mix' && operation !== 'keep' && rawSongs.length === 0)) return null;
  const used = new Set<string>();
  const queue: Candidate[] = [];
  for (const rawSong of rawSongs) {
    const item = asRecord(rawSong);
    const id = bounded(item.id, 200);
    const reason = bounded(item.reason, 160);
    const song = id ? candidates.get(id) : undefined;
    if (!id || !reason || !song || id === currentId || used.has(id)) return null;
    used.add(id);
    // Hard filters the model cannot talk its way past: a ruled-out artist or a song with no stream.
    if (!song.streamUrl || creditedToAny(song, input.excludeArtists)) continue;
    queue.push({ song, reason });
  }
  // Everything it picked was filtered out: change nothing rather than claim a set that isn't there.
  const nothingLeft = rawSongs.length > 0 && queue.length === 0;

  const removed = new Set(removeConstraints.map((item) => item.toLocaleLowerCase()));
  const constraints = [...new Set([
    ...old.constraints.filter((item) => !removed.has(item.toLocaleLowerCase())),
    ...addConstraints
  ])].slice(0, 8);
  const nextSession: SessionState = {
    vibe,
    energy,
    language: languageAction === 'set' ? language : languageAction === 'clear' ? null : old.language,
    constraints
  };
  return {
    reply: nothingLeft ? 'None of those picks could play here, so I left things as they were. Try it another way?' : reply,
    session: nextSession,
    goal: input.goal,
    playlistName: input.goal === 'playlist' ? suggestedPlaylistName || input.draftName || vibe : null,
    draftOperation: input.goal === 'playlist' && !nothingLeft ? draftOperation as DraftOperation : 'keep',
    removeTrackIds: nothingLeft ? [] : removeTrackIds,
    operation: nothingLeft ? 'keep' as const : operation as Operation,
    insertAfter: operation === 'insert' && !nothingLeft ? insertAfter : null,
    reaction: reaction as Reaction,
    queue
  };
}

async function errorText(response: Response): Promise<string> {
  try { return (await response.text()).slice(0, 2_000); }
  catch { return ''; }
}

function providerError(status: number, body = ''): DjProviderError {
  // Gemini answers a bad key with 400 INVALID_ARGUMENT rather than 401.
  if (status === 400 && /API_KEY_INVALID|API key not valid|API key expired/i.test(body)) {
    return new DjProviderError(401, 'That provider did not accept this key. Check the key and try again.');
  }
  if (status === 401 || status === 403) return new DjProviderError(401, 'That provider did not accept this key. Check the key and try again.');
  if (status === 429) return new DjProviderError(429, 'The AI provider is at its request limit. Wait a moment and try again.');
  if (status === 400 || status === 404) return new DjProviderError(400, 'That model could not use the DJ tools. Check the model name and try again.');
  return new DjProviderError(502, 'The AI provider could not finish this DJ turn. Try again shortly.');
}

function systemPrompt(input: DjRequest): string {
  const { session } = input;
  return [
    'You are Allegra DJ, a music companion. You may only inspect the supplied session with get_session_context, find real songs with search_catalog, and return a validated plan with commit_dj_plan.',
    'Always call get_session_context before searching or planning. Search the playable catalog before proposing any song. Never invent songs or IDs, and only choose IDs returned by search_catalog.',
    'Preserve the current song. Replace or insert only upcoming tracks. Never play, pause, skip, seek, or change volume. Do not save preferences beyond this DJ session.',
    'Carry forward session vibe, language, and constraints. Only remove a constraint or clear a language when the user explicitly asks. Treat recent listens and likes as taste signals; treat early skips as a signal to diversify away from that track/artist.',
    'Use catalog facts only. Do not claim BPM, genre, mood, instrumentation, or audio features unless present in the returned catalog data. Give short, concrete reasons tied to the request, known language, artist/title, or listening context.',
    'For an explanation-only request, use operation keep and an empty songs array. For “play this after N songs,” use operation insert and insertAfter=N. For “keep this song, change the rest,” use replace_upcoming; the current song is preserved by the player.',
    input.goal === 'playlist'
      ? `This is an editable playlist draft, not a playback queue. Keep operation=keep. Return at most ${input.songLimit} newly searched songs. Set draftOperation=replace for a fresh draft, extend to add new songs while preserving the draft, remove to remove only existing draft items, and keep for a title-only or explanation change. For removals, use only exact IDs from get_session_context.draft in removeTrackIds. Preserve the title unless the user asks to rename it. Give reasons based only on the catalog and supplied taste context.`
      : `This is a live mix. Return at most ${input.songLimit} songs for the upcoming queue.`,
    'Never pick a song credited to an artist in excludeArtists; those songs are dropped after you commit. Avoid the same artist twice in a row unless the user asked for one artist only, and then keep to that artist.',
    `Exploration is ${input.exploration}: familiar leans on liked and recent artists, discover prefers artists the listener has not played or liked, balanced mixes both.`,
    input.shape === 'steady'
      ? 'Keep the set at a steady energy.'
      : `The listener planned the set's shape as ${input.shape === 'build' ? 'building up (calmer first, livelier last)' : input.shape === 'wind' ? 'winding down (livelier first, calmer last)' : 'dynamic (alternate calmer and livelier)'}. Order songs by that plan from catalog facts and the searches that found them; never claim measured energy.`,
    'Return a warm, concise reply in the user’s language. Never claim an action succeeded before it is applied by the player.',
    `Current task and session: ${JSON.stringify({ goal: input.goal, songLimit: input.songLimit, draftName: input.draftName, draft: input.draft, session, excludeArtists: input.excludeArtists, exploration: input.exploration, plannedShape: input.shape })}`
  ].join('\n');
}

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_session_context',
      description: 'Read the current song, upcoming queue, recent plays, likes, skips, and current DJ vibe constraints. Must be called before any search.',
      strict: true,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_catalog',
      description: 'Search Allegra’s playable real music catalog. Use this to find every track you plan to recommend.',
      strict: true,
      parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 140 } }, required: ['query'], additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'commit_dj_plan',
      description: 'Return a validated intent and queue proposal after inspecting session context and searching the catalog. This tool never starts playback.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          reply: { type: 'string', minLength: 1, maxLength: 240 },
          vibe: { type: 'string', minLength: 1, maxLength: 100 },
          energy: { type: 'integer', minimum: 1, maximum: 5 },
          languageAction: { type: 'string', enum: ['keep', 'set', 'clear'] },
          language: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
          addConstraints: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 100 } },
          removeConstraints: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 100 } },
          operation: { type: 'string', enum: ['replace_upcoming', 'insert', 'keep'] },
          insertAfter: { anyOf: [{ type: 'integer', minimum: 0, maximum: 7 }, { type: 'null' }] },
          draftOperation: { type: 'string', enum: ['replace', 'extend', 'keep', 'remove'] },
          removeTrackIds: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 200 } },
          reaction: { type: 'string', enum: ['neutral', 'curious', 'excited', 'dreamy', 'confused'] },
          songs: {
            type: 'array', maxItems: 30,
            items: {
              type: 'object',
              properties: { id: { type: 'string', maxLength: 200 }, reason: { type: 'string', minLength: 1, maxLength: 160 } },
              required: ['id', 'reason'], additionalProperties: false
            }
          },
          playlistName: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] }
        },
          required: ['reply', 'vibe', 'energy', 'languageAction', 'language', 'addConstraints', 'removeConstraints', 'operation', 'insertAfter', 'draftOperation', 'removeTrackIds', 'reaction', 'playlistName', 'songs'],
        additionalProperties: false
      }
    }
  }
] as const;

/**
 * Gemini's OpenAI-compatible endpoint reads tool parameters as an OpenAPI subset: it has no
 * `strict`, `additionalProperties` or string length keywords, and writes "or null" as `nullable`.
 * Validation still happens in parsePlan, so dropping these loses nothing.
 */
function geminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (typeof value !== 'object' || value === null) return value;
  const schema = value as Record<string, unknown>;
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf as Record<string, unknown>[] : null;
  if (anyOf && anyOf.length === 2 && anyOf.some((option) => option.type === 'null')) {
    const other = anyOf.find((option) => option.type !== 'null') ?? {};
    return { ...(geminiSchema(other) as Record<string, unknown>), nullable: true };
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(schema)) {
    if (key === 'strict' || key === 'additionalProperties' || key === 'minLength' || key === 'maxLength') continue;
    out[key] = geminiSchema(item);
  }
  return out;
}

const geminiToolDefinitions = geminiSchema(toolDefinitions);
