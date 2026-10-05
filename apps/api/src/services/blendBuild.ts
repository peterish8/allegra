/**
 * Builds and shapes a Blend (PLAN.md B4). A Blend rebuilds only when a member opens it and its
 * build is for an earlier UTC day or its membership changed (D7); otherwise opening it reads one
 * document. A build loads each member's tally, likes and playlist songs (bounded), turns them into
 * taste distributions, scores every pair, picks the day's tracks and saves them with
 * compare-and-set, so two members opening it at once save one build.
 *
 * Everything outbound degrades: missing artist facts fall back, discovery and play counts are
 * optional, and the whole build is held to a deadline. Logs carry counts and timings only.
 */
import { randomUUID } from 'node:crypto';
import type { CatalogService } from '../catalog/catalog.js';
import { BUILD, buildBlend } from '../shared/blendBuild.js';
import { currentWeight } from '../shared/blendDecay.js';
import { BLEND_MIN_TRACKS, initialsOf, utcDay } from '../shared/blendLimits.js';
import { explainChange, pairMatch } from '../shared/blendMatch.js';
import { giftFor, groupGlue, storiesFor, togetherCandidates, togetherSong } from '../shared/blendStories.js';
import { memberTaste } from '../shared/blendTaste.js';
import type { ArtistFacts, ArtistFactsMap, MemberTaste, PairMatch, TasteItem } from '../shared/blendTypes.js';
import type { BlendDetail, BlendMemberView } from '../shared/blendView.js';
import { identityKey } from '../shared/identity.js';
import { parseSongRef, toAllegraId, type SongSnapshot } from '../shared/songRef.js';
import type { BlendMemberRecord, BlendStore, StoredBlend, StoredGift, StoredStorySong } from '../user/blendStore.js';
import type { LibraryEntry, LibraryStore } from '../user/library.js';
import { snapshotOf } from '../user/libraryOps.js';
import type { UserData } from '../user/store.js';
import type { TasteTally } from '../user/tasteTally.js';
import type { ArtistFactsService } from './artistFacts.js';
import type { ImportMatcher } from './importMatch.js';

export const BLEND_BUILD = {
  budgetMs: 8000,
  factsBudgetMs: 3000,
  factsPerMember: 30,
  discoverySeeds: 3,
  discoveryPerSeed: 20,
  playCountLookups: 20,
  likesRead: 1000,
  itemsRead: 300,
  tallyRead: 200,
  /** Gaana-only candidates resolved to Saavn per member, through the cached import matcher. */
  resolvePerMember: 60,
  /** D6 cold start: at most this many native likes / playlist songs / recent listens. */
  seedLikes: 200,
  seedItems: 300,
  seedRecents: 25
} as const;

export interface BlendBuildDeps {
  readonly blends: BlendStore;
  readonly tally: TasteTally;
  readonly library: () => LibraryStore;
  readonly facts: Pick<ArtistFactsService, 'facts'>;
  readonly catalog: Pick<CatalogService, 'getSuggestions' | 'getSongs'>;
  readonly resolver: Pick<ImportMatcher, 'match'>;
  readonly now?: () => number;
  readonly log?: (fields: Record<string, number>) => void;
  /** Tests shorten the deadlines. */
  readonly budgets?: { readonly budgetMs?: number; readonly factsBudgetMs?: number };
}

/** A member's loaded data: the taste layers plus a playable snapshot per identity. */
interface Loaded {
  readonly member: BlendMemberRecord;
  readonly now: TasteItem[];
  readonly loved: TasteItem[];
  readonly kept: TasteItem[];
  /** identity → Saavn snapshot (D15); Gaana-only identities are resolved or left out. */
  readonly playable: Map<string, SongSnapshot>;
  /** identity → snapshot of a Gaana-only song still to resolve. */
  readonly gaanaOnly: Map<string, SongSnapshot>;
}

const isSaavn = (snapshot: SongSnapshot): boolean => parseSongRef(snapshot.ref)?.source === 'saavn';

