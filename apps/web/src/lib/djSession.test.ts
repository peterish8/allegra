import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDjSlashCommand } from '@shared/dj';

import {
  DJ_PROVIDER_STORAGE_KEY,
  applySlashCommand,
  defaultModelFor,
  readDjProviderChoice,
  writeDjProviderChoice
} from './djSession.ts';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string): string | null => data.get(key) ?? null,
    setItem: (key: string, value: string): void => { data.set(key, value); }
  };
}

function apply(input: string, state: { goal: 'mix' | 'playlist'; songLimit: number }) {
  const parsed = parseDjSlashCommand(input);
  assert.ok(parsed, `${input} should parse`);
  return applySlashCommand(state, parsed);
}

test('/playlist switches the goal and asks for at least ten songs', () => {
  const outcome = apply('/playlist', { goal: 'mix', songLimit: 8 });
  assert.equal(outcome.next.goal, 'playlist');
  assert.ok((outcome.next.songLimit ?? 0) >= 10);
  assert.equal(outcome.status, 'Playlist draft ready. Tell me the mood or first song.');
  assert.deepEqual(outcome.prompt, { clear: true });
  assert.equal(outcome.send, undefined);
});

test('/size 99 in a mix is capped at eight and keeps the rest of the message', () => {
  const outcome = apply('/size 99 something calm', { goal: 'mix', songLimit: 5 });
  assert.equal(outcome.next.songLimit, 8);
  assert.deepEqual(outcome.send, { message: 'something calm', songLimit: 8 });
});

test('/size alone prefills the prompt and asks for a number', () => {
  const outcome = apply('/size', { goal: 'mix', songLimit: 8 });
  assert.deepEqual(outcome.prompt, { clear: true, prefill: '/size ' });
  assert.equal(outcome.status, 'Choose a song count from the suggestions.');
});

test('/size in a playlist is floored at five', () => {
  const outcome = apply('/size 2', { goal: 'playlist', songLimit: 12 });
  assert.equal(outcome.next.songLimit, 5);
  assert.equal(outcome.status, 'I’ll line up 5 songs.');
});

test('/mix shrinks the limit to eight and a prompt command sends its text', () => {
  assert.equal(apply('/mix', { goal: 'playlist', songLimit: 20 }).next.songLimit, 8);
  assert.deepEqual(apply('/tamil', { goal: 'mix', songLimit: 8 }).send, { message: 'Tamil melodies' });
  assert.equal(apply('/settings', { goal: 'mix', songLimit: 8 }).next.settingsOpen, true);
});

test('provider and model round-trip through storage', () => {
  const storage = fakeStorage();
  assert.equal(readDjProviderChoice(storage), null);
  writeDjProviderChoice(storage, { provider: 'gemini', model: 'gemini-3.8-flash' });
  assert.deepEqual(readDjProviderChoice(storage), { provider: 'gemini', model: 'gemini-3.8-flash' });
});

test('a stored apiKey is ignored and never written', () => {
  const storage = fakeStorage({
    [DJ_PROVIDER_STORAGE_KEY]: JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-secret' })
  });
  const choice = readDjProviderChoice(storage);
  assert.deepEqual(choice, { provider: 'openai', model: 'gpt-4o-mini' });
  assert.ok(choice);
  writeDjProviderChoice(storage, choice);
  assert.equal(storage.data.get(DJ_PROVIDER_STORAGE_KEY)?.includes('apiKey'), false);
  assert.equal(storage.data.get(DJ_PROVIDER_STORAGE_KEY)?.includes('sk-secret'), false);
});

test('unusable stored values read as nothing, and a bad model falls back to the default', () => {
  assert.equal(readDjProviderChoice(fakeStorage({ [DJ_PROVIDER_STORAGE_KEY]: 'not json' })), null);
  assert.equal(readDjProviderChoice(fakeStorage({ [DJ_PROVIDER_STORAGE_KEY]: JSON.stringify({ provider: 'bing', model: 'x' }) })), null);
  assert.deepEqual(
    readDjProviderChoice(fakeStorage({ [DJ_PROVIDER_STORAGE_KEY]: JSON.stringify({ provider: 'local' }) })),
    { provider: 'local', model: defaultModelFor('local') }
  );
  const throwing = { getItem: (): string | null => { throw new Error('blocked'); } };
  assert.equal(readDjProviderChoice(throwing), null);
});

test('every provider has a default model', () => {
  assert.equal(defaultModelFor('openai'), 'gpt-4o-mini');
  assert.equal(defaultModelFor('openrouter'), 'openai/gpt-4o-mini');
  assert.equal(defaultModelFor('gemini'), 'gemini-3.8-flash');
  assert.equal(defaultModelFor('local'), 'Qwen3 0.6B (on-device)');
});
