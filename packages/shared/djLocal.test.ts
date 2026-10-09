import assert from 'node:assert/strict';
import test from 'node:test';

import { heuristicDjLocalIntent, resolveDjLocalIntent, type DjLocalIntentContext } from './djLocal.ts';

const context: DjLocalIntentContext = {
  goal: 'mix',
  message: 'Late night Tamil melodies',
  session: { vibe: '', energy: 3, language: null, constraints: [] },
  current: { id: 's1', title: 'Kadhal Rojave', artist: 'A. R. Rahman' },
  draft: [],
  draftName: ''
};

test('a sloppy model answer still yields a usable intent', () => {
  const output = '<think>hmm</think>```json\n{"reply":"On it","vibe":"late night","energy":"2","operation":"INSERT","searchQueries":["tamil melodies",],}\n```';
  const intent = resolveDjLocalIntent(output, context);
  assert.equal(intent.reply, 'On it');
  assert.equal(intent.energy, 2);
  assert.equal(intent.operation, 'replace_upcoming', 'insert without insertAfter degrades safely');
  assert.deepEqual(intent.searchQueries, ['tamil melodies']);
  assert.equal(intent.reaction, 'curious');
});

test('unparseable or empty output falls back to the request itself', () => {
  for (const output of ['', 'Sure! Here are some songs', '<think>never closed']) {
    const intent = resolveDjLocalIntent(output, context);
    assert.ok(intent.searchQueries.length > 0);
    assert.equal(intent.language, 'tamil');
    assert.equal(intent.languageAction, 'set');
    assert.equal(intent.operation, 'replace_upcoming');
  }
});

test('a model that omits searchQueries still searches', () => {
  const intent = resolveDjLocalIntent('{"reply":"ok","vibe":"x"}', context);
  assert.ok(intent.searchQueries.some((query) => /tamil/i.test(query)));
});

test('playlist removals only keep ids that are in the draft', () => {
  const draftContext: DjLocalIntentContext = {
    ...context,
    goal: 'playlist',
    message: 'remove the second one',
    draft: [{ song: { id: 'a', title: 'A', artist: 'X' } as never, reason: '' }]
  };
  const intent = resolveDjLocalIntent('{"removeTrackIds":["a","ghost"],"searchQueries":[]}', draftContext);
  assert.deepEqual(intent.removeTrackIds, ['a']);
  assert.deepEqual(intent.searchQueries, []);
  assert.equal(intent.operation, 'keep');
});

test('heuristics read "after N", "like this" and "no X songs"', () => {
  const intent = heuristicDjLocalIntent({ ...context, message: 'something like this after 2, no sad songs' });
  assert.equal(intent.operation, 'insert');
  assert.equal(intent.insertAfter, 2);
  assert.deepEqual(intent.addConstraints, ['no sad songs']);
  assert.ok(intent.searchQueries.includes('A. R. Rahman'));
});
