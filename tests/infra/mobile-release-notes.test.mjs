import assert from 'node:assert/strict';
import test from 'node:test';

import { changelogFor, markdownFor, releaseHistoryFor, rollbackBuildPlan } from '../../scripts/mobile-release-notes.mjs';
import { patchMobileVersionCode } from '../../scripts/patch-mobile-version-code.mjs';

const entry = (version, item) => ({
  version,
  description: `Listener update ${version}.`,
  changelog: [{ title: 'Improved', items: [item] }],
});

const noVisibleChange = {
  version: '1.64.5',
  description: 'This release included no visible changes in the Android app.',
  changelog: [],
};

test('keeps the four newest versions and puts this build first', () => {
  const history = releaseHistoryFor({ entries: [
    entry('1.66.0', 'Tap the logo in Stream to read recent app updates.'),
    entry('1.65.0', 'Find lyrics for more versions of a song.'),
    noVisibleChange,
    entry('1.64.3', 'Download a song again after removing it.'),
    entry('1.64.2', 'No visible change.'),
  ] }, '1.66.0');

  assert.deepEqual(history.entries.map(item => item.version), ['1.66.0', '1.65.0', '1.64.5', '1.64.3']);
  assert.equal(history.entries[0].changelog[0].items[0], 'Tap the logo in Stream to read recent app updates.');
});

test('requires listener copy for the version being built', () => {
  assert.throws(() => releaseHistoryFor({ entries: [entry('1.65.0', 'Some internal change.')] }, '1.66.0'), /expected the app version 1.66.0/);
  assert.throws(() => releaseHistoryFor({ entries: [] }, '1.66.0'), /at least one release/);
  assert.throws(() => releaseHistoryFor({ entries: [entry('1.66.0', '')] }, '1.66.0'), /empty update message/);
  assert.throws(() => releaseHistoryFor({ entries: [entry('1.66.0', 'Newest.'), entry('1.67.0', 'Out of order.')] }, '1.66.0'), /ordered newest first/);
});

test('puts the curated current notes in the APK release changelog', () => {
  const current = entry('1.66.0', 'Tap the logo in Stream to read recent app updates.');
  assert.deepEqual(changelogFor({ version: '1.66.0', commit: 'a'.repeat(40), entry: current }), {
    version: '1.66.0',
    commit: 'a'.repeat(40),
    description: 'Listener update 1.66.0.',
    changelog: [{ title: 'Improved', items: ['Tap the logo in Stream to read recent app updates.'] }],
  });
});

test('writes a readable release page from the same listener copy', () => {
  const current = entry('1.66.0', 'Tap the logo in Stream to read recent app updates.');
  assert.equal(markdownFor('1.66.0', current.changelog, current.description), [
    '# LuvLyrics 1.66.0', '', 'Listener update 1.66.0.', '', '## Improved',
    '- Tap the logo in Stream to read recent app updates.', '',
  ].join('\n'));
});

test('shows rollback links only after their signed APK assets exist', () => {
  const history = { entries: [
    entry('1.66.0', 'The latest release.'),
    { ...entry('1.65.0', 'The previous release.'), sourceCommit: 'a'.repeat(40), rollbackAsset: 'LuvLyrics-rollback-1.65.0.apk' },
  ] };
  const withoutAsset = releaseHistoryFor(history, '1.66.0');
  assert.equal(withoutAsset.entries[1].rollbackUrl, undefined);

  const withAsset = releaseHistoryFor(history, '1.66.0', ['LuvLyrics-rollback-1.65.0.apk']);
  assert.equal(withAsset.entries[1].rollbackUrl, 'https://github.com/peterish8/allegra/releases/download/apk-latest/LuvLyrics-rollback-1.65.0.apk');
});

test('builds only missing rollback APKs from pinned source commits', () => {
  const history = { entries: [
    entry('1.66.0', 'The latest release.'),
    { ...entry('1.65.0', 'Previous.'), sourceCommit: 'A'.repeat(40), rollbackAsset: 'LuvLyrics-rollback-1.65.0.apk' },
    { ...entry('1.64.5', 'Older.'), sourceCommit: 'b'.repeat(40), rollbackAsset: 'LuvLyrics-rollback-1.64.5.apk' },
  ] };
  assert.deepEqual(rollbackBuildPlan(history, '1.66.0', ['LuvLyrics-rollback-1.65.0.apk']), [
    { version: '1.64.5', commit: 'b'.repeat(40), asset: 'LuvLyrics-rollback-1.64.5.apk' },
  ]);
  assert.throws(() => rollbackBuildPlan({ entries: [entry('1.66.0', 'Latest.'), { ...entry('1.65.0', 'Older.'), sourceCommit: 'bad', rollbackAsset: 'LuvLyrics-rollback-1.65.0.apk' }] }, '1.66.0'), /full source commit/);
});

test('patches exactly one Android versionCode for a historical rollback build', () => {
  const gradle = 'defaultConfig {\n        versionCode 1064003\n        versionName \"1.64.3\"\n    }\n';
  assert.equal(patchMobileVersionCode(gradle, 1065000), 'defaultConfig {\n        versionCode 1065000\n        versionName \"1.64.3\"\n    }\n');
  assert.throws(() => patchMobileVersionCode('versionCode 1\nversionCode 2\n', 1065000), /Expected one active versionCode/);
});
