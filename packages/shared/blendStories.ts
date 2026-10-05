/**
 * Which story cards a Blend shows, and the maths behind each (PLAN.md §4.6 stories, W5). Every card
 * reads from the same numbers as the match, so each one can be explained. `storiesFor` is the only
 * place that decides which cards exist; the apps map each `Story` to a component.
 */
import { affinity, enjoyment, explainChange } from './blendMatch';
import type { ArtistFactsMap, BlendTrack, ChangeReason, MemberTaste, PairMatch } from './blendTypes';
import type { SongSnapshot } from './songRef';

export const STORY = {
  songPopularityDivisor: 8,
  songPopularityWeight: 0.3,
  togetherMin: 0.5,
  closestMin: 0.3,
  candidatesForPopularity: 20,
  giftMaxEnjoy: 0.5,
  /** An artist B likes at least this much makes a similar artist a plausible gift. */
  giftSimilarAffinity: 0.5,
  /** The group's glue: artists with at least this affinity for at least half the members. */
  glueAffinity: 0.5,
  glueMax: 5,
  pairMax: 6,
  groupMax: 4,
  unknownSongPopularity: 0.5
} as const;

export type Story =
  | { readonly kind: 'match'; readonly match: number; readonly confidence: 'normal' | 'low'; readonly change: ChangeReason | null }
  | { readonly kind: 'song'; readonly variant: 'together' | 'closest'; readonly identity: string; readonly song?: SongSnapshot }
  | { readonly kind: 'directions'; readonly youEnjoyTheirs: number; readonly theyEnjoyYours: number; readonly otherUserId: string }
  | { readonly kind: 'artist'; readonly artist: string }
  | { readonly kind: 'gift'; readonly fromUserId: string; readonly toUserId: string; readonly identity: string; readonly song?: SongSnapshot }
  | { readonly kind: 'brought'; readonly counts: readonly { readonly userId: string; readonly songs: number }[] }
  | { readonly kind: 'groupMatch'; readonly match: number }
  | { readonly kind: 'mostInTune' | 'leastInTune'; readonly userId: string; readonly match: number }
  | { readonly kind: 'glue'; readonly artists: readonly string[] };

/** A person's enjoyment of a song: 1 for their own, otherwise the match's enjoyment. */
function enjoys(member: MemberTaste, identity: string, lead: string, facts: ArtistFactsMap): number {
  return member.songs.has(identity) ? 1 : enjoyment(identity, lead, member, facts);
}

function leadIn(a: MemberTaste, b: MemberTaste, identity: string): string {
  return a.songArtist.get(identity) ?? b.songArtist.get(identity) ?? '';
}

/** clamp(log10(1 + plays) / 8, 0, 1): 100 M plays → 1. */
export function songPopularity(playCount: number | undefined): number {
  if (playCount === undefined || !Number.isFinite(playCount)) return STORY.unknownSongPopularity;
  return Math.min(1, Math.max(0, Math.log10(1 + Math.max(0, playCount)) / STORY.songPopularityDivisor));
}

/**
 * The best candidates for "the song that brings you together" before popularity is known, so the
 * caller looks up play counts for these 20 only.
 */
export function togetherCandidates(a: MemberTaste, b: MemberTaste, facts: ArtistFactsMap, limit: number = STORY.candidatesForPopularity): string[] {
  const scored: [string, number][] = [];
  for (const identity of new Set([...a.songs.keys(), ...b.songs.keys()])) {
    const lead = leadIn(a, b, identity);
    const both = Math.min(enjoys(a, identity, lead, facts), enjoys(b, identity, lead, facts));
    const score = ((a.songs.get(identity) ?? 0) + (b.songs.get(identity) ?? 0)) * both;
    if (score > 0) scored.push([identity, score]);
  }
  return scored.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, limit).map(([identity]) => identity);
}

/**
 * together(i) = (pA + pB) × min(enjoyA, enjoyB) × (1 − 0.3 × songPopularity). Null when even the
 * best song is one neither would really enjoy (min enjoyment below 0.3).
 */
export function togetherSong(a: MemberTaste, b: MemberTaste, facts: ArtistFactsMap, playCounts: ReadonlyMap<string, number>): { identity: string; variant: 'together' | 'closest' } | null {
  let best: { identity: string; both: number } | null = null;
  let bestScore = 0;
  for (const identity of togetherCandidates(a, b, facts)) {
    const lead = leadIn(a, b, identity);
    const both = Math.min(enjoys(a, identity, lead, facts), enjoys(b, identity, lead, facts));
    const score = ((a.songs.get(identity) ?? 0) + (b.songs.get(identity) ?? 0)) * both
      * (1 - STORY.songPopularityWeight * songPopularity(playCounts.get(identity)));
    if (score > bestScore) {
      bestScore = score;
      best = { identity, both };
    }
  }
  if (!best || best.both < STORY.closestMin) return null;
  return { identity: best.identity, variant: best.both >= STORY.togetherMin ? 'together' : 'closest' };
}

