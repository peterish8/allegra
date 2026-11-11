import assert from 'node:assert/strict';
import test from 'node:test';
import { matchRecording, type TrackMatch } from './reccobeats.js';
import type { Track } from './collect.js';

const track: Track = {
  id: 'saavn-track', title: 'Darshana (From "Hridayam")', artist: 'Hesham Abdul Wahab, Darshana Rajendran',
  duration: 226, popularity: 1, language: 'malayalam'
};
const official: TrackMatch = {
  id: '74c6649b-6bcd-437a-aa4e-617263646d3a', trackTitle: 'Darshana',
  durationMs: 225116, artists: [{ name: 'Hesham Abdul Wahab' }], isrc: 'INT202102847'
};
const otherId = '79971624-917d-4c12-8275-3c819f7eae25';

test('groups duplicate releases by ISRC and selects the closer duration', () => {
  const release = { ...official, id: otherId, trackTitle: 'Darshana - From "Hridayam"', durationMs: 226000 };
  assert.deepEqual(matchRecording(track, [official, release]), {
    status: 'matched', match: { id: otherId, durationDelta: 0 }
  });
});

test('leaves alternate versions, other performers and duration mismatches unmatched', () => {
  const wrong = [
    { ...official, trackTitle: 'Darshana (Sped Up)' },
    { ...official, artists: [{ name: 'Another performer' }] },
    { ...official, durationMs: 189000 }
  ];
  assert.deepEqual(matchRecording(track, wrong), { status: 'no_match' });
});

test('leaves two similarly plausible recordings unmatched', () => {
  const alternate = { ...official, id: otherId, isrc: 'INT202100001', durationMs: 226000 };
  assert.deepEqual(matchRecording(track, [official, alternate]), { status: 'ambiguous' });
});
