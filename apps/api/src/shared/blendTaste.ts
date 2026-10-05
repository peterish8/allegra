// GENERATED from packages/shared/blendTaste.ts by `npm run sync:shared`. Do not edit here.
/**
 * A member's taste as a distribution over songs and artists (PLAN.md §4.4). Three layers, each
 * turned into shares that sum to 1, then mixed with fixed weights, so the size of a layer never
 * buys influence: 900 imported likes count for exactly as much as 60.
 *
 * Pure: no I/O, no clock. The caller passes Now-layer weights already decayed to "now".
 */
import type { ArtistFactsMap, MemberTaste, TasteItem } from './blendTypes.js';
import { artistKey, creditedArtists } from './identity.js';

/** Layer weights before renormalising over the layers that have items. */
export const LAYER_BETA = { nowMax: 0.6, nowFullAt: 50, nowFullMeanWeight: 1, minimumNowWeight: 0.05, loved: 0.3, kept: 0.1 } as const;

/** Per song, the lead artist gets 2/3 and the other credited artists split 1/3 (a solo artist gets 1). */
export const ARTIST_CREDIT = { lead: 2 / 3, featuredTotal: 1 / 3 } as const;

/** Raw weight → share within one layer; items without a positive weight are dropped. */
function layerShares(items: readonly TasteItem[]): Map<string, { share: number; artist: string }> {
  const raw = new Map<string, { weight: number; artist: string }>();
  for (const item of items) {
    const weight = item.weight ?? 1;
    if (!(weight > 0) || !Number.isFinite(weight) || !item.identity) continue;
    const seen = raw.get(item.identity);
    raw.set(item.identity, { weight: (seen?.weight ?? 0) + weight, artist: seen?.artist ?? item.artist });
  }
  let total = 0;
  for (const { weight } of raw.values()) total += weight;
  const shares = new Map<string, { share: number; artist: string }>();
  if (total <= 0) return shares;
  for (const [identity, { weight, artist }] of raw) shares.set(identity, { share: weight / total, artist });
  return shares;
}

export function memberTaste(input: {
  readonly userId: string;
  /** Tally rows, weight = currentWeight(score, now). Ignored when `learning` is false. */
  readonly now: readonly TasteItem[];
  readonly loved: readonly TasteItem[];
  readonly kept: readonly TasteItem[];
  readonly learning: boolean;
  readonly facts: ArtistFactsMap;
}): MemberTaste {
  const eligibleNow = input.learning ? input.now.filter((item) => (item.weight ?? 1) >= LAYER_BETA.minimumNowWeight) : [];
  const now = layerShares(eligibleNow);
  const meanWeight = eligibleNow.reduce((total, item) => total + (item.weight ?? 1), 0) / Math.max(1, eligibleNow.length);
  const layers = [
    { shares: now, beta: LAYER_BETA.nowMax * Math.min(1, now.size / LAYER_BETA.nowFullAt) * Math.min(1, meanWeight / LAYER_BETA.nowFullMeanWeight) },
    { shares: layerShares(input.loved), beta: LAYER_BETA.loved },
    { shares: layerShares(input.kept), beta: LAYER_BETA.kept }
  ].filter((layer) => layer.shares.size > 0 && layer.beta > 0);

  let betaTotal = 0;
  for (const layer of layers) betaTotal += layer.beta;

  const songs = new Map<string, number>();
  const credits = new Map<string, string>();
  for (const layer of layers) {
    const beta = layer.beta / betaTotal;
    for (const [identity, { share, artist }] of layer.shares) {
      songs.set(identity, (songs.get(identity) ?? 0) + beta * share);
      if (!credits.has(identity)) credits.set(identity, artist);
    }
  }

  const songArtist = new Map<string, string>();
  const artists = new Map<string, number>();
  let sumSquares = 0;
  for (const [identity, p] of songs) {
    sumSquares += p * p;
    const names = creditedArtists(credits.get(identity) ?? '').map(artistKey).filter(Boolean);
    const lead = names[0] ?? '';
    songArtist.set(identity, lead);
    if (!lead) continue;
    const featured = names.slice(1);
    const leadShare = featured.length === 0 ? 1 : ARTIST_CREDIT.lead;
    artists.set(lead, (artists.get(lead) ?? 0) + p * leadShare);
    for (const name of featured) {
      artists.set(name, (artists.get(name) ?? 0) + (p * ARTIST_CREDIT.featuredTotal) / featured.length);
    }
  }
  // Songs without any credited artist would leave q short of 1; spread the gap proportionally.
  let artistTotal = 0;
  for (const q of artists.values()) artistTotal += q;
  if (artistTotal > 0 && Math.abs(artistTotal - 1) > 1e-12) {
    for (const [name, q] of artists) artists.set(name, q / artistTotal);
  }

  const languages = new Map<string, number>();
  for (const [name, q] of artists) {
    const language = input.facts.get(name)?.language;
    if (language) languages.set(language, (languages.get(language) ?? 0) + q);
  }

  return { userId: input.userId, songs, songArtist, artists, languages, nEff: sumSquares > 0 ? 1 / sumSquares : 0 };
}
