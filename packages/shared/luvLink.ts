import type { SongSnapshot } from './songRef';

export type LuvLinkMode = 'listen' | 'speaker';
export type LuvLinkRole = 'host' | 'member';
export type LuvLinkTransport = 'convex-v1' | 'echo-legacy';

export interface LuvLinkPlaybackAnchor {
  roomId: string;
  leaderUserId: string;
  leaderEpoch: number;
  sequence: number;
  trackEpoch: number;
  queueEntryId: string | null;
  intent: 'control' | 'natural_end' | 'checkpoint';
  intentByUserId: string;
  outputAppliedSequence: number;
  barrierPending: boolean;
  song: SongSnapshot | null;
  positionSec: number;
  serverAtMs: number;
  playing: boolean;
  effectiveAtMs: number;
  playbackRate: number;
}

export interface LuvLinkQueueEntry {
  entryId: string;
  roomId: string;
  order: number;
  song: SongSnapshot;
  addedByUserId: string;
  addedByName: string;
  createdAtMs: number;
}

export interface LuvLinkRoomSnapshot {
  roomId: string;
  hostUserId: string;
  leaderUserId: string;
  leaderEpoch: number;
  mode: LuvLinkMode;
  transport: LuvLinkTransport;
  protocolVersion: 1;
  revision: number;
  expiresAtMs: number;
  memberCount: number;
  handoffFromUserId: string | null;
}

export interface LuvLinkMemberSnapshot {
  userId: string;
  displayName: string;
  role: LuvLinkRole;
  mode: LuvLinkMode;
  canControl: boolean;
  canSuggest: boolean;
  joinedAtMs: number;
}

export interface LuvLinkGroupPick {
  song: SongSnapshot;
  forUserIds: string[];
  kind: 'shared' | 'pick';
}

export interface LuvLinkGroupPicks {
  revision: number;
  picks: LuvLinkGroupPick[];
}

export interface LuvLinkQueueSnapshot {
  revision: number;
  entries: LuvLinkQueueEntry[];
}

export interface LuvLinkPositionSample {
  clientSentAtMs: number;
  serverAtMs: number;
  clientReceivedAtMs: number;
}

/** Project a server anchor against a monotonic client clock without network writes. */
export function projectLuvLinkPosition(anchor: LuvLinkPlaybackAnchor, clientNowMs: number, estimatedServerOffsetMs = 0): number {
  const serverNowMs = clientNowMs + estimatedServerOffsetMs;
  const elapsedSec = anchor.playing ? Math.max(0, (serverNowMs - anchor.effectiveAtMs) / 1000) * anchor.playbackRate : 0;
  const raw = anchor.positionSec + elapsedSec;
  return anchor.song ? Math.max(0, Math.min(anchor.song.duration, raw)) : 0;
}

/** Use the least-queued of the first three samples; slower paths bias the one-way-delay estimate. */
export function estimateLuvLinkClockOffset(samples: readonly LuvLinkPositionSample[]): number {
  const valid = samples.slice(0, 3)
    .map((sample) => ({ offset: ((sample.serverAtMs - sample.clientSentAtMs) + (sample.serverAtMs - sample.clientReceivedAtMs)) / 2,
      rtt: sample.clientReceivedAtMs - sample.clientSentAtMs }))
    .filter(({ offset, rtt }) => Number.isFinite(offset) && Number.isFinite(rtt) && rtt >= 0 && rtt <= 10_000)
    .sort((a, b) => a.rtt - b.rtt)
    .slice(0, 1);
  return valid[0]?.offset ?? 0;
}
