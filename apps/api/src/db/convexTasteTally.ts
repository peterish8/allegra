import type { SongSnapshot } from '../shared/songRef.js';
import type { TasteTally, TallySeed, TallySong } from '../user/tasteTally.js';
import type { ConvexGateway } from './convexGateway.js';

/** Convex-backed tally adapter; every operation is named in convexGateway.ts. */
export class ConvexTasteTally implements TasteTally {
  public constructor(private readonly convex: ConvexGateway) {}

  public async record(userId: string, song: SongSnapshot, secondsHeard: number, playedAt: number, playId?: string): Promise<boolean> {
    const result = await this.convex.mutation('taste:record', { userId, song, secondsHeard, playedAt, ...(playId ? { playId } : {}) });
    return isRecord(result) && result.applied === true;
  }

  public async bonus(userId: string, song: SongSnapshot, kind: 'like' | 'unlike' | 'playlistAdd', at: number): Promise<void> {
    await this.convex.mutation('taste:bonus', { userId, song, kind, at });
  }

  public async seed(
    userId: string,
    input: { likes: readonly TallySeed[]; items: readonly TallySeed[]; recents: readonly TallySeed[] }
  ): Promise<void> {
    await this.convex.mutation('taste:seed', { userId, ...input });
  }

  public async top(userId: string, limit: number): Promise<readonly TallySong[]> {
    const result = await this.convex.query('taste:top', { userId, limit });
    if (!Array.isArray(result)) return [];
    return result.flatMap((row) => {
      const parsed = parseTallySong(row);
      return parsed ? [parsed] : [];
    });
  }

  public async clear(userId: string): Promise<void> {
    await this.convex.mutation('taste:clear', { userId });
  }
}

function parseTallySong(value: unknown): TallySong | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.identity !== 'string' ||
    typeof value.ref !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.artist !== 'string' ||
    typeof value.artwork !== 'string' ||
    typeof value.duration !== 'number' || !Number.isFinite(value.duration) ||
    typeof value.score !== 'number' || !Number.isFinite(value.score)
  ) return null;
  return {
    identity: value.identity,
    ref: value.ref,
    title: value.title,
    artist: value.artist,
    artwork: value.artwork,
    duration: value.duration,
    score: value.score
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
