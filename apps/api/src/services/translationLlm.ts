import { chatCompletionsUrl, type AiProvider } from '../lib/aiProviders.js';
import { fetchBodyWithTimeout } from '../lib/fetchWithTimeout.js';

/**
 * Lyric translation with the listener's own AI key (1.69.0). The key is forwarded for each call and dropped: never
 * stored, logged, cached or echoed. Lines stay aligned with the timed lyrics because every reply must hold exactly
 * one item per input line; a wrong count gets one corrective retry, then the whole song fails (half-translated
 * lyrics read worse than the original).
 */
export type TranslationMode = 'translate' | 'romanize' | 'transcribe';

export interface AiKey {
  readonly provider: AiProvider;
  readonly apiKey: string;
  readonly model: string;
}

/** The provider refused the key (401/403). */
export class AiKeyRejectedError extends Error {
  public constructor() {
    super('AI key refused');
    this.name = 'AiKeyRejectedError';
  }
}

/** The provider is rate-limiting the key (429). */
export class AiRateLimitedError extends Error {
  public constructor() {
    super('AI key rate limited');
    this.name = 'AiRateLimitedError';
  }
}

export const LLM_CHUNK_LINES = 40;
export const LLM_CHUNK_CHARS = 3_000;
export const LLM_CONCURRENCY = 2;
export const LLM_CALL_TIMEOUT_MS = 25_000;
export const LLM_TOTAL_BUDGET_MS = 45_000;
export const ROMAN_SHARE = 0.9;

/** Greedy chunks of at most LLM_CHUNK_LINES lines and LLM_CHUNK_CHARS characters (a longer line goes alone). */
export function chunkLines(texts: readonly string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const text of texts) {
    if (current.length > 0 && (current.length >= LLM_CHUNK_LINES || chars + text.length > LLM_CHUNK_CHARS)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function systemPrompt(mode: TranslationMode, target: string, source: string | undefined, count: number): string {
  const from = source ? ` from ${source}` : '';
  const task = mode === 'romanize'
    ? 'item i writes how line i is pronounced using plain Latin letters, without translating its meaning'
    : mode === 'transcribe'
      ? `item i writes how line i sounds using the ${target} script, without translating its meaning`
      : `item i translates line i into ${target}. Keep each line short and natural to sing. Keep names as they are`;
  return `You work on song lyrics one line at a time. The user sends JSON {"lines": [...]} with ${count} lines${from}. `
    + `Reply with JSON {"lines": [...]} holding exactly ${count} strings in the same order, where ${task}. `
    + 'Never merge, split, number, explain or skip lines. Copy a line unchanged when it is empty or only sounds like "la la".';
}

/** The share of letters in Latin script; 1 when the text has no letters. */
export function latinShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 1;
  const latin = text.match(/\p{Script=Latin}/gu) ?? [];
  return latin.length / letters.length;
}

/** The model's lines, or null unless the reply is a JSON object whose `lines` has exactly `expected` strings. */
export function parseLines(content: string, expected: number): string[] | null {
  const unfenced = content.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(unfenced.slice(start, end + 1)); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const lines = (parsed as { lines?: unknown }).lines;
  if (!Array.isArray(lines) || lines.length !== expected || !lines.every((line) => typeof line === 'string')) return null;
  return lines as string[];
}

interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'lyric_lines',
    strict: true,
    schema: {
      type: 'object',
      properties: { lines: { type: 'array', items: { type: 'string' } } },
      required: ['lines'],
      additionalProperties: false
    }
  }
} as const;

function providerExtras(provider: AiProvider): Record<string, unknown> {
  // Gemini thinks by default; OpenRouter should route only to endpoints that honour response_format.
  return provider === 'gemini' ? { reasoning_effort: 'low' } : provider === 'openrouter' ? { provider: { require_parameters: true } } : {};
}