/** `from`'s favourite song `to` hasn't got and wouldn't already love, by an artist similar to one `to` likes. */
export function giftFor(from: MemberTaste, to: MemberTaste, facts: ArtistFactsMap): string | null {
  const ranked = [...from.songs].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  for (const [identity] of ranked) {
    const lead = from.songArtist.get(identity) ?? '';
    if (!lead || enjoyment(identity, lead, to, facts) >= STORY.giftMaxEnjoy) continue;
    const similar = facts.get(lead)?.similar ?? [];
    if (similar.some((artist) => affinity(to, artist) >= STORY.giftSimilarAffinity)) return identity;
  }
  return null;
}

/** Artists at least half the members like (affinity ≥ 0.5), most shared first. */
export function groupGlue(members: readonly MemberTaste[]): string[] {
  const needed = Math.ceil(members.length / 2);
  const counts = new Map<string, { members: number; total: number }>();
  for (const member of members) {
    for (const [artist, share] of member.artists) {
      if (affinity(member, artist) < STORY.glueAffinity) continue;
      const seen = counts.get(artist) ?? { members: 0, total: 0 };
      counts.set(artist, { members: seen.members + 1, total: seen.total + share });
    }
  }
  return [...counts]
    .filter(([, { members: holders }]) => holders >= needed)
    .sort((x, y) => y[1].members - x[1].members || y[1].total - x[1].total || (x[0] < y[0] ? -1 : 1))
    .slice(0, STORY.glueMax)
    .map(([artist]) => artist);
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function storiesFor(input: {
  readonly viewerId: string;
  readonly members: readonly { readonly userId: string; readonly joinedAt: number }[];
  readonly pairs: readonly PairMatch[];
  readonly previousPairs: readonly PairMatch[];
  readonly together: { readonly identity: string; readonly variant: 'together' | 'closest'; readonly song?: SongSnapshot } | null;
  readonly gifts: readonly { readonly fromUserId: string; readonly toUserId: string; readonly identity: string; readonly song?: SongSnapshot }[];
  readonly tracks: readonly BlendTrack[];
  readonly glue: readonly string[];
}): Story[] {
  const members = [...input.members].sort((x, y) => x.joinedAt - y.joinedAt || (x.userId < y.userId ? -1 : 1));
  const previous = new Map(input.previousPairs.map((pair) => [pairKey(pair.a, pair.b), pair]));

  if (members.length <= 2) {
    const pair = input.pairs[0];
    if (!pair) return [];
    const stories: Story[] = [{ kind: 'match', match: pair.match, confidence: pair.confidence, change: explainChange(previous.get(pairKey(pair.a, pair.b)), pair) }];
    if (input.together) {
      const { variant, identity, song } = input.together;
      stories.push({ kind: 'song', variant, identity, ...(song ? { song } : {}) });
    }
    const viewerIsA = pair.a === input.viewerId;
    const viewerIsMember = viewerIsA || pair.b === input.viewerId;
    if (viewerIsMember) {
      stories.push({
        kind: 'directions',
        youEnjoyTheirs: Math.round(100 * (viewerIsA ? pair.cover.b : pair.cover.a)),
        theyEnjoyYours: Math.round(100 * (viewerIsA ? pair.cover.a : pair.cover.b)),
        otherUserId: viewerIsA ? pair.b : pair.a
      });
    }
    if (pair.together) stories.push({ kind: 'artist', artist: pair.together });
    for (const gift of input.gifts) stories.push({ kind: 'gift', ...gift });
    stories.push({
      kind: 'brought',
      counts: members.map(({ userId }) => ({ userId, songs: input.tracks.filter((track) => track.for.includes(userId)).length }))
    });
    return stories.slice(0, STORY.pairMax);
  }

  const stories: Story[] = [];
  if (input.pairs.length > 0) {
    stories.push({ kind: 'groupMatch', match: Math.round(input.pairs.reduce((total, pair) => total + pair.match, 0) / input.pairs.length) });
  }
  const mine = members
    .filter(({ userId }) => userId !== input.viewerId)
    .flatMap(({ userId }) => {
      const pair = input.pairs.find((p) => pairKey(p.a, p.b) === pairKey(userId, input.viewerId));
      return pair ? [{ userId, match: pair.match }] : [];
    });
  // `mine` is in join order, so a strict comparison leaves ties with whoever joined first.
  if (mine.length > 0) {
    const most = mine.reduce((best, entry) => (entry.match > best.match ? entry : best));
    const least = mine.reduce((worst, entry) => (entry.match < worst.match ? entry : worst));
    stories.push({ kind: 'mostInTune', ...most });
    stories.push({ kind: 'leastInTune', ...least });
  }
  if (input.glue.length > 0) stories.push({ kind: 'glue', artists: input.glue });
  return stories.slice(0, STORY.groupMax);
}
