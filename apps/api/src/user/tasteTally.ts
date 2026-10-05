import { addDecayed, listenAmount, TALLY_AMOUNT, TALLY_MAX_SONGS, TALLY_RECENT_LISTENS } from '../shared/blendDecay.js';
import { identityKey } from '../shared/identity.js';
import type { SongSnapshot } from '../shared/songRef.js';

export interface TallySong {
  readonly identity: string;
  readonly ref: string;
  readonly title: string;
  readonly artist: string;
  readonly artwork: string;
  readonly duration: number;
  readonly score: number;
}

export interface TallySeed {
  readonly song: SongSnapshot;
  readonly at: number;
}

/** A listener's most-played songs (PLAN.md §4.3). Every method is safe to repeat. */
export interface TasteTally {
  record(userId: string, song: SongSnapshot, secondsHeard: number, playedAt: number, playId?: string): Promise<boolean>;
  bonus(userId: string, song: SongSnapshot, kind: 'like' | 'unlike' | 'playlistAdd', at: number): Promise<void>;
  seed(userId: string, input: { likes: readonly TallySeed[]; items: readonly TallySeed[]; recents: readonly TallySeed[] }): Promise<void>;
  top(userId: string, limit: number): Promise<readonly TallySong[]>;
  clear(userId: string): Promise<void>;
}

interface TasteRow extends TallySong {
  readonly likeBonus: boolean;
  /** Original timestamp of the like so a later unlike reverses its exact decayed contribution. */
  readonly likeBonusAt?: number;
  readonly recentListens: readonly number[];
  readonly seedLikeBonusAt?: number;
  readonly playlistMemberships?: number;
  readonly recentPlayEvents: readonly { readonly playId: string; readonly maxSeconds: number; readonly playedAt: number }[];
  readonly updatedAt: number;
}

interface TasteMeta {
  readonly songCount: number;
  readonly seededAt?: number;
  readonly updatedAt: number;
}

