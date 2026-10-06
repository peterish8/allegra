import { isListenExit, type ListenExit } from '@shared/listenSignal';
import { parseSongRef, type SongRef, type SongSnapshot } from '@shared/songRef';

export interface PendingPlay {
  readonly songRef: SongRef;
  readonly song?: SongSnapshot;
  /** Saavn id retained for older API deployments and queued legacy entries. */
  readonly songId?: string;
  readonly seconds: number;
  readonly playedAt: string;
  /** A threshold-crossing event for history before the final taste signal is known. */
  readonly recentOnly: boolean;
  /** Set after Recently played accepts this event, before taste is sent. */
  readonly recentPosted: boolean;
  /** How the listen ended; absent in entries queued before it was recorded. */
  readonly exit?: ListenExit;
  readonly exitPositionSec?: number;
}

export function parsePendingPlay(body: string): PendingPlay | null {
  try {
    const value = JSON.parse(body) as { songRef?: unknown; song?: unknown; songId?: unknown; seconds?: unknown; playedAt?: unknown; recentOnly?: unknown; recentPosted?: unknown; exit?: unknown; exitPositionSec?: unknown };
    if (typeof value.seconds !== 'number' || !Number.isFinite(value.seconds) || typeof value.playedAt !== 'string') return null;
    const parsed = typeof value.songRef === 'string' ? parseSongRef(value.songRef) : null;
    if (parsed) {
      const song = isSongSnapshot(value.song) && value.song.ref === value.songRef ? value.song : undefined;
      return {
        songRef: value.songRef as SongRef,
        ...(song ? { song } : {}),
        ...(parsed.source === 'saavn' ? { songId: parsed.id } : {}),
        seconds: value.seconds,
        playedAt: value.playedAt,
        recentOnly: value.recentOnly === true,
        recentPosted: value.recentPosted === true,
        ...(isListenExit(value.exit) ? { exit: value.exit } : {}),
        ...(typeof value.exitPositionSec === 'number' && Number.isFinite(value.exitPositionSec) ? { exitPositionSec: value.exitPositionSec } : {}),
      };
    }
    // Read the previous mobile outbox format. It only recorded Saavn ids, so
    // keep sending it through the server's legacy-compatible songId field.
    return typeof value.songId === 'string' && value.songId.trim()
      ? { songRef: `saavn:${value.songId}` as SongRef, songId: value.songId, seconds: value.seconds, playedAt: value.playedAt, recentOnly: false, recentPosted: value.recentPosted === true }
      : null;
  } catch {
    return null;
  }
}

function isSongSnapshot(value: unknown): value is SongSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<SongSnapshot>;
  return typeof row.ref === 'string'
    && parseSongRef(row.ref) !== null
    && typeof row.title === 'string'
    && typeof row.artist === 'string'
    && typeof row.artwork === 'string'
    && typeof row.duration === 'number'
    && Number.isFinite(row.duration);
}

/** A saved stage prevents a retry from adding the same recent play/taste twice. */
export const nextPlayOutboxAction = (play: PendingPlay): 'recent' | 'taste' =>
  play.recentPosted ? 'taste' : 'recent';
