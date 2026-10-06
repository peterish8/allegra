/**
 * Song radio that listens back. Started from one song (a search result, a "Radio" tap), it ranks
 * a pool of candidates by three things at once:
 *
 *   1. how close each one is to the music's current centre: the seed, and later the songs the
 *      listener actually heard out (60 % seed / 40 % latest finish; after three early skips in a
 *      row it follows the latest finish, or the listener's own favourites, instead of the seed),
 *   2. the listener's long-term taste (favourite artists and languages), when there is one,
 *   3. what happened in this session: an artist skipped early sinks and, skipped twice, leaves;
 *      an artist heard out rises.
 *
 * Spacing rules keep it listenable: never the same lead artist twice in a row, at most two per
 * artist in the next ten, no remixes / lofi flips / covers of a song already played, and one slot
 * in five for something outside the listener's usual artists.
 *
 * Pure and deterministic: no I/O, no clocks, no randomness. Web and phone feed it candidates and
 * outcomes, and put `next()` in the queue.
 */
import { artistKey, creditedArtists, identityKey } from './identity';
import { SESSION_LOVE_WEIGHT, SESSION_WEIGHT, type ListenVerdict } from './listenSignal';

export interface RadioSong {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly language?: string | undefined;
}

/** Where a candidate came from. `similar` is the catalog's per-song suggestions; `mix` a song radio. */
export type RadioSource = 'similar' | 'mix' | 'artist' | 'taste';

export interface RadioTaste {
  readonly artists: readonly { readonly name: string; readonly score: number }[];
  readonly languages: readonly string[];
}

export type RadioReason =
  | { readonly kind: 'seed'; readonly title: string }
  | { readonly kind: 'follow'; readonly title: string }
  | { readonly kind: 'enjoyed'; readonly artist: string }
  | { readonly kind: 'taste'; readonly artist: string }
  | { readonly kind: 'discovery' };

export interface RadioPick<S extends RadioSong> {
  readonly song: S;
  readonly reason: RadioReason;
  readonly score: number;
}

export const RADIO_RULES = {
  /** Share of the centre that stays on the seed once the listener has heard something out. */
  seedShare: 0.6,
  /** Early skips in a row after which the radio stops following the seed. */
  driftAfterSkips: 3,
  /** Session feedback decays by this much with every new outcome. */
  feedbackDecay: 0.85,
  /** An artist at or below this session feedback is left out entirely. */
  banBelow: -1.75,
  /** Feedback multiplier in the score. */
  feedbackWeight: 1.2,
  /** Taste multiplier in the score. */
  tasteWeight: 1.2,
  /** Penalty for the same lead artist as the song before. */
  sameArtistPenalty: 1.5,
  /** At most this many songs per lead artist in one `next()` answer. */
  maxPerArtist: 2,
  /** Penalty for a language neither the seed nor the listener uses. */
  foreignLanguagePenalty: 1,
  /** Every this-many slots, a song outside the usual artists may take the slot… */
  discoveryEvery: 5,
  /** …when it scores within this of the best. */
  discoveryWindow: 1.2,
  /** Ask for more candidates when fewer than this remain. */
  refillBelow: 12
} as const;

const SOURCE_SCORE: Readonly<Record<RadioSource, { readonly top: number; readonly step: number; readonly floor: number }>> = {
  similar: { top: 3, step: 0.08, floor: 0.8 },
  mix: { top: 3, step: 0.08, floor: 0.8 },
  artist: { top: 1.6, step: 0.1, floor: 0.4 },
  taste: { top: 1.2, step: 0.1, floor: 0.3 }
};

/** Candidates that belong to no particular seed (taste fills). */
const ANY_SEED = '*';

interface Candidate<S extends RadioSong> {
  readonly song: S;
  readonly order: number;
  /** Closeness by seed identity. */
  readonly bySeed: Map<string, number>;
  readonly sources: Set<RadioSource>;
}