/** Resolves `fallback` when `work` has not settled within `ms`; a rejection also gives the fallback. */
async function within<T>(ms: number, work: () => Promise<T>, fallback: T): Promise<T> {
  if (ms <= 0) return fallback;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  try {
    return await Promise.race([work().catch(() => fallback), late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Mandatory inputs cannot be silently converted into empty libraries. */
async function bounded<T>(ms: number, work: () => Promise<T>): Promise<T> {
  if (ms <= 0) throw new Error('Blend deadline reached');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Blend deadline reached')), ms);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class BlendBuildService {
  private readonly now: () => number;
  private readonly budgetNow = (): number => performance.now();

  public constructor(private readonly deps: BlendBuildDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** The Blend as `viewerId` sees it, rebuilt first when due. Null for a non-member or no Blend. */
  public async detailFor(blendId: string, viewerId: string): Promise<BlendDetail | null> {
    const budget = this.deps.budgets?.budgetMs ?? BLEND_BUILD.budgetMs;
    const deadline = this.budgetNow() + budget;
    const blend = await bounded(budget, () => this.deps.blends.get(blendId, viewerId));
    if (!blend) return null;
    const today = utcDay(this.now());
    if (blend.builtFor === today && !blend.stale) return shape(blend, viewerId);
    if (blend.members.length < 2) return shape(blend, viewerId);
    const leaseToken = randomUUID();
    const { claimed } = await bounded(deadline - this.budgetNow(), () => this.deps.blends.claimBuild({
      blendId, userId: viewerId, inputVersion: blend.inputVersion ?? 0, builtFor: today,
      token: leaseToken, leaseUntil: this.now() + budget + 1000
    }));
    if (!claimed) {
      const current = await bounded(deadline - this.budgetNow(), () => this.deps.blends.get(blendId, viewerId));
      return current ? { ...shape(current, viewerId), stale: true, status: current.members.length < 2 ? 'waiting' : 'refreshing' } : null;
    }
    try {
      const saved = await this.build(blend, today, viewerId, deadline - Math.min(250, budget / 10), leaseToken);
      if (saved) return shape(saved, viewerId);
    } catch {
      // A failed build leaves yesterday's list in place; the next open tries again.
    } finally {
      await within(deadline - this.budgetNow(), () => this.deps.blends.releaseBuild(blendId, leaseToken), undefined);
    }
    // Re-read membership/privacy before fallback. Never expose the original snapshot on failure.
    const stored = await bounded(deadline - this.budgetNow(), () => this.deps.blends.get(blendId, viewerId));
    return stored ? { ...shape(stored, viewerId), stale: true, status: stored.members.length < 2 ? 'waiting' : 'refreshing' } : null;
  }

  /**
   * D6: the first time a listener takes a Blend action, their tally starts from what they already
   * did on Allegra: native likes +10, native playlist songs +5, the last 25 listens +3, at their
   * real times. Imported likes and playlists are never seeded. The tally ignores a second seed.
   */
  public async seedTally(user: UserData): Promise<void> {
    const library = this.deps.library();
    const [likes, items] = await Promise.all([
      library.recentLikes(user.userId, BLEND_BUILD.seedLikes),
      library.recentItems(user.userId, BLEND_BUILD.seedItems)
    ]);
    const native = (rows: readonly LibraryEntry[]) =>
      rows.flatMap((row) => (row.origin !== 'import' && row.song ? [{ song: row.song, at: row.at }] : []));
    const recents = user.recentlyPlayed
      .slice(0, BLEND_BUILD.seedRecents)
      .flatMap((recent) => {
        const at = Date.parse(recent.playedAt);
        return recent.song && Number.isFinite(at) ? [{ song: recent.song, at }] : [];
      });
    await this.deps.tally.seed(user.userId, { likes: native(likes), items: native(items), recents });
  }

  private async build(blend: StoredBlend, today: string, viewerId: string, deadline: number, leaseToken: string): Promise<StoredBlend | null> {
    const started = this.budgetNow();
    const factsBudget = this.deps.budgets?.factsBudgetMs ?? BLEND_BUILD.factsBudgetMs;
    const left = (): number => deadline - this.budgetNow();
    const optionalLeft = (): number => Math.max(0, left() - Math.min(200, (this.deps.budgets?.budgetMs ?? BLEND_BUILD.budgetMs) / 4));

    // 1. Load every member in parallel.
    const loaded = await bounded(left(), () => Promise.all(blend.members.map((member) => this.load(member))));

    // 2. Gaana-only candidates: resolve to Saavn through the cached matcher, or drop them (D15).
    let unresolved = 0;
    await Promise.all(loaded.map(async (data) => {
      const pending = [...data.gaanaOnly].slice(0, BLEND_BUILD.resolvePerMember);
      unresolved += Math.max(0, data.gaanaOnly.size - pending.length);
      if (pending.length === 0) return;
      const results = await within(optionalLeft(), () => this.deps.resolver.match(pending.map(([, song]) => ({
        title: song.title,
        artist: song.artist,
        ...(song.duration > 0 ? { durationSec: song.duration } : {})
      }))), []);
      pending.forEach(([identity], index) => {
        const song = results.find((result) => result.index === index)?.song;
        if (song) data.playable.set(identity, song);
        else unresolved += 1;
      });
    }));

    // 3. Taste distributions; artist facts for each member's top artists.
    const provisional = loaded.map((data) => this.taste(data, new Map()));
    const keys = provisional.flatMap((taste) => [...taste.artists].sort((a, b) => b[1] - a[1]).slice(0, BLEND_BUILD.factsPerMember).map(([key]) => key));
    const facts: ArtistFactsMap = await within(Math.min(factsBudget, optionalLeft()), () => this.deps.facts.facts(keys, Math.min(factsBudget, optionalLeft())), new Map<string, ArtistFacts>());
    const tastes = loaded.map((data) => this.taste(data, facts));

    // 4. Every pair.
    const pairs: PairMatch[] = [];
    for (let i = 0; i < tastes.length; i++) {
      for (let j = i + 1; j < tastes.length; j++) pairs.push(pairMatch(tastes[i] as MemberTaste, tastes[j] as MemberTaste, facts));
    }

    // 5. Candidates: every playable identity, plus discovery from the best shared songs.
    const songs = new Map<string, SongSnapshot>();
    for (const data of loaded) for (const [identity, song] of data.playable) if (!songs.has(identity)) songs.set(identity, song);
    const suggested = await within(optionalLeft(), () => this.discovery(tastes, songs), [] as [string, SongSnapshot][]);
    for (const [identity, song] of suggested) if (!songs.has(identity)) songs.set(identity, song);
    const discovery = suggested.map(([identity]) => identity);

    // 6. The day's tracks.
    const tracks = buildBlend({
      members: tastes,
      songs,
      discovery,
      facts,
      previous: new Set(blend.previousTracks),
      seed: `${blend.id}:${today}`
    });

    // 7. Story inputs.
    let together: StoredStorySong | undefined;
    const gifts: StoredGift[] = [];
    const [first, second] = tastes;
    if (tastes.length === 2 && first && second) {
      const playCounts = await within(optionalLeft(), () => this.playCounts(togetherCandidates(first, second, facts, BLEND_BUILD.playCountLookups), songs), new Map<string, number>());
      const song = togetherSong(first, second, facts, playCounts);
      const snapshot = song ? songs.get(song.identity) : undefined;
      if (song && snapshot) together = { ...song, song: snapshot };
      for (const [from, to] of [[first, second], [second, first]] as const) {
        const identity = giftFor(from, to, facts);
        const gift = identity ? songs.get(identity) : undefined;
        if (identity && gift) gifts.push({ fromUserId: from.userId, toUserId: to.userId, identity, song: gift });
      }
    }
    const glue = tastes.length > 2 ? groupGlue(tastes) : [];

    const identities = tracks.map((track) => identityKey(track.song.title, track.song.artist));
    const { saved } = await bounded(left(), () => this.deps.blends.saveBuild({
      blendId: blend.id,
      expectedVersion: blend.buildVersion,
      expectedInputVersion: blend.inputVersion ?? 0,
      leaseToken,
      builtFor: today,
      tracks,
      pairs,
      ...(together ? { together } : {}),
      gifts,
      glue,
      identities
    }));
    this.deps.log?.({ members: tastes.length, candidates: songs.size, unresolved, tracks: tracks.length, ms: this.budgetNow() - started });
    if (!saved) return null;
    return bounded(left(), () => this.deps.blends.get(blend.id, viewerId));
  }

  private async load(member: BlendMemberRecord): Promise<Loaded> {
    const now = this.now();
    const library = this.deps.library();
    const [tally, likes, items] = await Promise.all([
      member.learning ? this.deps.tally.top(member.userId, BLEND_BUILD.tallyRead) : Promise.resolve([]),
      library.recentLikes(member.userId, BLEND_BUILD.likesRead),
      library.recentItems(member.userId, BLEND_BUILD.itemsRead)
    ]);
    const playable = new Map<string, SongSnapshot>();
    const gaanaOnly = new Map<string, SongSnapshot>();
    const note = (identity: string, song: SongSnapshot): void => {
      if (isSaavn(song)) {
        playable.set(identity, song);
        gaanaOnly.delete(identity);
      } else if (!playable.has(identity)) {
        gaanaOnly.set(identity, song);
      }
    };
    const layer = (rows: readonly LibraryEntry[]): TasteItem[] => rows.flatMap((row) => {
      // A row synced without its snapshot cannot be named, so it cannot join a Blend.
      if (!row.song) return [];
      const identity = identityKey(row.song.title, row.song.artist);
      note(identity, row.song);
      return [{ identity, artist: row.song.artist }];
    });
    const nowLayer = tally.flatMap((row): TasteItem[] => {
      const weight = currentWeight(row.score, now);
      if (!(weight >= 0.05)) return [];
      const ref = parseSongRef(row.ref);
      if (ref) note(row.identity, { ref: `${ref.source}:${ref.id}`, title: row.title, artist: row.artist, artwork: row.artwork, duration: row.duration });
      return [{ identity: row.identity, artist: row.artist, weight }];
    });
    return { member, now: nowLayer, loved: layer(likes), kept: layer(items), playable, gaanaOnly };
  }

  private taste(data: Loaded, facts: ArtistFactsMap): MemberTaste {
    return memberTaste({ userId: data.member.userId, now: data.now, loved: data.loved, kept: data.kept, learning: data.member.learning, facts });
  }

  /** Catalog suggestions for the best shared songs (by the smaller of the members' p). */
  private async discovery(tastes: readonly MemberTaste[], songs: ReadonlyMap<string, SongSnapshot>): Promise<[string, SongSnapshot][]> {
    if (tastes.length < 2) return [];
    const shared = [...songs.keys()]
      .map((identity) => {
        const holders = tastes.map((taste) => taste.songs.get(identity) ?? 0).filter((p) => p > 0);
        return { identity, holders: holders.length, score: holders.length >= 2 ? Math.min(...holders) : 0 };
      })
      .filter((entry) => entry.holders >= 2)
      .sort((a, b) => b.score - a.score || (a.identity < b.identity ? -1 : 1))
      .slice(0, BLEND_BUILD.discoverySeeds);
    const seeds = shared.length > 0 ? shared : tastes.flatMap((taste) => [...taste.songs]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .filter(([identity]) => songs.has(identity)).slice(0, 1).map(([identity, score]) => ({ identity, score, holders: 1 })))
      .filter((seed, index, all) => all.findIndex((item) => item.identity === seed.identity) === index)
      .slice(0, BLEND_BUILD.discoverySeeds);
    const batches = await Promise.all(seeds.map(async ({ identity }): Promise<[string, SongSnapshot][]> => {
      const seed = songs.get(identity);
      const id = seed ? toAllegraId(seed.ref) : null;
      if (!id) return [];
      try {
        const found: [string, SongSnapshot][] = [];
        for (const song of await this.deps.catalog.getSuggestions(id, BLEND_BUILD.discoveryPerSeed)) {
          const snapshot = snapshotOf(song);
          if (!snapshot || !isSaavn(snapshot)) continue;
          const key = identityKey(snapshot.title, snapshot.artist);
          if (songs.has(key)) continue;
          found.push([key, snapshot]);
        }
        return found;
      } catch {
        // No suggestions for this seed; the Blend is built from the members' own songs.
      }
      return [];
    }));
    const unique = new Map(batches.flat());
    return [...unique].sort(([a], [b]) => a.localeCompare(b)).slice(0, BUILD.discoveryMax);
  }

  /** Play counts for the best "together" candidates, from the cached batch song lookup. */
  private async playCounts(identities: readonly string[], songs: ReadonlyMap<string, SongSnapshot>): Promise<Map<string, number>> {
    const byId = new Map<string, string>();
    for (const identity of identities) {
      const song = songs.get(identity);
      const id = song ? toAllegraId(song.ref) : null;
      if (id) byId.set(id, identity);
    }
    const counts = new Map<string, number>();
    if (byId.size === 0) return counts;
    for (const song of await this.deps.catalog.getSongs([...byId.keys()])) {
      const identity = byId.get(song.id);
      if (identity && Number.isFinite(song.playCount)) counts.set(identity, song.playCount);
    }
    return counts;
  }
}

export function memberViews(members: readonly BlendMemberRecord[], viewerId: string): BlendMemberView[] {
  return members.map((member) => ({
    userId: member.userId,
    displayName: member.displayName,
    initials: initialsOf(member.displayName),
    isYou: member.userId === viewerId,
    learning: member.learning
  }));
}

/** The stored Blend as one viewer sees it. Cheap: no I/O. */
export function shape(blend: StoredBlend, viewerId: string): BlendDetail {
  const mine = blend.pairs.find((pair) => pair.a === viewerId || pair.b === viewerId);
  const previous = mine ? blend.previousPairs.find((pair) => pair.a === mine.a && pair.b === mine.b) : undefined;
  const change = mine ? explainChange(previous, mine) : null;
  return {
    id: blend.id,
    name: blend.name,
    ownerId: blend.ownerId,
    members: memberViews(blend.members, viewerId),
    pairs: blend.pairs,
    ...(change ? { change } : {}),
    tracks: blend.tracks,
    builtFor: blend.builtFor ?? '',
    buildVersion: blend.buildVersion,
    inputVersion: blend.inputVersion ?? 0,
    stale: blend.stale,
    status: blend.members.length < 2 ? 'waiting' : blend.stale ? 'refreshing' : blend.tracks.length >= BLEND_MIN_TRACKS ? 'ready' : 'not_enough',
    state: blend.tracks.length >= BLEND_MIN_TRACKS ? 'ready' : 'not_enough',
    stories: storiesFor({
      viewerId,
      members: blend.members,
      pairs: blend.pairs,
      previousPairs: blend.previousPairs,
      together: blend.together ?? null,
      gifts: blend.gifts ?? [],
      tracks: blend.tracks,
      glue: blend.glue ?? []
    })
  };
}
