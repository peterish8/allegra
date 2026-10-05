// GENERATED from packages/shared/blendTypes.ts by `npm run sync:shared`. Do not edit here.
/**
 * Types shared by every layer of Blend: the pure maths here in packages/shared, the API that
 * builds and stores Blends, and the web and phone apps that show them. Types only; the functions
 * live in blendTaste.ts, blendMatch.ts, blendBuild.ts and blendStories.ts (PLAN.md §4).
 */
import type { SongSnapshot } from './songRef.js';

/** What the catalog says about one artist. Not personal, so cached and shared between listeners. */
export interface ArtistFacts {
  /** Lower-cased name, as `artistKey(creditedArtists(x)[0])` produces. */
  readonly key: string;
  /** 0 niche … 1 superstar: clamp(log10(1 + followers) / 7, 0, 1). */
  readonly popularity: number;
  /** The most common language among the artist's catalog songs. */
  readonly language?: string;
  /** Similar artists' keys, at most 10. */
  readonly similar: readonly string[];
}

/** Artist key → facts. A missing artist means popularity 0.5, no language, no similar artists. */
export type ArtistFactsMap = ReadonlyMap<string, ArtistFacts>;

/** One song in one taste layer, as the API loads it: identity, credited artist line, raw weight. */
export interface TasteItem {
  /** identityKey(title, artist). */
  readonly identity: string;
  /** The credited artist line, e.g. "A, B & C". */
  readonly artist: string;
  /** Raw weight within its layer; defaults to 1 (likes and playlist items). */
  readonly weight?: number;
}

/** A member's taste as a distribution (PLAN.md §4.4). */
export interface MemberTaste {
  readonly userId: string;
  /** identity → p(i); sums to 1 (empty for no data). */
  readonly songs: ReadonlyMap<string, number>;
  /** identity → lead artist key. */
  readonly songArtist: ReadonlyMap<string, string>;
  /** artist key → q(a); sums to 1. */
  readonly artists: ReadonlyMap<string, number>;
  /** language → share of artist taste in that language (sums to the share with a known language). */
  readonly languages: ReadonlyMap<string, number>;
  /** Effective number of songs, 1 / Σ p². 0 for no data. */
  readonly nEff: number;
}

/** The taste match for one pair (PLAN.md §4.6). */
export interface PairMatch {
  /** userIds, a < b. */
  readonly a: string;
  readonly b: string;
  /** 0–99. */
  readonly match: number;
  /** `a`: the share of a's taste b would enjoy; `b`: the share of b's taste a would enjoy. 0–1. */
  readonly cover: { readonly a: number; readonly b: number };
  readonly rare: number;
  readonly confidence: 'normal' | 'low';
  /** The artist that brings the pair together (artist key), '' when they share none. */
  readonly together: string;
  /** Symmetric per-artist coverage contributions, top 10, largest first. */
  readonly contributions: readonly { readonly artist: string; readonly value: number }[];
}

/** Why a pair's match moved by at least 5 points since the last build. */
export interface ChangeReason {
  readonly kind: 'up' | 'down';
  readonly points: number;
  /** Artist key whose contribution changed most. */
  readonly artist: string;
}

/** shared: in two or more members' taste; pick: in one; discovery: in nobody's. */
export type BlendKind = 'shared' | 'pick' | 'discovery';

/** One track of a day's Blend. */
export interface BlendTrack {
  /** Resolved to a Saavn ref (D15). */
  readonly song: SongSnapshot;
  /** userIds whose taste holds it; empty only for discovery. */
  readonly for: readonly string[];
  readonly kind: BlendKind;
}