type TasteMark = {
  readonly likeBonus?: boolean;
  readonly likeBonusAt?: number | undefined;
  readonly recentListens?: readonly number[];
  readonly seedLikeBonusAt?: number | undefined;
  readonly playlistMemberships?: number;
  readonly recentPlayEvents?: readonly { readonly playId: string; readonly maxSeconds: number; readonly playedAt: number }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local/test implementation of the same rules as convex/taste.ts. */
export class MemoryTasteTally implements TasteTally {
  private readonly rows = new Map<string, Map<string, TasteRow>>();
  private readonly metadata = new Map<string, TasteMeta>();

  public constructor(private readonly now: () => number = Date.now) {}

  public async record(userId: string, song: SongSnapshot, secondsHeard: number, playedAt: number, playId?: string): Promise<boolean> {
    const now = this.now();
    if (!Number.isFinite(playedAt) || !Number.isFinite(secondsHeard)) return false;
    const at = Math.min(playedAt, now);
    if (now - at > 30 * DAY_MS) return false;
    const identity = identityKey(song.title, song.artist);
    const row = this.rows.get(userId)?.get(identity);
    let amount = listenAmount(secondsHeard, song.duration);
    let recentPlayEvents = row?.recentPlayEvents ?? [];
    const identityAt = playedAt;
    let signalAt = at;
    if (playId) {
      if (playId.length > 128) return false;
      const prior = recentPlayEvents.find((event) => event.playId === playId);
      if (prior) {
        if (secondsHeard <= prior.maxSeconds) return false;
        amount -= listenAmount(prior.maxSeconds, song.duration);
        signalAt = prior.playedAt;
        recentPlayEvents = recentPlayEvents.filter((event) => event.playId !== playId);
      } else if (row?.recentListens.includes(identityAt)) return false;
      recentPlayEvents = [...recentPlayEvents, { playId, maxSeconds: secondsHeard, playedAt: signalAt }].slice(-16);
    } else if (row?.recentListens.includes(identityAt)) return false;
    const recentListens = playId ? (row?.recentListens ?? []) : [...(row?.recentListens ?? []), identityAt].slice(-TALLY_RECENT_LISTENS);
    this.addToRow(userId, song, amount, signalAt, { recentListens, ...(playId ? { recentPlayEvents } : {}) });
    return true;
  }

  public async bonus(userId: string, song: SongSnapshot, kind: 'like' | 'unlike' | 'playlistAdd', at: number): Promise<void> {
    const identity = identityKey(song.title, song.artist);
    const row = this.rows.get(userId)?.get(identity);
    if (kind === 'like') {
      if (row?.likeBonus) return;
      this.addToRow(userId, song, TALLY_AMOUNT.likeBonus, at, { likeBonus: true, likeBonusAt: at });
      return;
    }
    if (kind === 'unlike') {
      if (!row?.likeBonus) return;
      this.addToRow(userId, song, -TALLY_AMOUNT.likeBonus, row.likeBonusAt ?? at, {
        likeBonus: false,
        likeBonusAt: undefined,
        seedLikeBonusAt: undefined
      });
      return;
    }
    this.addToRow(userId, song, TALLY_AMOUNT.playlistAdd, at);
  }

  public async seed(
    userId: string,
    input: { likes: readonly TallySeed[]; items: readonly TallySeed[]; recents: readonly TallySeed[] }
  ): Promise<void> {
    if (this.metadata.get(userId)?.seededAt !== undefined) return;
    if (input.likes.length > 200 || input.items.length > 300 || input.recents.length > 25) {
      throw new Error('Taste seed exceeds its maximum size');
    }
    for (const item of input.likes) {
      const row = this.rows.get(userId)?.get(identityKey(item.song.title, item.song.artist));
      if (!row?.likeBonus) this.addToRow(userId, item.song, TALLY_AMOUNT.likeBonus, item.at, { likeBonus: true, likeBonusAt: item.at, seedLikeBonusAt: item.at });
    }
    for (const item of input.items) this.addToRow(userId, item.song, TALLY_AMOUNT.playlistAdd, item.at);
    for (const item of input.recents) this.addToRow(userId, item.song, TALLY_AMOUNT.seedRecent, item.at);
    const metadata = this.ensureMeta(userId);
    this.metadata.set(userId, { ...metadata, seededAt: this.now(), updatedAt: this.now() });
  }

  public async top(userId: string, limit: number): Promise<readonly TallySong[]> {
    const count = Math.max(0, Math.min(TALLY_MAX_SONGS, Math.floor(limit)));
    return [...(this.rows.get(userId)?.values() ?? [])]
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map(({ identity, ref, title, artist, artwork, duration, score }) => ({ identity, ref, title, artist, artwork, duration, score }));
  }

  public async clear(userId: string): Promise<void> {
    this.rows.delete(userId);
    this.metadata.delete(userId);
  }

  private addToRow(userId: string, song: SongSnapshot, amount: number, at: number, mark: TasteMark = {}): void {
    const identity = identityKey(song.title, song.artist);
    const userRows = this.rows.get(userId);
    const row = userRows?.get(identity);
    const score = addDecayed(row?.score ?? 0, amount, at);
    const now = this.now();

    if (!row && score <= 0) return;
    if (row && score <= 0) {
      userRows?.delete(identity);
      const metadata = this.ensureMeta(userId);
      this.metadata.set(userId, { ...metadata, songCount: Math.max(0, metadata.songCount - 1), updatedAt: now });
      return;
    }

    const likeBonusAt = Object.hasOwn(mark, 'likeBonusAt') ? mark.likeBonusAt : row?.likeBonusAt;
    const seedLikeBonusAt = Object.hasOwn(mark, 'seedLikeBonusAt') ? mark.seedLikeBonusAt : row?.seedLikeBonusAt;
    const next: TasteRow = {
      identity,
      ref: song.ref,
      title: song.title,
      artist: song.artist,
      artwork: song.artwork,
      duration: song.duration,
      score,
      likeBonus: mark.likeBonus ?? row?.likeBonus ?? false,
      ...(likeBonusAt !== undefined ? { likeBonusAt } : {}),
      ...(seedLikeBonusAt !== undefined ? { seedLikeBonusAt } : {}),
      ...(mark.playlistMemberships !== undefined ? { playlistMemberships: mark.playlistMemberships } : row?.playlistMemberships !== undefined ? { playlistMemberships: row.playlistMemberships } : {}),
      recentPlayEvents: mark.recentPlayEvents ?? row?.recentPlayEvents ?? [],
      recentListens: mark.recentListens ?? row?.recentListens ?? [],
      updatedAt: now
    };

    if (row) {
      userRows?.set(identity, next);
      const metadata = this.ensureMeta(userId);
      this.metadata.set(userId, { ...metadata, updatedAt: now });
      return;
    }

    const rows = userRows ?? new Map<string, TasteRow>();
    rows.set(identity, next);
    this.rows.set(userId, rows);
    let metadata = this.ensureMeta(userId);
    metadata = { ...metadata, songCount: metadata.songCount + 1, updatedAt: now };
    this.metadata.set(userId, metadata);
    this.evictIfOver(userId);
  }

  private ensureMeta(userId: string): TasteMeta {
    const current = this.metadata.get(userId);
    if (current) return current;
    const created = { songCount: 0, updatedAt: this.now() };
    this.metadata.set(userId, created);
    return created;
  }

  private evictIfOver(userId: string): void {
    const rows = this.rows.get(userId);
    let metadata = this.ensureMeta(userId);
    while (metadata.songCount > TALLY_MAX_SONGS) {
      let lowest: TasteRow | undefined;
      for (const row of rows?.values() ?? []) {
        if (!lowest || row.score < lowest.score) lowest = row;
      }
      if (!lowest) {
        metadata = { ...metadata, songCount: 0, updatedAt: this.now() };
        break;
      }
      rows?.delete(lowest.identity);
      metadata = { ...metadata, songCount: metadata.songCount - 1, updatedAt: this.now() };
    }
    this.metadata.set(userId, metadata);
  }
}