function flatten(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

/** "Kesariya (Lofi Flip)" and "Kesariya - Slowed" are both "kesariya". */
export function baseTitle(title: string): string {
  return flatten(title.replace(/\s*[([].*$/u, '').split(/\s+[-–—|]\s+/u)[0] ?? title);
}

function songKey(song: RadioSong): string {
  return identityKey(song.title, song.artist);
}

function leadArtist(song: RadioSong): string {
  return artistKey(creditedArtists(song.artist)[0] ?? song.artist);
}

export class RadioSession<S extends RadioSong> {
  private readonly candidates = new Map<string, Candidate<S>>();
  private readonly played = new Set<string>();
  private readonly playedTitles = new Set<string>();
  private readonly playedIds = new Set<string>();
  private readonly feedback = new Map<string, number>();
  private readonly applied = new Map<string, { readonly weight: number; readonly skip: boolean }>();
  private readonly positives: S[] = [];
  private favourites = new Map<string, number>();
  private favouriteNames = new Map<string, string>();
  private languages = new Set<string>();
  private skipStreak = 0;
  private added = 0;

  public constructor(public readonly seed: S, taste: RadioTaste | null = null) {
    this.setTaste(taste);
    this.markPlayed(seed);
  }

  /** The listener's long-term taste; it often arrives after the radio has started. */
  public setTaste(taste: RadioTaste | null): void {
    const artists = taste?.artists ?? [];
    const top = Math.max(1, ...artists.map((artist) => artist.score));
    this.favourites = new Map(artists.filter((artist) => artist.score > 0).map((artist) => [artistKey(artist.name), artist.score / top]));
    this.favouriteNames = new Map(artists.map((artist) => [artistKey(artist.name), artist.name]));
    this.languages = new Set((taste?.languages ?? []).map((language) => language.toLowerCase()));
    if (this.seed.language) this.languages.add(this.seed.language.toLowerCase());
  }

  /** Early skips in a row (a finish resets it). */
  public get earlySkipStreak(): number {
    return this.skipStreak;
  }

  /** The song to ask for more candidates from: the latest one heard out, or the seed. */
  public get refillSeed(): S {
    return this.positives[this.positives.length - 1] ?? this.seed;
  }

  /**
   * Adds a ranked list from one source. `from` is the song the list was found for (defaults to
   * the seed); taste fills belong to no seed. Returns how many candidates were new.
   */
  public add(songs: readonly S[], source: RadioSource, from: S | null = this.seed): number {
    const spec = SOURCE_SCORE[source];
    const seedKey = source === 'taste' || from === null ? ANY_SEED : songKey(from);
    let fresh = 0;
    songs.forEach((song, rank) => {
      if (!song.id || !song.title) return;
      const key = songKey(song);
      const closeness = Math.max(spec.floor, spec.top - rank * spec.step);
      let candidate = this.candidates.get(key);
      if (!candidate) {
        candidate = { song, order: this.added, bySeed: new Map(), sources: new Set() };
        this.added += 1;
        this.candidates.set(key, candidate);
        fresh += 1;
      }
      // Several sources agreeing on a song is evidence; one source repeating itself is not.
      const before = candidate.bySeed.get(seedKey) ?? 0;
      candidate.bySeed.set(seedKey, candidate.sources.has(source) ? Math.max(before, closeness) : before + closeness);
      candidate.sources.add(source);
    });
    return fresh;
  }

  /** The song started playing: it is not upcoming any more. */
  public markPlayed(song: RadioSong): void {
    this.played.add(songKey(song));
    this.playedTitles.add(baseTitle(song.title));
    this.playedIds.add(song.id);
  }

  /** How a song ended. Moves the centre, the session's artist feedback and the skip streak. */
  public record(song: S, verdict: ListenVerdict): void {
    this.markPlayed(song);
    if (verdict === 'paused') return;
    const skip = verdict === 'early-skip' || verdict === 'instant-skip';
    this.applyFeedback(song, SESSION_WEIGHT[verdict], skip);
    if (verdict === 'finished') {
      this.skipStreak = 0;
      this.addPositive(song);
    } else if (skip) {
      this.skipStreak += 1;
    }
  }

  /** A like or a playlist add: more like this, now. */
  public love(song: S): void {
    this.applyFeedback(song, SESSION_LOVE_WEIGHT, false);
    this.skipStreak = 0;
    this.addPositive(song);
  }

  /** The listener went back to a song they had skipped: the skip was a mistake, take it back. */
  public undoSkip(song: S): void {
    const key = songKey(song);
    const previous = this.applied.get(key);
    if (!previous?.skip) return;
    this.addArtistFeedback(song, -previous.weight);
    this.applied.delete(key);
    this.skipStreak = Math.max(0, this.skipStreak - 1);
  }

  /** How many candidates are still eligible, so callers know when to fetch more. */
  public remaining(exclude: Iterable<string> = []): number {
    const excluded = new Set(exclude);
    let count = 0;
    for (const candidate of this.candidates.values()) if (this.eligible(candidate, excluded)) count += 1;
    return count;
  }

  public get needsMore(): boolean {
    return this.remaining() < RADIO_RULES.refillBelow;
  }

  /**
   * The next `limit` songs in play order. `exclude` holds ids already queued by the listener;
   * `after` is the song they will follow (for the same-artist rule), defaulting to the last played.
   */
  public next(limit: number, options: { readonly exclude?: Iterable<string>; readonly after?: RadioSong | null } = {}): RadioPick<S>[] {
    const excluded = new Set(options.exclude ?? []);
    const centre = this.centre();
    const pool = [...this.candidates.values()]
      .filter((candidate) => this.eligible(candidate, excluded))
      .map((candidate) => ({ candidate, ...this.score(candidate, centre) }));
    const picks: RadioPick<S>[] = [];
    const perArtist = new Map<string, number>();
    let previousLead = options.after ? leadArtist(options.after) : null;
    while (picks.length < limit && pool.length > 0) {
      const slot = picks.length;
      let best = -1;
      let bestScore = Number.NEGATIVE_INFINITY;
      const adjusted = pool.map((entry) => {
        const lead = leadArtist(entry.candidate.song);
        let value = entry.score;
        if (lead === previousLead) value -= RADIO_RULES.sameArtistPenalty;
        if ((perArtist.get(lead) ?? 0) >= RADIO_RULES.maxPerArtist) value -= 100;
        return value;
      });
      adjusted.forEach((value, index) => {
        if (value > bestScore || (value === bestScore && best >= 0 && (pool[index]?.candidate.order ?? 0) < (pool[best]?.candidate.order ?? 0))) {
          best = index;
          bestScore = value;
        }
      });
      if (slot % RADIO_RULES.discoveryEvery === RADIO_RULES.discoveryEvery - 1) {
        let discovery = -1;
        adjusted.forEach((value, index) => {
          const entry = pool[index];
          if (!entry || !this.isUnfamiliar(entry.candidate.song) || value < bestScore - RADIO_RULES.discoveryWindow) return;
          if (discovery < 0 || value > (adjusted[discovery] ?? Number.NEGATIVE_INFINITY)) discovery = index;
        });
        if (discovery >= 0) best = discovery;
      }
      const chosen = pool[best];
      if (!chosen || bestScore < -50) break;
      pool.splice(best, 1);
      const lead = leadArtist(chosen.candidate.song);
      perArtist.set(lead, (perArtist.get(lead) ?? 0) + 1);
      previousLead = lead;
      picks.push({
        song: chosen.candidate.song,
        score: chosen.score,
        reason: slot % RADIO_RULES.discoveryEvery === RADIO_RULES.discoveryEvery - 1 && this.isUnfamiliar(chosen.candidate.song) && chosen.reason.kind !== 'enjoyed'
          ? { kind: 'discovery' }
          : chosen.reason
      });
    }
    return picks;
  }

  private addPositive(song: S): void {
    const key = songKey(song);
    const at = this.positives.findIndex((item) => songKey(item) === key);
    if (at >= 0) this.positives.splice(at, 1);
    this.positives.push(song);
  }

  private applyFeedback(song: S, weight: number, skip: boolean): void {
    for (const [artist, value] of this.feedback) this.feedback.set(artist, value * RADIO_RULES.feedbackDecay);
    this.addArtistFeedback(song, weight);
    this.applied.set(songKey(song), { weight, skip });
  }

  private addArtistFeedback(song: RadioSong, weight: number): void {
    creditedArtists(song.artist).forEach((name, index) => {
      const key = artistKey(name);
      // The lead artist carries the song; featured names only partly.
      this.feedback.set(key, (this.feedback.get(key) ?? 0) + (index === 0 ? weight : weight * 0.5));
    });
  }

  private centre(): Map<string, number> {
    const seedKey = songKey(this.seed);
    const latest = this.positives[this.positives.length - 1];
    const latestKey = latest ? songKey(latest) : null;
    const weights = new Map<string, number>();
    // Earlier finishes still count a little: the radio remembers the session, not only the last song.
    for (const song of this.positives.slice(0, -1)) weights.set(songKey(song), 0.15);
    if (this.skipStreak >= RADIO_RULES.driftAfterSkips) {
      weights.set(seedKey, latestKey ? 0.15 : 0.5);
      if (latestKey) weights.set(latestKey, 1);
    } else if (latestKey && latestKey !== seedKey) {
      weights.set(seedKey, RADIO_RULES.seedShare);
      weights.set(latestKey, 1 - RADIO_RULES.seedShare);
    } else {
      weights.set(seedKey, 1);
    }
    weights.set(ANY_SEED, 1);
    return weights;
  }

  private eligible(candidate: Candidate<S>, excluded: ReadonlySet<string>): boolean {
    const { song } = candidate;
    if (excluded.has(song.id) || this.playedIds.has(song.id)) return false;
    if (this.played.has(songKey(song)) || this.playedTitles.has(baseTitle(song.title))) return false;
    return (this.feedback.get(leadArtist(song)) ?? 0) > RADIO_RULES.banBelow;
  }

  private isUnfamiliar(song: RadioSong): boolean {
    const seedArtists = new Set(creditedArtists(this.seed.artist).map(artistKey));
    return creditedArtists(song.artist).every((name) => {
      const key = artistKey(name);
      return !this.favourites.has(key) && !seedArtists.has(key) && (this.feedback.get(key) ?? 0) <= 0;
    });
  }

  private score(candidate: Candidate<S>, centre: ReadonlyMap<string, number>): { score: number; reason: RadioReason } {
    const { song } = candidate;
    let closeness = 0;
    let fromSeed = 0;
    let fromFollow = 0;
    const seedKey = songKey(this.seed);
    const latest = this.positives[this.positives.length - 1];
    const latestKey = latest ? songKey(latest) : null;
    for (const [key, value] of candidate.bySeed) {
      const weighted = value * (centre.get(key) ?? 0.1);
      closeness += weighted;
      if (key === seedKey) fromSeed += weighted;
      else if (key === latestKey) fromFollow += weighted;
    }

    const artists = creditedArtists(song.artist);
    let affinity = 0;
    let affinityArtist = '';
    for (const name of artists) {
      const value = this.favourites.get(artistKey(name)) ?? 0;
      if (value > affinity) {
        affinity = value;
        affinityArtist = this.favouriteNames.get(artistKey(name)) ?? name;
      }
    }
    const drifting = this.skipStreak >= RADIO_RULES.driftAfterSkips;
    const taste = affinity * RADIO_RULES.tasteWeight * (drifting ? 2 : 1);

    // The most negative credited artist decides a skip; otherwise the most positive one counts.
    const values = artists.map((name) => this.feedback.get(artistKey(name)) ?? 0);
    const worst = Math.min(0, ...values);
    const bestFeedback = Math.max(0, ...values);
    const session = (worst <= -0.5 ? worst : bestFeedback) * RADIO_RULES.feedbackWeight;

    const language = song.language?.toLowerCase();
    const foreign = language && this.languages.size > 0 && !this.languages.has(language) ? RADIO_RULES.foreignLanguagePenalty : 0;
    const popularityTieBreak = -candidate.order * 0.0001;
    const score = closeness + taste + session - foreign + popularityTieBreak;

    let reason: RadioReason;
    if (bestFeedback >= 0.6 && worst > -0.5) {
      const enjoyed = artists.find((name) => (this.feedback.get(artistKey(name)) ?? 0) === bestFeedback) ?? artists[0] ?? song.artist;
      reason = { kind: 'enjoyed', artist: enjoyed };
    } else if (latest && fromFollow > fromSeed) {
      reason = { kind: 'follow', title: latest.title };
    } else if (taste > closeness && affinityArtist) {
      reason = { kind: 'taste', artist: affinityArtist };
    } else {
      reason = { kind: 'seed', title: this.seed.title };
    }
    return { score, reason };
  }
}

/** Quiet copy for a radio row. */
export function radioReasonLabel(reason: RadioReason): string {
  // "Kesariya (From "Brahmastra")" reads as "Kesariya" in a one-line hint.
  const short = (title: string): string => title.replace(/\s*[([].*$/u, '') || title;
  switch (reason.kind) {
    case 'seed':
      return `Like ${short(reason.title)}`;
    case 'follow':
      return `Because you finished ${short(reason.title)}`;
    case 'enjoyed':
      return `More ${reason.artist}`;
    case 'taste':
      return `You play ${reason.artist} a lot`;
    case 'discovery':
      return 'Something new';
  }
}