export class LlmTranslator {
  public constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  /**
   * Unique source texts to translated texts in the same order, or null when the model cannot keep the lines
   * aligned or the time budget runs out. Throws AiKeyRejectedError and AiRateLimitedError.
   */
  public async translate(texts: readonly string[], mode: TranslationMode, target: string, source: string | undefined, key: AiKey): Promise<string[] | null> {
    const deadline = this.now() + LLM_TOTAL_BUDGET_MS;
    const chunks = chunkLines(texts);
    const results: (string[] | null)[] = new Array<string[] | null>(chunks.length).fill(null);
    // Written by the workers below; a holder so the checks after them are not narrowed away.
    const state: { failed: boolean; fatal: Error | null } = { failed: false, fatal: null };
    let next = 0;
    const worker = async (): Promise<void> => {
      while (!state.failed && next < chunks.length) {
        const index = next++;
        try {
          const lines = await this.translateChunk(chunks[index]!, mode, target, source, key, deadline);
          if (!lines) { state.failed = true; return; }
          results[index] = lines;
        } catch (error) {
          state.failed = true;
          state.fatal = error instanceof Error ? error : new Error('translation failed');
          return;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LLM_CONCURRENCY, chunks.length) }, worker));
    if (state.fatal) throw state.fatal;
    if (state.failed) return null;
    return results.flatMap((lines) => lines ?? []);
  }

  private async translateChunk(chunk: readonly string[], mode: TranslationMode, target: string, source: string | undefined, key: AiKey, deadline: number): Promise<string[] | null> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(mode, target, source, chunk.length) },
      { role: 'user', content: JSON.stringify({ lines: chunk }) }
    ];
    let structured = true;
    let corrected = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const remaining = deadline - this.now();
      if (remaining <= 0) return null;
      const reply = await this.call(messages, chunk, key, structured, Math.min(LLM_CALL_TIMEOUT_MS, remaining));
      if (reply.kind === 'unsupported-format' && structured) {
        // A model without structured output: ask again in plain text and read the first JSON object.
        structured = false;
        continue;
      }
      if (reply.kind !== 'content') return null;
      const lines = parseLines(reply.content, chunk.length);
      const valid = lines && (mode !== 'romanize' || lines.every((line, i) => !/\p{L}/u.test(chunk[i]!) || latinShare(line) >= ROMAN_SHARE));
      if (lines && valid) return lines.map((line, i) => line.trim() || chunk[i]!);
      if (corrected) return null;
      corrected = true;
      const got = lines ? lines.length : 'a different number of';
      messages.push({ role: 'assistant', content: reply.content });
      messages.push({ role: 'user', content: `That had ${got} items or was not in the asked form. Reply again with exactly ${chunk.length} items, one per input line.` });
    }
    return null;
  }

  private async call(
    messages: readonly ChatMessage[],
    chunk: readonly string[],
    key: AiKey,
    structured: boolean,
    timeoutMs: number
  ): Promise<{ kind: 'content'; content: string } | { kind: 'unsupported-format' } | { kind: 'failed' }> {
    const chars = chunk.reduce((sum, line) => sum + line.length, 0);
    let result;
    try {
      result = await fetchBodyWithTimeout(chatCompletionsUrl(key.provider), {
        method: 'POST',
        headers: { Authorization: `Bearer ${key.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          model: key.model,
          temperature: 0.2,
          max_tokens: Math.min(4_000, 64 + chars * 4),
          messages,
          ...(structured ? { response_format: RESPONSE_FORMAT } : {}),
          ...providerExtras(key.provider)
        })
      }, timeoutMs, this.fetchImpl);
    } catch {
      return { kind: 'failed' };
    }
    if (result.status === 401 || result.status === 403) throw new AiKeyRejectedError();
    if (result.status === 429) throw new AiRateLimitedError();
    if (result.status === 400 && structured && /response_format|json_schema/i.test(result.body)) return { kind: 'unsupported-format' };
    if (!result.ok) return { kind: 'failed' };
    let payload: unknown;
    try { payload = JSON.parse(result.body); } catch { return { kind: 'failed' }; }
    const choices = (payload as { choices?: unknown }).choices;
    const first = Array.isArray(choices) ? (choices[0] as { message?: { content?: unknown } } | undefined) : undefined;
    const content = first?.message?.content;
    return typeof content === 'string' ? { kind: 'content', content } : { kind: 'failed' };
  }
}
