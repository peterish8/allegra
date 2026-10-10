import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDjSlashCommand } from '@shared/dj';
import { applyDjLocalSession, heuristicDjLocalIntent } from '@shared/djLocal';

import {
  DJ_PROVIDER_STORAGE_KEY,
  applySlashCommand,
  DJ_MEMORY_STORAGE_KEY,
  defaultModelFor,
  djEnergyWord,
  djSuggestions,
  moveId,
  orderByIds,
  readDjMemory,
  readDjProviderChoice,
  sessionWithEnergy,
  sessionWithoutConstraint,
  sessionWithoutLanguage,
  writeDjMemory,
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

test('removing the language chip leaves the next local turn with no language', () => {
  const remembered = { vibe: 'late night melodies', energy: 2, language: 'Tamil', constraints: ['no remixes'] };
  const edited = sessionWithoutLanguage(remembered);
  assert.equal(edited.language, null);
  assert.deepEqual(edited.constraints, ['no remixes']);
  const context = { goal: 'mix' as const, message: 'more like this', session: edited, current: null, draft: [], draftName: '' };
  const next = applyDjLocalSession(heuristicDjLocalIntent(context), edited);
  assert.equal(next.language, null);
  // Untouched, the same message keeps the remembered language.
  const kept = applyDjLocalSession(heuristicDjLocalIntent({ ...context, session: remembered }), remembered);
  assert.equal(kept.language, 'Tamil');
});

test('energy and constraint edits', () => {
  const session = { vibe: '', energy: 3, language: null, constraints: ['no remixes', 'short songs'] };
  assert.equal(sessionWithEnergy(session, 9).energy, 5);
  assert.equal(sessionWithEnergy(session, 0).energy, 1);
  assert.deepEqual(sessionWithoutConstraint(session, 'no remixes').constraints, ['short songs']);
});

test('moveId and orderByIds', () => {
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'c', -2), ['c', 'a', 'b']);
  assert.deepEqual(moveId(['a', 'b'], 'x', 1), ['a', 'b']);
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(orderByIds(items, ['c', 'a'], (item) => item.id).map((item) => item.id), ['c', 'a', 'b']);
});

const SONG = {
  id: 's1', title: 'Yeshanagula', artist: 'Anirudh Ravichander, Singer Prabha', artwork: 'a.jpg', streamUrl: 'u',
  duration: 179, hasLyrics: false, playCount: 0, source: 'Saavn' as const, language: 'telugu'
};

test('suggestions start from the playing song, the energy, the main language and the hour', () => {
  const chips = djSuggestions(SONG, [{ artist: 'X', language: 'telugu' }, { artist: 'Y', language: 'tamil' }], 22);
  assert.equal(chips[0]?.label, 'More from Anirudh Ravichander');
  assert.equal(chips[1]?.label, 'More energy');
  assert.ok(chips.some((chip) => chip.label === 'Keep it Telugu'));
  assert.ok(chips.some((chip) => chip.label === 'Late night'));
  assert.ok(chips.some((chip) => chip.label === 'Surprise me'));
  assert.ok(chips.every((chip) => chip.hint.length > 0));
  const morning = djSuggestions(null, [], 8);
  assert.ok(morning.some((chip) => chip.label === 'Morning lift'));
  assert.ok(!morning.some((chip) => chip.label.startsWith('More from')));
});

test('suggestions follow the set: calmer when it is loud, no language chip once one is set, sing along only with lyrics', () => {
  const loud = djSuggestions(SONG, [], 14, { energy: 5, language: 'telugu' });
  assert.equal(loud[1]?.label, 'Calmer next');
  assert.ok(!loud.some((chip) => chip.label.startsWith('Keep it')));
  assert.ok(!loud.some((chip) => chip.label === 'Sing along'));
  const withLyrics = djSuggestions({ ...SONG, hasLyrics: true }, [], 14);
  assert.ok(withLyrics.some((chip) => chip.label === 'Sing along'));
});

test('energy words cover the five levels and clamp the rest', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(djEnergyWord), ['Calm', 'Easy', 'Balanced', 'Lively', 'Hype']);
  assert.equal(djEnergyWord(0), 'Calm');
  assert.equal(djEnergyWord(9), 'Hype');
  assert.equal(djEnergyWord(Number.NaN), 'Balanced');
});

test('session memory round-trips and never stores a key', () => {
  const storage = fakeStorage();
  writeDjMemory(storage, {
    session: { vibe: 'late night', energy: 2, language: 'telugu', constraints: ['no sad songs'] },
    history: [{ role: 'user', content: 'late night' }],
    goal: 'playlist', songLimit: 12, draft: [{ song: SONG, reason: 'Same singer' }], draftName: 'Night', reasons: { s1: 'Same singer' }
  });
  const raw = storage.data.get(DJ_MEMORY_STORAGE_KEY) ?? '';
  assert.ok(!/key/i.test(raw.replace(/"songLimit"/, '')));
  const memory = readDjMemory(storage);
  assert.equal(memory?.session.language, 'telugu');
  assert.equal(memory?.draft[0]?.song.id, 's1');
  assert.equal(memory?.goal, 'playlist');
});

test('malformed session memory reads as nothing remembered, bad songs are dropped', () => {
  assert.equal(readDjMemory(fakeStorage({ [DJ_MEMORY_STORAGE_KEY]: '{oops' })), null);
  assert.equal(readDjMemory(fakeStorage({ [DJ_MEMORY_STORAGE_KEY]: '{"session":{"vibe":3}}' })), null);
  const memory = readDjMemory(fakeStorage({
    [DJ_MEMORY_STORAGE_KEY]: JSON.stringify({ session: { vibe: '', energy: 9, constraints: [1, 'calm'] }, draft: [{ song: { id: 'x' } }] })
  }));
  assert.equal(memory?.session.energy, 5);
  assert.deepEqual(memory?.session.constraints, ['calm']);
  assert.equal(memory?.draft.length, 0);
});
