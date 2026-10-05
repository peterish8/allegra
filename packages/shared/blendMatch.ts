/**
 * The Blend taste match (PLAN.md §4.6): how much of each other's music two people would enjoy.
 * Mutual coverage at four levels (same song, same artist, similar artist, same language), a
 * bounded bonus for sharing a niche artist, then shrinkage toward a neutral value when either
 * side has little data. Tested against the simulated listeners of `.planning/blend/match-sim.mjs`.
 *
 * Pure and deterministic: loops over Maps, no clock, no randomness.
 */
import type { ArtistFactsMap, ChangeReason, MemberTaste, PairMatch } from './blendTypes';

/** Every tuning constant, so tuning is one edit. */
export const MATCH = {
  level: { song: 1, artist: 0.85, similar: 0.4, language: 0.15 },
  fullAffinityShare: 0.02,
  languageShare: 0.1,
  rareBonus: 0.5,
  shrinkK: 8,
  prior: 0.2,
  gamma: 0.75,
  changeThreshold: 5,
  contributionsKept: 10,
  /** Popularity assumed for an artist the catalog told us nothing about. */
  unknownPopularity: 0.5,
  /** How much a superstar is discounted when choosing the artist that brings a pair together. */
  togetherPopularityWeight: 0.4
} as const;

/** 0–1: an artist that is 2% of the listener's taste counts as fully liked. */
export function affinity(listener: MemberTaste, artist: string): number {
  return Math.min(1, (listener.artists.get(artist) ?? 0) / MATCH.fullAffinityShare);
}

/** Would `listener` enjoy the song `identity` by `leadArtist`? The best of the four levels, 0–1. */
export function enjoyment(identity: string, leadArtist: string, listener: MemberTaste, facts: ArtistFactsMap): number {
  if (listener.songs.has(identity)) return MATCH.level.song;
  let best = MATCH.level.artist * affinity(listener, leadArtist);
  const known = facts.get(leadArtist);
  if (known) {
    for (const similar of known.similar) {
      best = Math.max(best, MATCH.level.similar * affinity(listener, similar));
    }
    if (known.language && (listener.languages.get(known.language) ?? 0) >= MATCH.languageShare) {
      best = Math.max(best, MATCH.level.language);
    }
  }
  return best;
}

/** The share of `from`'s taste that `by` would enjoy, and which of `from`'s artists it came through. */
export function coverage(from: MemberTaste, by: MemberTaste, facts: ArtistFactsMap): { value: number; contributions: Map<string, number> } {
  let value = 0;
  const contributions = new Map<string, number>();
  for (const [identity, p] of from.songs) {
    const lead = from.songArtist.get(identity) ?? '';
    const part = p * enjoyment(identity, lead, by, facts);
    value += part;
    if (lead && part > 0) contributions.set(lead, (contributions.get(lead) ?? 0) + part);
  }
  return { value, contributions };
}

function popularityOf(facts: ArtistFactsMap, artist: string): number {
  return facts.get(artist)?.popularity ?? MATCH.unknownPopularity;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function pairMatch(first: MemberTaste, second: MemberTaste, facts: ArtistFactsMap): PairMatch {
  const [a, b] = first.userId <= second.userId ? [first, second] : [second, first];
  const coverA = coverage(a, b, facts);
  const coverB = coverage(b, a, facts);

  let rare = 0;
  let together = '';
  let togetherScore = 0;
  for (const [artist, qa] of a.artists) {
    const shared = Math.min(qa, b.artists.get(artist) ?? 0);
    if (shared <= 0) continue;
    const popularity = popularityOf(facts, artist);
    rare += shared * (1 - popularity);
    const score = shared * (1 - MATCH.togetherPopularityWeight * popularity);
    if (score > togetherScore || (score === togetherScore && artist < together)) {
      togetherScore = score;
      together = artist;
    }
  }

  const mutual = Math.sqrt(Math.max(0, coverA.value) * Math.max(0, coverB.value));
  const boosted = mutual + (1 - mutual) * MATCH.rareBonus * rare;
  const shrink = (nEff: number): number => (nEff > 0 ? nEff / (nEff + MATCH.shrinkK) : 0);
  const lambda = Math.min(shrink(a.nEff), shrink(b.nEff));
  const shrunk = lambda * boosted + (1 - lambda) * MATCH.prior;
  const empty = a.songs.size === 0 || b.songs.size === 0;
  const match = empty ? 0 : clamp(Math.round(100 * Math.max(0, shrunk) ** MATCH.gamma), 0, 99);

  const symmetric = new Map(coverA.contributions);
  for (const [artist, value] of coverB.contributions) symmetric.set(artist, (symmetric.get(artist) ?? 0) + value);
  const contributions = [...symmetric].map(([artist, value]): [string, number] => [artist, value / 2])
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .slice(0, MATCH.contributionsKept)
    .map(([artist, value]) => ({ artist, value }));

  return {
    a: a.userId,
    b: b.userId,
    match,
    cover: { a: coverA.value, b: coverB.value },
    rare,
    confidence: lambda < 0.6 ? 'low' : 'normal',
    together,
    contributions
  };
}

/** Why the match moved, when it moved by at least 5 points: the artist whose contribution changed most. */
export function explainChange(previous: PairMatch | undefined, next: PairMatch): ChangeReason | null {
  if (!previous) return null;
  const delta = next.match - previous.match;
  if (Math.abs(delta) < MATCH.changeThreshold) return null;
  const before = new Map(previous.contributions.map(({ artist, value }) => [artist, value]));
  const after = new Map(next.contributions.map(({ artist, value }) => [artist, value]));
  let artist = '';
  let moved = 0;
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const change = Math.abs((after.get(name) ?? 0) - (before.get(name) ?? 0));
    if (change > moved || (change === moved && change > 0 && name < artist)) {
      moved = change;
      artist = name;
    }
  }
  if (!artist) return null;
  return { kind: delta > 0 ? 'up' : 'down', points: Math.abs(delta), artist };
}
