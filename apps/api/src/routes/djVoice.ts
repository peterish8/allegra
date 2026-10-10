import { Router, type Response as ExpressResponse } from 'express';

import { asRecord } from './common.js';
import { djLog } from './dj.js';

/**
 * The DJ's ears and voice with the listener's own key (BYOK). Allegra's free paths need no server:
 * the browser recognises and speaks on its own. These two routes only exist so a key never sits in
 * the browser bundle and provider URLs stay server-side. The key is used for the one request and is
 * never stored or logged.
 *
 *   POST /api/ai/dj/transcribe  { provider, apiKey, model?, audio (base64 WAV) }  → { text }
 *   POST /api/ai/dj/speak       { provider, apiKey, model?, voice?, text }          → { audio (base64), mime }
 */

const TIMEOUT_MS = 20_000;
/** A spoken request is short; anything bigger than this is not one. */
const MAX_AUDIO_BYTES = 700_000;
const MAX_SPEAK_CHARS = 600;

type EarsProvider = 'openai' | 'groq';
type VoiceProvider = 'openai' | 'elevenlabs';
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const EARS: Readonly<Record<EarsProvider, { readonly url: string; readonly model: string }>> = {
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'gpt-transcribe' },
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' }
};

const VOICE_DEFAULTS: Readonly<Record<VoiceProvider, { readonly model: string; readonly voice: string }>> = {
  openai: { model: 'gpt-4o-mini-tts', voice: 'coral' },
  // "George", one of ElevenLabs' premade voices available to every account.
  elevenlabs: { model: 'eleven_flash_v2_5', voice: 'JBFqnCBsd6RMkjVDRZzb' }
};

const isString = (value: unknown): value is string => typeof value === 'string';
const cleanId = (value: unknown, max: number): string | null => {
  if (!isString(value)) return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max && /^[\w.:\-/]+$/.test(trimmed) ? trimmed : null;
};

class VoiceProviderError extends Error {
  public constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** A provider's refusal, as words for the listener. Never the provider's own error text. */
function refusal(status: number, provider: string): VoiceProviderError {
  if (status === 401 || status === 403) return new VoiceProviderError(401, `${provider} didn’t accept that key. Check it in the DJ’s settings.`);
  if (status === 429) return new VoiceProviderError(429, `${provider} says you’ve hit your limit for now. Try again in a moment.`);
  if (status === 404 || status === 400) return new VoiceProviderError(400, `${provider} didn’t recognise that model or voice. Check it in the DJ’s settings.`);
  return new VoiceProviderError(502, `${provider} couldn’t handle that just now. Try again shortly.`);
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribe(fetchImpl: FetchLike, provider: EarsProvider, apiKey: string, model: string, wav: Buffer): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'request.wav');
  form.append('model', model);
  form.append('response_format', 'json');
  const response = await withTimeout((signal) => fetchImpl(EARS[provider].url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal
  }));
  if (!response.ok) throw refusal(response.status, provider === 'openai' ? 'OpenAI' : 'Groq');
  const body = asRecord(await response.json().catch(() => null));
  const text = body && isString(body.text) ? body.text.trim() : '';
  return text.slice(0, 500);
}

export async function speak(fetchImpl: FetchLike, provider: VoiceProvider, apiKey: string, model: string, voice: string, text: string): Promise<Buffer> {
  const response = await withTimeout((signal) => provider === 'openai'
    ? fetchImpl('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, voice, input: text, response_format: 'mp3', instructions: 'Warm, relaxed radio DJ. Short and friendly.' }),
      signal
    })
    : fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model }),
      signal
    }));
  if (!response.ok) throw refusal(response.status, provider === 'openai' ? 'OpenAI' : 'ElevenLabs');
  return Buffer.from(await response.arrayBuffer());
}

function failure(error: unknown, fallback: string): { status: number; message: string } {
  if (error instanceof VoiceProviderError) return { status: error.status, message: error.message };
  if (error instanceof Error && error.name === 'AbortError') return { status: 504, message: 'That took too long. Try again.' };
  return { status: 502, message: fallback };
}

/** One info line when the response finishes: route, provider, duration, status. Never the key, audio or text. */
function logWhenDone(response: ExpressResponse, route: string, provider: string | null): void {
  const startedAt = Date.now();
  response.on('finish', () => {
    djLog.info({ route, provider, ms: Date.now() - startedAt, status: response.statusCode }, 'dj request');
  });
}

export function djVoiceRouter(fetchImpl: FetchLike = fetch): Router {
  const router = Router();

  router.post('/ai/dj/transcribe', async (request, response) => {
    const body = asRecord(request.body);
    const provider = body?.provider === 'openai' || body?.provider === 'groq' ? body.provider : null;
    logWhenDone(response, 'dj/transcribe', provider);
    const apiKey = isString(body?.apiKey) ? body.apiKey.trim() : '';
    const audio = isString(body?.audio) ? body.audio : '';
    if (!provider || !apiKey || apiKey.length > 512 || !audio) {
      response.status(400).json({ success: false, data: null, error: 'Check the voice settings and try again.' });
      return;
    }
    const wav = Buffer.from(audio, 'base64');
    if (wav.length < 44 || wav.length > MAX_AUDIO_BYTES || wav.subarray(0, 4).toString('ascii') !== 'RIFF') {
      response.status(400).json({ success: false, data: null, error: 'That recording was too long or unreadable. Try a shorter request.' });
      return;
    }
    const model = cleanId(body?.model, 120) ?? EARS[provider].model;
    try {
      const text = await transcribe(fetchImpl, provider, apiKey, model, wav);
      response.status(200).json({ success: true, data: { text } });
    } catch (error) {
      const { status, message } = failure(error, 'Your voice couldn’t be written down just now. Try again or type it.');
      response.status(status).json({ success: false, data: null, error: message });
    }
  });

  router.post('/ai/dj/speak', async (request, response) => {
    const body = asRecord(request.body);
    const provider = body?.provider === 'openai' || body?.provider === 'elevenlabs' ? body.provider : null;
    logWhenDone(response, 'dj/speak', provider);
    const apiKey = isString(body?.apiKey) ? body.apiKey.trim() : '';
    const text = isString(body?.text) ? body.text.trim().slice(0, MAX_SPEAK_CHARS) : '';
    if (!provider || !apiKey || apiKey.length > 512 || !text) {
      response.status(400).json({ success: false, data: null, error: 'Check the voice settings and try again.' });
      return;
    }
    const model = cleanId(body?.model, 120) ?? VOICE_DEFAULTS[provider].model;
    const voice = cleanId(body?.voice, 80) ?? VOICE_DEFAULTS[provider].voice;
    try {
      const audio = await speak(fetchImpl, provider, apiKey, model, voice, text);
      response.status(200).json({ success: true, data: { audio: audio.toString('base64'), mime: 'audio/mpeg' } });
    } catch (error) {
      const { status, message } = failure(error, 'Your DJ couldn’t find its voice just now.');
      response.status(status).json({ success: false, data: null, error: message });
    }
  });

  return router;
}
