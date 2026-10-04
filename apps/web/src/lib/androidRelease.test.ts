import assert from 'node:assert/strict';
import test from 'node:test';

import { formatSize, isNewerRelease, parseAndroidRelease, releasedAgo, watchAndroidRelease } from './androidRelease.ts';
import type { AndroidRelease } from './androidRelease.ts';

const release = {
  name: 'LuvLyrics 0.2.0 — latest build',
  published_at: '2026-10-01T16:51:09Z',
  assets: [
    { name: 'changelog.json', size: 400, browser_download_url: 'https://example.com/changelog.json' },
    { name: 'LuvLyrics.apk', size: 33_242_247, browser_download_url: 'https://example.com/LuvLyrics.apk' }
  ]
};

test('reads the real file, size, version and date from the release', () => {
  const parsed = parseAndroidRelease(release);
  assert.equal(parsed?.url, 'https://example.com/LuvLyrics.apk');
  assert.equal(parsed?.sizeBytes, 33_242_247);
  assert.equal(parsed?.version, '0.2.0');
  assert.equal(parsed?.publishedAt.toISOString(), '2026-10-01T16:51:09.000Z');
});

test('a release without a version in its title still offers the file', () => {
  const parsed = parseAndroidRelease({ ...release, name: 'LuvLyrics — latest build' });
  assert.equal(parsed?.version, null);
  assert.equal(parsed?.url, 'https://example.com/LuvLyrics.apk');
});

test('anything that is not a release with an APK gives nothing', () => {
  assert.equal(parseAndroidRelease(null), null);
  assert.equal(parseAndroidRelease({ message: 'rate limited' }), null);
  assert.equal(parseAndroidRelease({ ...release, published_at: 'later' }), null);
  assert.equal(parseAndroidRelease({ ...release, assets: [] }), null);
  assert.equal(parseAndroidRelease({ ...release, assets: [{ name: 'notes.txt', browser_download_url: 'x' }] }), null);
});

test('sizes read like a download list', () => {
  assert.equal(formatSize(33_242_247), '31.7 MB');
  assert.equal(formatSize(150 * 1024 * 1024), '150 MB');
  assert.equal(formatSize(300 * 1024), '300 KB');
});

test('release age is in words for the first two weeks', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  assert.equal(releasedAgo(new Date('2026-10-03T01:00:00Z'), now), 'today');
  assert.equal(releasedAgo(new Date('2026-10-02T01:00:00Z'), now), 'yesterday');
  assert.equal(releasedAgo(new Date('2026-09-29T01:00:00Z'), now), '4 days ago');
});

test('reads the build commit, short', () => {
  assert.equal(parseAndroidRelease({ ...release, target_commitish: '21738edbd1e2c0ffee21738edbd1e2c0ffee2173' })?.build, '21738ed');
  assert.equal(parseAndroidRelease({ ...release, target_commitish: 'main' })?.build, null);
  assert.equal(parseAndroidRelease(release)?.build, null);
});

const build = (iso: string, url = 'https://example.com/LuvLyrics.apk'): AndroidRelease =>
  ({ url, sizeBytes: 1, version: '1.0.0', build: null, publishedAt: new Date(iso) });

test('only a later build replaces the one showing', () => {
  const older = build('2026-10-04T06:00:00Z');
  const newer = build('2026-10-04T09:00:00Z');
  assert.equal(isNewerRelease(older, null), true);
  assert.equal(isNewerRelease(newer, older), true);
  assert.equal(isNewerRelease(older, newer), false);
  assert.equal(isNewerRelease(newer, newer), false);
  assert.equal(isNewerRelease(null, older), false);
});

test('an open page picks up a build published after it loaded', async () => {
  const answers = [build('2026-10-04T06:00:00Z'), build('2026-10-04T06:00:00Z'), build('2026-10-04T09:00:00Z')];
  const heard: string[] = [];
  const stop = watchAndroidRelease(r => heard.push(r.publishedAt.toISOString()), 5, async () => answers.shift() ?? null);
  await new Promise(resolve => setTimeout(resolve, 60));
  stop();
  assert.deepEqual(heard, ['2026-10-04T06:00:00.000Z', '2026-10-04T09:00:00.000Z']);
});
