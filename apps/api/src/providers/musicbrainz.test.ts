import assert from 'node:assert/strict';
import test from 'node:test';

import { electRelease } from './musicbrainz.js';

type Recordings = Parameters<typeof electRelease>[0];

// 2026-10-11: a song first put out as a single, later on its film's album, was credited to the
// album (or to nothing, when the single was its only plain release). The original single counts.
test('the earliest plain release wins, and a single counts as one', () => {
  const recordings: Recordings = [{
    score: 100,
    length: 268_000,
    releases: [
      { title: 'Brahmastra', date: '2022-09-09', 'release-group': { id: 'album', 'primary-type': 'Album', 'secondary-types': [] } },
      { title: 'Kesariya', date: '2022-07-17', 'release-group': { id: 'single', 'primary-type': 'Single', 'secondary-types': [] } },
      { title: 'Bollywood Love Hits', date: '2021-01-01', 'release-group': { id: 'comp', 'primary-type': 'Album', 'secondary-types': ['Compilation'] } }
    ]
  }];
  assert.deepEqual(electRelease(recordings, 268), { album: 'Kesariya', year: 2022, releaseGroupId: 'single' });
});

test('compilations, other types and a different take are never elected', () => {
  const recordings: Recordings = [
    {
      score: 100,
      length: 268_000,
      releases: [
        { title: 'Bollywood Love Hits', date: '2021-01-01', 'release-group': { 'primary-type': 'Album', 'secondary-types': ['Compilation'] } },
        { title: 'Live at Wembley', date: '2020-01-01', 'release-group': { 'primary-type': 'Other', 'secondary-types': [] } }
      ]
    },
    // The live take: same title, a different length.
    { score: 100, length: 330_000, releases: [{ title: 'Unplugged', date: '2019-01-01', 'release-group': { 'primary-type': 'Album', 'secondary-types': [] } }] }
  ];
  assert.equal(electRelease(recordings, 268), null);
});
