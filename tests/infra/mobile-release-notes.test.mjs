import assert from 'node:assert/strict';
import test from 'node:test';

import { changelogFor, itemFor, markdownFor, sectionsFor } from '../../scripts/mobile-release-notes.mjs';

test('a feature or a fix becomes a line a listener can read', () => {
  assert.deepEqual(itemFor('feat(connect): send a seek made on another device.'), { section: 'New', text: 'Send a seek made on another device' });
  assert.deepEqual(itemFor('fix(mobile): cover art stuck on the last song'), { section: 'Fixed', text: 'Cover art stuck on the last song' });
  assert.equal(itemFor('perf(player): decode the next cover early')?.section, 'Faster and smoother');
});

test('work a listener cannot feel is left out', () => {
  for (const subject of ['chore(infra): bump deps', 'docs: update the handoff', 'test(connect): more cases', 'ci: cache gradle', 'Merge branch main', 'no convention here']) {
    assert.equal(itemFor(subject), null, subject);
  }
});

test('sections come in a fixed order and skip the empty ones', () => {
  const sections = sectionsFor(['fix(a): one', 'feat(b): two', 'fix(a): one', 'chore: three', 'feat(c): four']);
  assert.deepEqual(sections, [
    { title: 'New', items: ['Two', 'Four'] },
    { title: 'Fixed', items: ['One'] },
  ]);
});

test('a very long subject is cut on a word and marked', () => {
  const item = itemFor(`feat(x): ${'word '.repeat(60)}`);
  assert.ok(item && item.text.length <= 120 && item.text.endsWith('…'));
});

test('no listener-facing change still gives the app something to show', () => {
  const sections = sectionsFor(['chore: nothing']);
  const json = changelogFor({ version: '0.2.0', commit: 'a'.repeat(40), sections, description: 'Small improvements and fixes.' });
  assert.deepEqual(json.changelog, []);
  assert.match(markdownFor('0.2.0', sections, json.description), /Small improvements and fixes\./);
});
