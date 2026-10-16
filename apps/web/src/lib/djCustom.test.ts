import assert from 'node:assert/strict';
import test from 'node:test';

import { completionText, modelIds, normalizeEndpoint, suggestedModel } from './djCustom.ts';

test('a loaded list starts on a free automatic route when there is one, else its first model', () => {
  assert.equal(suggestedModel(['agy/claude-opus', 'auto/chat', 'auto/best-free', 'github/gpt-4.1']), 'auto/best-free');
  assert.equal(suggestedModel(['agy/claude-opus', 'auto/chat']), 'auto/chat');
  assert.equal(suggestedModel(['llama3', 'mistral']), 'llama3');
  assert.equal(suggestedModel([]), null);
  assert.equal(modelIds({ data: Array.from({ length: 900 }, (_, index) => ({ id: `m${index}` })) }).length, 900, 'an ~800-model router is not cut short');
});

test('endpoints: https anywhere, plain http only on this computer, pasted paths trimmed', () => {
  assert.equal(normalizeEndpoint('http://localhost:20128/v1'), 'http://localhost:20128/v1');
  assert.equal(normalizeEndpoint(' http://localhost:20128/v1/ '), 'http://localhost:20128/v1');
  assert.equal(normalizeEndpoint('http://127.0.0.1:20128/v1/chat/completions'), 'http://127.0.0.1:20128/v1');
  assert.equal(normalizeEndpoint('https://router.example.com/api/v1/models'), 'https://router.example.com/api/v1');
  assert.equal(normalizeEndpoint('http://[::1]:8080/v1'), 'http://[::1]:8080/v1');
  assert.equal(normalizeEndpoint('http://192.168.1.4:20128/v1'), null, 'plain http off this computer is blocked by the browser anyway');
  assert.equal(normalizeEndpoint('http://router.example.com/v1'), null);
  assert.equal(normalizeEndpoint('ftp://localhost/v1'), null);
  assert.equal(normalizeEndpoint('https://user:pass@example.com/v1'), null, 'no credentials in the URL');
  assert.equal(normalizeEndpoint('https://example.com/v1?key=secret'), null, 'no key in a query string');
  assert.equal(normalizeEndpoint('not a url'), null);
});

test('a chat completion gives its text; anything else gives nothing', () => {
  assert.equal(completionText({ choices: [{ message: { role: 'assistant', content: '{"reply":"hi"}' } }] }), '{"reply":"hi"}');
  assert.equal(completionText({ choices: [] }), '');
  assert.equal(completionText('oops'), '');
});

test('a /models list gives sorted unique IDs', () => {
  assert.deepEqual(modelIds({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { name: 'no id' }, { id: 7 }] }), ['a', 'b']);
  assert.deepEqual(modelIds({ models: [] }), []);
});
