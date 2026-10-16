/**
 * The DJ's "Custom endpoint" brain: any OpenAI-compatible server the listener runs or rents, such as
 * OmniRoute on their own computer (http://localhost:20128/v1). The browser calls it directly, never
 * Allegra's API: our server could not reach the listener's localhost anyway, fetching listener-typed
 * URLs from it would be a server-side request forgery hole, and this way the key only ever goes to the
 * endpoint it belongs to. The model only reads the request; the catalog search and ranking are the
 * same as the on-device DJ's.
 */

const CHAT_TIMEOUT_MS = 60_000;
const MODELS_TIMEOUT_MS = 10_000;

type ChatMessage = { readonly role: 'system' | 'user'; readonly content: string };

/** A failure the listener can act on; the message is shown as is. */
export class DjEndpointError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DjEndpointError';
  }
}

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|[a-z0-9-]+\.localhost)$/i;

/**
 * The endpoint's base URL ("…/v1"), or null. https anywhere; plain http only on this computer, the
 * one place a browser lets an https page reach it. A pasted ".../chat/completions" is trimmed back.
 */
export function normalizeEndpoint(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.test(url.hostname))) return null;
  const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').replace(/\/models$/i, '');
  return `${url.origin}${path}`;
}

function headers(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
}

/** One request with its own timeout, joined to the caller's cancel. Turns failures into plain advice. */
async function call(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const forward = (): void => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  const host = new URL(url).host;
  try {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch {
      if (signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
      if (controller.signal.aborted) throw new DjEndpointError(`${host} took too long to answer. Try a faster model.`);
      // A browser reports a CORS refusal and a closed port the same way, on purpose.
      throw new DjEndpointError(`Couldn’t reach ${host}. Check it’s running, and that it allows this site (CORS allowed origins).`);
    }
    if (response.status === 401 || response.status === 403) throw new DjEndpointError(`${host} didn’t accept the key. Check the API key in the DJ settings.`);
    if (response.status === 404) throw new DjEndpointError(`${host} doesn’t know that model or address. Check the endpoint URL and model.`);
    if (response.status === 429) throw new DjEndpointError(`${host} is at its request limit. Wait a moment and try again.`);
    if (!response.ok) throw new DjEndpointError(`${host} answered with an error (${response.status}). Try another model.`);
    try { return await response.json(); } catch { throw new DjEndpointError(`${host} sent something that isn’t JSON. Is the URL the OpenAI-compatible one (…/v1)?`); }
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The model's text answer from an OpenAI-style chat completion. */
export function completionText(payload: unknown): string {
  const choices = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices : [];
  const message = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : null;
  return message && typeof message.content === 'string' ? message.content : '';
}

/** The model IDs an OpenAI-style `/models` list offers, sorted, at most 2000 (OmniRoute lists ~800). */
export function modelIds(payload: unknown): string[] {
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const ids = data.flatMap((item) => (isRecord(item) && typeof item.id === 'string' && item.id.length <= 160 ? [item.id] : []));
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, 2000);
}

/** Routers' own "pick for me" models, best first; a plain endpoint has none and gets its first model. */
const PREFERRED_MODELS = ['auto/best-free', 'auto/chat', 'auto/fast', 'auto', 'openrouter/auto'];

/** The model to start with once a list loads: a free automatic route when the endpoint has one. */
export function suggestedModel(ids: readonly string[]): string | null {
  return PREFERRED_MODELS.find((id) => ids.includes(id)) ?? ids[0] ?? null;
}

export async function customChat(endpoint: string, apiKey: string, model: string, messages: readonly ChatMessage[], signal?: AbortSignal): Promise<string> {
  const payload = await call(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 600, stream: false })
  }, CHAT_TIMEOUT_MS, signal);
  const text = completionText(payload);
  if (!text.trim()) throw new DjEndpointError('Your model answered with nothing. Try another model.');
  return text;
}

/**
 * One tiny request to the chosen model: how long it took, or the error the DJ would hit. A router's
 * models come and go (quotas, upstream blocks), so the listener can check before asking for music.
 */
export async function testCustomModel(endpoint: string, apiKey: string, model: string, signal?: AbortSignal): Promise<number> {
  const started = performance.now();
  await customChat(endpoint, apiKey, model, [{ role: 'user', content: 'Reply with {"ok":true} only.' }], signal);
  return Math.round(performance.now() - started);
}

export async function listCustomModels(endpoint: string, apiKey: string, signal?: AbortSignal): Promise<string[]> {
  return modelIds(await call(`${endpoint}/models`, { method: 'GET', headers: headers(apiKey) }, MODELS_TIMEOUT_MS, signal));
}
