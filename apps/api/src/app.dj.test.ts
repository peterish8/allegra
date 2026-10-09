import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

const raw = (id: string, name: string, artist: string) => ({
  id,
  name,
  primaryArtists: artist,
  language: 'tamil',
  duration: 200,
  playCount: 0,
  image: [{ quality: '500x500', url: 'https://img/song.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const toolCall = (id: string, name: string, args: unknown, signature?: string) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
  ...(signature ? { extra_content: { google: { thought_signature: signature } } } : {})
});

const assistant = (calls: unknown[]) => json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: calls } }] });

interface Captured { readonly url: string; readonly body: Record<string, unknown>; readonly auth: string | null }

/** A scripted Gemini: read context, search once, then commit the first song the search returned. */
function geminiFetch(captured: Captured[], reply?: () => Response) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.startsWith('https://saavn.test/api/search/songs')) {
      return Promise.resolve(json({ success: true, data: { results: [raw('ta1', 'Vaanam', 'Anirudh'), raw('ta2', 'Mazhai', 'Harini')] } }));
    }
    if (url !== GEMINI) return Promise.resolve(json({ success: false }, 404));
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    captured.push({ url, body, auth: new Headers(init?.headers).get('authorization') });
    if (reply) return Promise.resolve(reply());
    const step = captured.length;
    if (step === 1) return Promise.resolve(assistant([toolCall('c1', 'get_session_context', {}, 'sig-one')]));
    if (step === 2) return Promise.resolve(assistant([toolCall('c2', 'search_catalog', { query: 'tamil melodies' })]));
    const messages = body.messages as { role: string; content?: string }[];
    const results = JSON.parse(messages.filter((message) => message.role === 'tool').at(-1)?.content ?? '{}') as { results?: { id: string }[] };
    const first = results.results?.[0]?.id ?? 'missing';
    return Promise.resolve(assistant([toolCall('c3', 'commit_dj_plan', {
      reply: 'Two soft Tamil songs for later.', vibe: 'late night', energy: 2, languageAction: 'set', language: 'tamil',
      addConstraints: [], removeConstraints: [], operation: 'replace_upcoming', insertAfter: null, draftOperation: 'keep',
      removeTrackIds: [], reaction: 'dreamy', playlistName: null, songs: [{ id: first, reason: 'Soft and Tamil.' }]
    })]));
  };
}

const app = (fetchImpl: ReturnType<typeof geminiFetch>) => createApp({
  version: 'test', jwtSecret: 'test-secret', saavnApiUrl: 'https://saavn.test/api', gaanaApiUrl: 'https://gaana.test/api',
  fetchImpl: fetchImpl as typeof fetch, rateLimit: false
});

const turn = {
  provider: 'gemini', apiKey: 'test-key', model: 'gemini-3.8-flash', goal: 'mix', songLimit: 4,
  message: 'Late night Tamil melodies', history: [], current: null, queue: [], draft: [], draftName: '',
  recent: [], liked: [], skipped: [], session: { vibe: '', energy: 3, language: null, constraints: [] }
};

test('a Gemini key runs a full DJ turn through the OpenAI-compatible endpoint', async () => {
  const captured: Captured[] = [];
  const reply = await request(app(geminiFetch(captured))).post('/api/ai/dj/turn').send(turn);

  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.equal(reply.body.data.queue.length, 1);
  assert.equal(reply.body.data.session.language, 'tamil');
  assert.equal(captured.length, 3);
  assert.equal(captured[0]?.auth, 'Bearer test-key');
  assert.equal(captured[0]?.body.model, 'gemini-3.8-flash');
  assert.equal(captured[0]?.body.reasoning_effort, 'low');
});

test('Gemini gets tool schemas it accepts', async () => {
  const captured: Captured[] = [];
  await request(app(geminiFetch(captured))).post('/api/ai/dj/turn').send(turn);
  const tools = JSON.stringify(captured[0]?.body.tools);
  for (const keyword of ['"strict"', '"additionalProperties"', '"minLength"', '"maxLength"', '"type":"null"']) {
    assert.ok(!tools.includes(keyword), `${keyword} should not reach Gemini`);
  }
  assert.ok(tools.includes('"nullable":true'));
});

test('Gemini thought signatures go back with the next request', async () => {
  const captured: Captured[] = [];
  await request(app(geminiFetch(captured))).post('/api/ai/dj/turn').send(turn);
  const messages = captured[1]?.body.messages as { role: string; tool_calls?: { extra_content?: { google?: { thought_signature?: string } } }[] }[];
  const echoed = messages.find((message) => message.role === 'assistant')?.tool_calls?.[0];
  assert.equal(echoed?.extra_content?.google?.thought_signature, 'sig-one');
});

test('a rejected Gemini key reads as a key problem, not a model problem', async () => {
  const bad = () => json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }, 400);
  const reply = await request(app(geminiFetch([], bad))).post('/api/ai/dj/turn').send(turn);
  assert.equal(reply.status, 401);
  assert.match(reply.body.error, /did not accept this key/);
});

test('OpenAI still gets strict schemas', async () => {
  const captured: Captured[] = [];
  const openaiFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    captured.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown>, auth: null });
    return Promise.resolve(json({ choices: [{ message: { role: 'assistant', content: 'Tell me more.' } }] }));
  };
  const reply = await request(app(openaiFetch)).post('/api/ai/dj/turn').send({ ...turn, provider: 'openai', model: 'gpt-4o-mini' });
  assert.equal(reply.status, 200);
  assert.ok(JSON.stringify(captured[0]?.body.tools).includes('"strict":true'));
  assert.equal(captured[0]?.body.reasoning_effort, undefined);
});
