// GENERATED from packages/shared/blendBuild.ts by `npm run sync:shared`. Do not edit here.
/**
 * The daily Blend track list (PLAN.md §4.7): greedy Nash welfare over predicted enjoyment. Each
 * step picks the song that most raises Σ log(1 + enjoyment / (1 + enjoyment so far)), so a member
 * who is behind gains most from the next song and the list stays fair without fixed turns, while a
 * song several members love counts for each of them.
 *
 * Deterministic: the only variety is a small per-song jitter seeded by `blendId:builtFor`, so every
 * member sees the same list on the same day. No clock, no Math.random.
 */
import { enjoyment } from './blendMatch.js';
import type { ArtistFactsMap, BlendTrack, MemberTaste } from './blendTypes.js';
import { artistKey, creditedArtists } from './identity.js';
import type { SongSnapshot } from './songRef.js';

export const BUILD = {
  size: 50,
  minUseful: 10,
  ownBase: 0.6,
  ownSpan: 0.4,
  favouriteRank: 10,
  spacingWindow: 4,
  spacingPenalty: 0.3,
  freshnessPenalty: 0.5,
  noise: 0.03,
  candidatesPerMember: 300,
  discoveryMax: 50
} as const;

/** 32-bit FNV-1a hash of a string. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A small, fast seeded PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** p of the member's 10th favourite song (or their last, with fewer than 10). */
function favouriteThreshold(member: MemberTaste): number {
  const ranked = [...member.songs.values()].sort((a, b) => b - a);
  return ranked[Math.min(BUILD.favouriteRank - 1, ranked.length - 1)] ?? 0;
}

/**
 * How much `member` would enjoy a track: their own songs grade 0.6 → 1 by how close they are to a
 * top-10 favourite; anything else is the match's enjoyment (same artist, similar artist, language).
 */
export function enjoyFor(identity: string, leadArtist: string, member: MemberTaste, facts: ArtistFactsMap, favourite = favouriteThreshold(member)): number {
  const own = member.songs.get(identity);
  if (own !== undefined) return BUILD.ownBase + BUILD.ownSpan * Math.min(1, favourite > 0 ? own / favourite : 1);
  return enjoyment(identity, leadArtist, member, facts);
}

export interface BuildInput {
  readonly members: readonly MemberTaste[];
  /** Every candidate identity's snapshot (Saavn-resolved); identities without one are skipped. */
  readonly songs: ReadonlyMap<string, SongSnapshot>;
  /** Discovery identities (catalog suggestions), at most 50 used. */
  readonly discovery: readonly string[];
  readonly facts: ArtistFactsMap;
  /** Identities in the last two builds. */
  readonly previous: ReadonlySet<string>;
  /** `blendId:builtFor`. */
  readonly seed: string;
}

function leadOf(identity: string, members: readonly MemberTaste[], song: SongSnapshot): string {
  for (const member of members) {
    const lead = member.songArtist.get(identity);
    if (lead) return lead;
  }
  return artistKey(creditedArtists(song.artist)[0] ?? '');
}

export function buildBlend(input: BuildInput): readonly BlendTrack[] {
  const { members, facts } = input;

  // Candidates: each member's top songs by p, then discovery; only songs that can be shown and played.
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (identity: string): void => {
    if (seen.has(identity) || !input.songs.has(identity)) return;
    seen.add(identity);
    order.push(identity);
  };
  for (const member of members) {
    const top = [...member.songs].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, BUILD.candidatesPerMember);
    for (const [identity] of top) add(identity);
  }
  for (const identity of input.discovery.slice(0, BUILD.discoveryMax)) add(identity);

  const count = order.length;
  const leads = order.map((identity) => leadOf(identity, members, input.songs.get(identity) as SongSnapshot));
  const holders = order.map((identity) => members.filter((member) => member.songs.has(identity)).map((member) => member.userId));
  const enjoy = members.map((member) => {
    const favourite = favouriteThreshold(member);
    const row = new Float64Array(count);
    order.forEach((identity, i) => { row[i] = enjoyFor(identity, leads[i] ?? '', member, facts, favourite); });
    return row;
  });
  const factor = new Float64Array(count);
  order.forEach((identity, i) => {
    const jitter = mulberry32(fnv1a(`${input.seed}|${identity}`))() * 2 - 1;
    const heldByAll = members.length > 0 && (holders[i]?.length ?? 0) === members.length;
    const fresh = input.previous.has(identity) && !heldByAll ? BUILD.freshnessPenalty : 1;
    factor[i] = fresh * (1 + BUILD.noise * jitter);
  });

  const used = new Uint8Array(count);
  const totals = members.map(() => 0);
  const chosen: number[] = [];
  const target = Math.min(BUILD.size, count);
  while (chosen.length < target) {
    const recent = chosen.slice(-BUILD.spacingWindow).map((i) => leads[i]);
    // Hard rule: no lead artist twice within any 4 consecutive tracks while another artist is left.
    const blocked = new Set(chosen.slice(-(BUILD.spacingWindow - 1)).map((i) => leads[i]));
    let anyOpen = false;
    for (let i = 0; i < count; i++) {
      if (!used[i] && !blocked.has(leads[i])) {
        anyOpen = true;
        break;
      }
    }
    let best = -1;
    let bestGain = -Infinity;
    for (let i = 0; i < count; i++) {
      if (used[i] || (anyOpen && blocked.has(leads[i]))) continue;
      let gain = 0;
      for (let m = 0; m < members.length; m++) gain += Math.log1p((enjoy[m]?.[i] ?? 0) / (1 + (totals[m] ?? 0)));
      const spacing = recent.includes(leads[i]) ? BUILD.spacingPenalty : 1;
      gain *= spacing * (factor[i] ?? 1);
      if (gain > bestGain) {
        bestGain = gain;
        best = i;
      }
    }
    if (best < 0) break;
    used[best] = 1;
    chosen.push(best);
    for (let m = 0; m < members.length; m++) totals[m] = (totals[m] ?? 0) + (enjoy[m]?.[best] ?? 0);
  }

  return chosen.map((i): BlendTrack => {
    const identity = order[i] as string;
    const forWho = holders[i] ?? [];
    return {
      song: input.songs.get(identity) as SongSnapshot,
      for: forWho,
      kind: forWho.length >= 2 ? 'shared' : forWho.length === 1 ? 'pick' : 'discovery'
    };
  });
}
