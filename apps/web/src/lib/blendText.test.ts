import assert from 'node:assert/strict';
import test from 'node:test';

import type { BlendTrack } from '@shared/blendTypes';
import type { BlendMemberView } from '@shared/blendView';

import { artistName, blendTrackSong, changeText, storyText, wrapText } from './blendText.ts';

const members: BlendMemberView[] = [
  { userId: 'a', displayName: 'Asha', initials: 'A', isYou: true, learning: true },
  { userId: 'r', displayName: 'Ravi', initials: 'R', isYou: false, learning: true }
];
const track: BlendTrack = { song: { ref: 'saavn:abc', title: 'Kesariya', artist: 'Pritam, Arijit Singh', artwork: 'https://x/y.jpg', duration: 268 }, for: ['a'], kind: 'pick' };

test('a Blend track plays as a Saavn song through the stream route', () => {
  const song = blendTrackSong(track);
  assert.equal(song.id, 'abc');
  assert.equal(song.streamUrl, '/api/stream/abc');
  assert.equal(song.source, 'Saavn');
  assert.equal(song.duration, 268);
});

test('artist keys are shown as the catalog spells them', () => {
  assert.equal(artistName('arijit singh', [track]), 'Arijit Singh');
  assert.equal(artistName('someone new', [track]), 'Someone New');
});

test('story estimates name the other member and avoid claims about their listening history', () => {
  assert.deepEqual(storyText({ kind: 'directions', youEnjoyTheirs: 93, theyEnjoyYours: 26, otherUserId: 'r' }, { members, tracks: [track] }), {
    eyebrow: 'Estimated overlap', headline: "93% of Ravi's picks fit your taste.", detail: "26% of your picks fit Ravi's taste. These are estimates."
  });
  assert.equal(storyText({ kind: 'mostInTune', userId: 'r', match: 72 }, { members, tracks: [] }).headline, 'Most in tune with you: Ravi, 72%');
  assert.equal(storyText({ kind: 'groupMatch', match: 54 }, { members, tracks: [] }).headline, 'Group match: 54%');
  assert.equal(storyText({ kind: 'match', match: 44, confidence: 'low', change: null }, { members, tracks: [] }).detail, 'Early days — estimated from limited taste data');
  assert.equal(storyText({ kind: 'gift', fromUserId: 'r', toUserId: 'a', identity: 'x', song: track.song }, { members, tracks: [] }).eyebrow, "Ravi's gift to you");
  assert.equal(changeText({ kind: 'up', points: 6, artist: 'x' }, 'Arijit Singh'), 'Up 6 points: your overlap around Arijit Singh increased.');
  assert.equal(changeText({ kind: 'down', points: 7, artist: 'x' }, 'Pritam'), 'Down 7 points: your overlap around Pritam decreased.');
});

test('wrapText breaks on words, never exceeds the width with two or more words, and ellipsises after max lines', () => {
  const measure = (text: string) => text.length * 10;
  assert.deepEqual(wrapText('one two three four', 90, measure), ['one two', 'three', 'four']);
  for (const line of wrapText('a bb ccc dddd eeeee', 80, measure)) assert.ok(measure(line) <= 80 || !line.includes(' '));
  assert.deepEqual(wrapText('aa bb cc dd ee', 20, measure, 2), ['aa', 'bb…']);
  assert.deepEqual(wrapText('', 100, measure), []);
});
