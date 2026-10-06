import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateLuvLinkClockOffset, projectLuvLinkPosition } from './luvLink.ts';
import type { LuvLinkPlaybackAnchor } from './luvLink.ts';

const anchor: LuvLinkPlaybackAnchor = {
  roomId: 'r', leaderUserId: 'u', leaderEpoch: 2, sequence: 4, trackEpoch: 1,
  queueEntryId: 'q', song: { ref: 'saavn:track', title: 'Song', artist: 'Artist', artwork: '', duration: 180 },
  positionSec: 20, serverAtMs: 10_000, playing: true, effectiveAtMs: 10_000, playbackRate: 1,
};

test('LuvLink projects an anchor locally and clamps it to duration', () => {
  assert.equal(projectLuvLinkPosition(anchor, 12_500), 22.5);
  assert.equal(projectLuvLinkPosition(anchor, 200_000), 180);
});

test('LuvLink clock offset favors low-RTT samples and rejects invalid samples', () => {
  assert.equal(estimateLuvLinkClockOffset([
    { clientSentAtMs: 0, serverAtMs: 110, clientReceivedAtMs: 20 },
    { clientSentAtMs: 0, serverAtMs: 10_000, clientReceivedAtMs: 9_000 },
    { clientSentAtMs: 0, serverAtMs: 150, clientReceivedAtMs: 20 },
  ]), 100);
  assert.equal(estimateLuvLinkClockOffset([{ clientSentAtMs: 10, serverAtMs: 0, clientReceivedAtMs: 0 }]), 0);
});
