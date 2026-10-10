import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';

interface Captured { readonly url: string; readonly init: RequestInit | undefined }

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A tiny but valid WAV: header plus four silent samples. */
function wavBase64(samples = 4): string {
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write('WAVEfmt ', 8, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes.toString('base64');
}

function providerFetch(captured: Captured[], reply: (url: string) => Response) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    captured.push({ url, init });
    return Promise.resolve(reply(url));
  };
}

const app = (fetchImpl: ReturnType<typeof providerFetch>) => createApp({
  version: 'test', jwtSecret: 'test-secret', saavnApiUrl: 'https://saavn.test/api', gaanaApiUrl: 'https://gaana.test/api',
  fetchImpl: fetchImpl as typeof fetch, rateLimit: false
});

test('a Groq key transcribes a spoken request through the mounted route', async () => {
  const captured: Captured[] = [];
  const response = await request(app(providerFetch(captured, () => json({ text: ' Play Kesariya with karaoke ' }))))
    .post('/api/ai/dj/transcribe')
    .send({ provider: 'groq', apiKey: 'gsk-test', audio: wavBase64() });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true, data: { text: 'Play Kesariya with karaoke' } });
  assert.equal(captured[0]?.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(new Headers(captured[0]?.init?.headers).get('authorization'), 'Bearer gsk-test');
  const form = captured[0]?.init?.body as FormData;
  assert.equal(form.get('model'), 'whisper-large-v3-turbo');
});

test('transcribe accepts a recording bigger than the global body limit', async () => {
  const captured: Captured[] = [];
  const response = await request(app(providerFetch(captured, () => json({ text: 'pause' }))))
    .post('/api/ai/dj/transcribe')
    .send({ provider: 'openai', apiKey: 'sk-test', audio: wavBase64(40_000) });
  assert.equal(response.status, 200);
  assert.equal((captured[0]?.init?.body as FormData).get('model'), 'gpt-transcribe');
});

test('transcribe refuses what is not a WAV, and turns a rejected key into plain words', async () => {
  const captured: Captured[] = [];
  const bad = await request(app(providerFetch(captured, () => json({}))))
    .post('/api/ai/dj/transcribe')
    .send({ provider: 'openai', apiKey: 'sk-test', audio: Buffer.from('not audio at all, really').toString('base64') });
  assert.equal(bad.status, 400);
  assert.equal(captured.length, 0);

  const rejected = await request(app(providerFetch(captured, () => json({ error: { message: 'Incorrect API key provided: sk-t***' } }, 401))))
    .post('/api/ai/dj/transcribe')
    .send({ provider: 'openai', apiKey: 'sk-test', audio: wavBase64() });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.body.success, false);
  assert.match(rejected.body.error as string, /didn’t accept that key/);
  assert.doesNotMatch(rejected.body.error as string, /Incorrect API key/);
});

test('an ElevenLabs key speaks a reply as base64 MP3', async () => {
  const captured: Captured[] = [];
  const response = await request(app(providerFetch(captured, () => new Response(new Uint8Array([0xff, 0xf3, 0x01]), { status: 200 }))))
    .post('/api/ai/dj/speak')
    .send({ provider: 'elevenlabs', apiKey: 'xi-test', text: 'Playing Kesariya.' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true, data: { audio: Buffer.from([0xff, 0xf3, 0x01]).toString('base64'), mime: 'audio/mpeg' } });
  assert.match(captured[0]?.url ?? '', /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/JBFqnCBsd6RMkjVDRZzb\?/);
  assert.equal(new Headers(captured[0]?.init?.headers).get('xi-api-key'), 'xi-test');
});

test('an OpenAI key speaks with the chosen voice, and an empty request is refused', async () => {
  const captured: Captured[] = [];
  const response = await request(app(providerFetch(captured, () => new Response(new Uint8Array([1, 2]), { status: 200 }))))
    .post('/api/ai/dj/speak')
    .send({ provider: 'openai', apiKey: 'sk-test', voice: 'sage', text: 'Skipping.' });
  assert.equal(response.status, 200);
  const sent = JSON.parse(String(captured[0]?.init?.body)) as Record<string, unknown>;
  assert.equal(sent.voice, 'sage');
  assert.equal(sent.model, 'gpt-4o-mini-tts');

  const empty = await request(app(providerFetch(captured, () => json({}))))
    .post('/api/ai/dj/speak')
    .send({ provider: 'openai', apiKey: 'sk-test', text: '   ' });
  assert.equal(empty.status, 400);
});
