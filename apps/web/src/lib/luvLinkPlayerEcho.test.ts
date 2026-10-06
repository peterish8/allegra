import assert from 'node:assert/strict';
import test from 'node:test';
import { isAppliedLuvLinkPlayerEcho } from '../components/luvLink/playerEcho';

const applied = { roomId: 'room-1', leaderEpoch: 3, sequence: 12, songRef: 'saavn:track-2' };

test('a remote track loaded by the elected output is not republished as a new local command', () => {
  assert.equal(isAppliedLuvLinkPlayerEcho(applied, {
    roomId: 'room-1', leaderEpoch: 3, sequence: 12, songRef: 'saavn:track-2',
  }), true);
});

test('the next local track selection is published once instead of being swallowed by the prior anchor', () => {
  assert.equal(isAppliedLuvLinkPlayerEcho(applied, {
    roomId: 'room-1', leaderEpoch: 3, sequence: 12, songRef: 'saavn:track-3',
  }), false);
});

test('a prior anchor cannot suppress a command after the leader epoch or sequence changes', () => {
  assert.equal(isAppliedLuvLinkPlayerEcho(applied, {
    roomId: 'room-1', leaderEpoch: 4, sequence: 12, songRef: 'saavn:track-2',
  }), false);
  assert.equal(isAppliedLuvLinkPlayerEcho(applied, {
    roomId: 'room-1', leaderEpoch: 3, sequence: 13, songRef: 'saavn:track-2',
  }), false);
});
