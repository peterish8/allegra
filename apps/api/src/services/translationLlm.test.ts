import assert from 'node:assert/strict';
import test from 'node:test';

import { AiKeyRejectedError, AiRateLimitedError, chunkLines, latinShare, LlmTranslator, parseLines, type AiKey } from './translationLlm.js';

const key: AiKey = { provider: 'openrouter', apiKey: 'sk-test-listener-key', model: 'some/model' };

interface Captured { readonly url: string; readonly headers: Record<string, string>; readonly body: Record<string, unknown> }

/** A chat-completions stand-in. `reply` gets the request body and returns [status, body]. */
function fakeProvider(reply: (body: Record<string, unknown>, call: number) => [number, unknown]) {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body });
    const [status, payload] = reply(body, calls.length - 1);
    return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const answer = (lines: unknown) => ({ choices: [{ message: { content: JSON.stringify({ lines }) } }] });
const sentLines = (body: Record<string, unknown>): string[] => {
  const messages = body.messages as { role: string; content: string }[];
  return (JSON.parse(messages[1]!.content) as { lines: string[] }).lines;
};

test('chunks at 40 lines and at 3000 characters', () => {
  assert.deepEqual(chunkLines(Array.from({ length: 85 }, (_, i) => `l${i}`)).map((c) => c.length), [40, 40, 5]);
  assert.deepEqual(chunkLines(['a'.repeat(1_600), 'b'.repeat(1_600), 'c']).map((c) => c.length), [1, 2]);
});

test('parseLines takes exactly N strings, strips fences, refuses N-1', () => {
  assert.deepEqual(parseLines('```json\n{"lines":["a","b"]}\n```', 2), ['a', 'b']);
  assert.equal(parseLines('{"lines":["a"]}', 2), null);
  assert.equal(parseLines('{"lines":["a",2]}', 2), null);
  assert.equal(parseLines('no json here', 1), null);
});

test('latinShare tells romanised text from Tamil script', () => {
  assert.equal(latinShare('vanakkam'), 1);
  assert.equal(latinShare('\u{0BB5}\u{0BA3}\u{0B95}\u{0BCD}\u{0B95}\u{0BAE}\u{0BCD}'), 0);
  assert.equal(latinShare('123 !'), 1);
});

test('translates every chunk with lines kept in order, and an empty item falls back to its source line', async () => {
  const { fetchImpl, calls } = fakeProvider((body) => [200, answer(sentLines(body).map((line, i) => (i === 0 ? '' : line.toUpperCase())))]);
  const out = await new LlmTranslator(fetchImpl).translate(['one', 'two', 'three'], 'translate', 'English', 'Tamil', key);
  assert.deepEqual(out, ['one', 'TWO', 'THREE']);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /openrouter\.ai/);
});

test('a wrong count gets one corrective retry that names the count', async () => {
  const { fetchImpl, calls } = fakeProvider((body, call) => [200, answer(call === 0 ? ['only one'] : sentLines(body))]);
  const out = await new LlmTranslator(fetchImpl).translate(['a', 'b'], 'translate', 'English', undefined, key);
  assert.deepEqual(out, ['a', 'b']);
  assert.equal(calls.length, 2);
  const messages = calls[1]!.body.messages as { role: string; content: string }[];
  assert.match(messages.at(-1)!.content, /exactly 2 items/);
});

test('gives up after the corrective retry also fails', async () => {
  const { fetchImpl, calls } = fakeProvider(() => [200, answer(['x'])]);
  assert.equal(await new LlmTranslator(fetchImpl).translate(['a', 'b'], 'translate', 'English', undefined, key), null);
  assert.equal(calls.length, 2);
});

test('asks again without response_format when the model rejects it', async () => {
  const { fetchImpl, calls } = fakeProvider((body, call) => (call === 0 ? [400, { error: { message: 'response_format is not supported' } }] : [200, answer(sentLines(body))]));
  assert.deepEqual(await new LlmTranslator(fetchImpl).translate(['a'], 'translate', 'English', undefined, key), ['a']);
  assert.ok(calls[0]!.body.response_format);
  assert.equal(calls[1]!.body.response_format, undefined);
});

test('romanize refuses a reply that is not in Latin letters', async () => {
  const tamil = '\u{0BB5}\u{0BA3}\u{0B95}\u{0BCD}\u{0B95}\u{0BAE}\u{0BCD}';
  const { fetchImpl, calls } = fakeProvider((_body, call) => [200, answer(call === 0 ? [tamil] : ['vanakkam'])]);
  assert.deepEqual(await new LlmTranslator(fetchImpl).translate([tamil], 'romanize', 'English', 'Tamil', key), ['vanakkam']);
  assert.equal(calls.length, 2);
});

test('a refused key and a rate limit are typed errors', async () => {
  await assert.rejects(new LlmTranslator(fakeProvider(() => [401, {}]).fetchImpl).translate(['a'], 'translate', 'English', undefined, key), AiKeyRejectedError);
  await assert.rejects(new LlmTranslator(fakeProvider(() => [429, {}]).fetchImpl).translate(['a'], 'translate', 'English', undefined, key), AiRateLimitedError);
});

test('the key goes only in the Authorization header, never in the body', async () => {
  const { fetchImpl, calls } = fakeProvider((body) => [200, answer(sentLines(body))]);
  await new LlmTranslator(fetchImpl).translate(['a'], 'translate', 'English', undefined, key);
  assert.equal(calls[0]!.headers.Authorization, `Bearer ${key.apiKey}`);
  assert.equal(JSON.stringify(calls[0]!.body).includes(key.apiKey), false);
});

test('stops when the time budget is spent', async () => {
  let clock = 0;
  const { fetchImpl, calls } = fakeProvider((body) => { clock += 50_000; return [200, answer(sentLines(body))]; });
  const many = Array.from({ length: 120 }, (_, i) => `line ${i}`);
  assert.equal(await new LlmTranslator(fetchImpl, () => clock).translate(many, 'translate', 'English', undefined, key), null);
  assert.ok(calls.length < 3);
});
