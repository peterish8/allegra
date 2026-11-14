import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VERSION_PENALTY, versionPenalty, versionSegments, versionTags, type VersionTag } from './trackVersion.ts';

function sorted(tags: ReadonlySet<VersionTag>): VersionTag[] {
  return [...tags].sort();
}

const tagVectors: ReadonlyArray<readonly [string, VersionTag[]]> = [
  ['Kesariya (Lofi Flip)', ['lofi', 'remix']],
  ['Kesariya - Slowed + Reverb', ['reverb', 'slowed']],
  ['Live Wire', []],
  ['Tum Hi Ho (From "Aashiqui 2")', []],
  ['Yellow (Live at Glastonbury 2016)', ['live']],
  ['Bohemian Rhapsody - Remastered 2011', ['remaster']],
  ['Song (feat. A (B))', []],
  ['Song (Feat. Band (Live))', ['live']],
  ['Yellow （Live）', ['live']],
  ['Lo-Fi Love', []],
  ['Song - Lo-Fi', ['lofi']],
  ['', []]
];

for (const [title, expected] of tagVectors) {
  test(`versionTags: ${JSON.stringify(title)}`, () => {
    assert.deepEqual(sorted(versionTags(title)), [...expected].sort());
  });
}

const penaltyVectors: ReadonlyArray<readonly [string, string, number]> = [
  ['Blinding Lights', 'Blinding Lights (Slowed + Reverb)', -120],
  ['Yellow (Live)', 'Yellow', -30],
  ['Song', 'Song - 2015 Remaster', -5],
  ['Song (Acoustic)', 'Song (Acoustic Version)', 0],
  ['', '', 0]
];

for (const [requested, candidate, expected] of penaltyVectors) {
  test(`versionPenalty: ${JSON.stringify(requested)} vs ${JSON.stringify(candidate)}`, () => {
    assert.equal(versionPenalty(requested, candidate), expected);
  });
}

test('segments ignore plain words', () => {
  assert.deepEqual(versionSegments('Live Wire'), []);
  assert.deepEqual(versionSegments('Acoustic Soul'), []);
  assert.deepEqual(versionSegments('Kesariya - Slowed + Reverb'), ['Slowed + Reverb']);
});

test('unicode brackets are scanned', () => {
  assert.deepEqual(versionSegments('Yellow （Live）'), ['Live']);
});

test('pathological bracket strings finish fast', () => {
  const started = Date.now();
  versionTags('(a)'.repeat(50000));
  versionTags('('.repeat(5000) + 'live' + ')'.repeat(5000));
  versionTags('('.repeat(100000));
  assert.ok(Date.now() - started < 500);
});

test('a version word counted twice in one title is one tag', () => {
  assert.equal(versionPenalty('Song', 'Song (Live) - Live'), VERSION_PENALTY.extra);
});
