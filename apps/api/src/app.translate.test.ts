import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';

const OPENAI = 'https://api.openai.com/v1/chat/completions';

/** An OpenAI stand-in that answers with each sent line in Latin letters, or a fixed status. */
function provider(status = 200) {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? '') });
    if (url !== OPENAI) return new Response('{}', { status: 404 });
    if (status !== 200) return new Response('{"error":{"message":"nope"}}', { status });
    const sent = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const lines = (JSON.parse(sent.messages[1]!.content) as { lines: string[] }).lines.map((_, i) => `line ${i} in latin`);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lines }) } }] }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const app = (fetchImpl: typeof fetch) => createApp({ version: 'test', jwtSecret: 'test-secret', fetchImpl, rateLimit: false });
const ai = { provider: 'openai', apiKey: 'sk-test-listener-key', model: 'gpt-test' };
const tamil = '\u{0BB5}\u{0BA3}\u{0B95}\u{0BCD}\u{0B95}\u{0BAE}\u{0BCD}';
const lyric = (count: number) => Array.from({ length: count }, (_, i) => ({ text: `${tamil} ${i}`, timestamp: i * 4, lineOrder: i }));
const body = (extra: Record<string, unknown>, count = 3) => ({ title: 'Song', artist: 'Artist', targetLanguage: 'English', language: 'tamil', lines: lyric(count), ...extra });

test('romanised lyrics with the listener key come back aligned, line for line', async () => {
  const { fetchImpl, calls } = provider();
  const response = await request(app(fetchImpl)).post('/api/lyrics/translate').send(body({ mode: 'romanize', ai }));
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.provider, 'openai:gpt-test');
  assert.deepEqual(response.body.data.lines.map((line: { timestamp: number }) => line.timestamp), [0, 4, 8]);
  assert.equal(response.body.data.lines.length, 3);
  assert.equal(JSON.stringify(response.body).includes(ai.apiKey), false);
  assert.equal(calls.length, 1);
});

test('romanised lyrics without a key are a bad request with plain copy', async () => {
  const response = await request(app(provider().fetchImpl)).post('/api/lyrics/translate').send(body({ mode: 'romanize' }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Romanised and pronunciation lyrics need your AI key.');
});

test('a malformed key or mode is a 400', async () => {
  const bad = [{ ai: { provider: 'other', apiKey: 'sk-test-listener-key', model: 'm' } }, { ai: { ...ai, apiKey: 'short' } }, { mode: 'sing' }, { ai: 'sk-test' }];
  for (const extra of bad) {
    const response = await request(app(provider().fetchImpl)).post('/api/lyrics/translate').send(body(extra));
    assert.equal(response.status, 400, JSON.stringify(extra));
  }
});

test('a refused key maps to listener copy and never echoes the provider text', async () => {
  const response = await request(app(provider(401).fetchImpl)).post('/api/ai/translate-lyrics').send(body({ ai }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'That AI key was refused.');
});

test('a rate-limited key is a 429 with plain copy', async () => {
  const response = await request(app(provider(429).fetchImpl)).post('/api/lyrics/translate').send(body({ ai }));
  assert.equal(response.status, 429);
  assert.equal(response.body.error, 'Your AI provider is limiting this key. Try again in a minute.');
});

test('a 300-line song in a multi-byte script fits the route body limit', async () => {
  const response = await request(app(provider().fetchImpl)).post('/api/lyrics/translate').send(body({ ai }, 300));
  assert.equal(response.status, 200);
  assert.equal(response.body.data.lines.length, 300);
});
