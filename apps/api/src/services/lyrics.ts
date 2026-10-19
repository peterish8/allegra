import { CACHE_MISS, cacheKey, isCacheMiss, MemoryCacheStore, type CacheMiss, type CacheStore } from '../lib/cache.js';
import { LATE, withinBudget } from '../lib/deadline.js';
import { hasTimestamps, parseLyrics } from '../lib/lrc.js';
import { scoreLyrics } from '../lib/matcher.js';
import type { BetterLyricsProvider } from '../providers/betterlyrics.js';
import type { KuGouProvider } from '../providers/kugou.js';
import type { LrclibEntry, LrclibProvider } from '../providers/lrclib.js';
import type { LyricaProvider } from '../providers/lyrica.js';
import type { LyricsCandidate } from '../providers/lyricsCandidate.js';
import { filmOf, type LyricSites, type SiteLyrics } from '../providers/lyricsSites/lyricSites.js';
import type { SaavnLyricsProvider } from '../providers/saavnLyrics.js';
import type { UnisonProvider } from '../providers/unison.js';
import type { YouLyPlusProvider } from '../providers/youlyplus.js';
import { matchKey, parseSongRef } from '../shared/songRef.js';
import type { LyricsPayload, VerifiedLyrics } from '../types.js';
import { publicView, verifiedPayloads, versionLabel, type StoredVerifiedLyrics, type VerifiedLyricsStore } from './verifiedLyrics.js';
import { cleanLyricStanzas } from '../shared/lyricsText.js';
import type { LyricSource } from './lyricSync.js';

const HIT_TTL_SECONDS = 2_592_000;
const MISS_TTL_SECONDS = 86_400;
const ALTERNATIVES_TTL_SECONDS = 86_400;
const MAX_ALTERNATIVES = 6;
/** Listener-synced lyrics are read on every lookup; a slow read must not hold the providers up. */
const VERIFIED_BUDGET_MS = 2_500;
/** Kept in this instance only, briefly, so a new sync shows up within a minute everywhere. */
const VERIFIED_MEMO_SECONDS = 60;
/** A song found by title and artist (no ref) must also last about as long as the synced one. */
const MATCH_KEY_DURATION_SLACK_SECONDS = 3;
/**
 * How long a listener waits for an answer. A song with no lyrics walks every tier in turn, which
 * can take minutes; the web client gives up at 15 s and would report a dead connection instead of
 * "no lyrics". Past this, the lookup keeps running and caches its result for the next ask.
 */
const LOOKUP_BUDGET_MS = 11_000;
/**
 * Lyric sites are only for songs the providers lack. A song they have answers well inside this,
 * so its lookup never touches a site; past it, the site is asked while the providers finish.
 */
const SITE_GRACE_MS = 3_000;
/** Never settles: a race entry that must not win with an empty answer. */
const NEVER = new Promise<never>(() => undefined);

/** What the catalog knows about the song beyond title and artist; each field is optional. */
export interface SongHints {
  /** "saavn:<id>": listener-synced and JioSaavn lyrics are found by it. */
  readonly ref?: string;
  /** Names the film for a lyric site (`Baththa (Original Motion Picture Soundtrack)`). */
  readonly album?: string;
  /** The catalog's language name ("tamil"): lyric sites are asked only for languages they cover. */
  readonly language?: string;
}

/** The optional sources behind LRCLIB. Each is asked only if configured, and none ever throws. */
export interface LyricsSources {
  readonly lyrica?: LyricaProvider;
  readonly betterLyrics?: BetterLyricsProvider;
  readonly youLyPlus?: YouLyPlusProvider;
  readonly unison?: UnisonProvider;
  readonly kugou?: KuGouProvider;
  /** JioSaavn's own plain lyrics, asked by the song's Saavn id when the providers have none. */
  readonly saavnLyrics?: SaavnLyricsProvider;
  /** Lyrics listeners synced and confirmed; asked first whenever the caller names the song. */
  readonly verified?: VerifiedLyricsStore;
  /** Lyric sites, the last resort: plain text, shown as "Found online". */
  readonly lyricSites?: LyricSites;
  /** Overrides LOOKUP_BUDGET_MS (tests). */
  readonly budgetMs?: number;
  /** Overrides SITE_GRACE_MS (tests). */
  readonly siteGraceMs?: number;
}

export class LyricsService {
  /** Lookups still running, by cache key, so a retry joins the one in flight instead of starting over. */
  private readonly inflight = new Map<string, Promise<LyricsPayload | null>>();

  private readonly lyrica: LyricaProvider | undefined;
  private readonly betterLyrics: BetterLyricsProvider | undefined;
  private readonly youLyPlus: YouLyPlusProvider | undefined;
  private readonly unison: UnisonProvider | undefined;
  private readonly kugou: KuGouProvider | undefined;
  private readonly saavnLyrics: SaavnLyricsProvider | undefined;
  private readonly verifiedStore: VerifiedLyricsStore | undefined;
  private readonly lyricSites: LyricSites | undefined;
  private verifiedMemo = new MemoryCacheStore();
  private readonly budgetMs: number;
  private readonly siteGraceMs: number;

  public constructor(
    private readonly lrclib: LrclibProvider,
    private readonly cache: CacheStore,
    sources: LyricsSources = {}
  ) {
    this.lyrica = sources.lyrica;
    this.betterLyrics = sources.betterLyrics;
    this.youLyPlus = sources.youLyPlus;
    this.unison = sources.unison;
    this.kugou = sources.kugou;
    this.saavnLyrics = sources.saavnLyrics;
    this.verifiedStore = sources.verified;
    this.lyricSites = sources.lyricSites;
    this.budgetMs = sources.budgetMs ?? LOOKUP_BUDGET_MS;
    this.siteGraceMs = sources.siteGraceMs ?? SITE_GRACE_MS;
  }

  /**
   * The best lyrics for a song, or null: none found, or none found within the budget (the lookup
   * then finishes in the background, so asking again shortly gets its answer from the cache).
   * With `ref` ("saavn:<id>"), lyrics listeners synced come first (English before the song's own
   * script), and JioSaavn's plain lyrics answer when the providers have none. A lyric site
   * ("Found online") is the last resort, for a song in a language it covers.
   */
  public async find(
    title: string,
    artist: string,
    duration: number | undefined,
    syncedOnly: boolean,
    song: SongHints = {}
  ): Promise<LyricsPayload | null> {
    const shared = verifiedPayloads(await this.verified(song.ref, title, artist, duration), duration)[0];
    if (shared) {
      return shared;
    }
    // Started beside the providers, so JioSaavn costs no wait of its own.
    const saavn = syncedOnly ? null : this.saavnFallback(song.ref, duration);
    const cleaned = cleanLyricsQuery(title, artist);
    const key = cacheKey('lyrics', cleaned.title, cleaned.artist, String(duration ?? 0), String(syncedOnly));
    let lookup = this.inflight.get(key);
    if (!lookup) {
      lookup = this.cascade(title, artist, duration, syncedOnly).finally(() => this.inflight.delete(key));
      this.inflight.set(key, lookup);
    }
    // A site is asked only when the providers have not answered within the grace period.
    const providers = lookup;
    const siteApplies = !syncedOnly && this.lyricSites?.covers(song.language) === true;
    const site = siteApplies
      ? withinBudget(providers, this.siteGraceMs).then(async value => value !== LATE && value ? [] : sitePayloads(await this.siteVersions(title, artist, song), duration))
      : null;
    // Keep scraped words readable in plain mode until a listener shares real timing.
    const fallback = (async (): Promise<LyricsPayload | null> => {
      const official = saavn ? await saavn : null;
      if (official) return official;
      return site ? (await site)[0] ?? null : null;
    })();
    // Plain lyrics in hand end the wait once the providers have had their grace period, instead of
    // holding the listener for the whole budget; a provider that answers later caches its lyrics
    // for the next play.
    const early = saavn || site
      ? [withinBudget(providers, this.siteGraceMs).then(() => fallback).then((value) => value ?? NEVER)]
      : [];
    const value = await withinBudget(Promise.race([providers.then((found) => found ?? fallback), ...early]), this.budgetMs);
    if (value !== LATE) {
      return value;
    }
    // Out of budget: only a moment more, because the client's own timeout is close.
    const last = await withinBudget(fallback, 500);
    return last === LATE ? null : last;
  }

  /**
   * Site words and private provenance, English first. Null when no site has the song. Never throws.
   */
  private async siteVersions(title: string, artist: string, song: SongHints): Promise<SiteLyrics | null> {
    const sites = this.lyricSites;
    if (!sites || !sites.covers(song.language)) {
      return null;
    }
    const cleaned = cleanLyricsQuery(title, artist);
    const film = filmOf(title, song.album);
    const found = await sites
      .find({ title: cleaned.title, artist: cleaned.artist, ...(film ? { film } : {}), ...(song.language ? { language: song.language } : {}) })
      .catch((): null => null);
    return found;
  }

  /** Server-held sync sources: providers and sites are asked together, with provenance kept for saving. */
  public async sources(title: string, artist: string, duration: number, song: SongHints): Promise<LyricSource[]> {
    const providerLookup = this.alternatives(title, artist, duration, false, song);
    const siteSettled = await withinBudget(this.siteVersions(title, artist, song), this.budgetMs);
    // Words already found online must not wait for every slow provider. No background work is
    // required for correctness: another request can repeat any provider lookup that was late.
    const providerSettled = await withinBudget(providerLookup, siteSettled && siteSettled !== LATE ? 500 : this.budgetMs);
    const providers = providerSettled === LATE ? [] : providerSettled;
    const site = siteSettled === LATE ? null : siteSettled;
    const language = languageCode(song.language);
    const fromProviders: LyricSource[] = providers.flatMap(payload => {
      const lines = cleanLyricStanzas([payload.lines.map(line => line.text).filter(text => text !== '[INSTRUMENTAL]' && text !== '🎵')]).flat();
      if (!lines.length) return [];
      const script = /[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{S}\p{Z}\s]/u.test(lines.join(' ')) ? 'native' as const : 'latin' as const;
      return [{ origin: 'provider' as const, source: { name: payload.source }, script, language, lines, synced: payload.type === 'synced' }];
    });
    const fromSite: LyricSource[] = (site?.versions ?? []).flatMap(version => {
      const lines = cleanLyricStanzas(version.text.split(/\n\s*\n/u).map(stanza => stanza.split('\n'))).flat();
      const synced = fromProviders.some(candidate => candidate.synced && candidate.script === version.script && candidate.lines.join('\n') === lines.join('\n'));
      return lines.length && site ? [{ origin: 'site' as const, source: site.source, script: version.script, language: version.language, lines, synced }] : [];
    });
    return [...fromProviders, ...fromSite];
  }

  /**
   * The lyrics listeners synced for a song, live versions only, or null. Asked by ref; a song with
   * no ref (a download on the phone) is matched by title and artist and must last about as long.
   * Never throws and never takes longer than VERIFIED_BUDGET_MS.
   */
  public async verified(ref: string | undefined, title: string, artist: string, duration?: number): Promise<VerifiedLyrics | null> {
    const store = this.verifiedStore;
    if (!store) {
      return null;
    }
    const song = ref ? parseSongRef(ref) : null;
    const key = song ? `ref:${song.source}:${song.id}` : `match:${matchKey(title, artist)}:${Math.round(duration ?? 0)}`;
    if (!song && !title.trim()) {
      return null;
    }
    // Hold the cache instance so a read started before invalidation cannot refill the new cache.
    const memoStore = this.verifiedMemo;
    const memo = await memoStore.get<VerifiedLyrics | CacheMiss>(key);
    if (memo) {
      return isCacheMiss(memo) ? null : memo;
    }
    const read = async (): Promise<StoredVerifiedLyrics | null> => {
      if (song) {
        return store.get(`${song.source}:${song.id}`);
      }
      const row = await store.byMatchKey(matchKey(title, artist));
      const close = row && (duration === undefined || duration <= 0 || Math.abs(row.duration - duration) <= MATCH_KEY_DURATION_SLACK_SECONDS);
      return close ? row : null;
    };
    const row = await withinBudget(read(), VERIFIED_BUDGET_MS);
    if (row === LATE) {
      // Unknown, not absent: do not remember it.
      return null;
    }
    const view = publicView(row);
    await memoStore.set(key, view ?? CACHE_MISS, VERIFIED_MEMO_SECONDS);
    return view;
  }

  /** Drops this instance's memo for a song, after a sync, report or moderation change. */
  public async forgetVerified(ref: string): Promise<void> {
    const song = parseSongRef(ref);
    if (song) {
      // The same recording may have been read by ref or several title/artist/duration keys.
      this.verifiedMemo = new MemoryCacheStore();
    }
  }

  /** JioSaavn's plain lyrics for a Saavn song, cached like the providers' answers. Null otherwise. */
  private saavnFallback(ref: string | undefined, duration: number | undefined): Promise<LyricsPayload | null> | null {
    const song = ref ? parseSongRef(ref) : null;
    const provider = this.saavnLyrics;
    if (!provider || song?.source !== 'saavn') {
      return null;
    }
    // Catalog IDs are case-sensitive; cacheKey normalises text and must not normalise this ID.
    const key = `lyrics-saavn:v2:${song.id}:${Math.round(duration ?? 0)}`;
    return (async () => {
      const cached = await this.cache.get<LyricsPayload | CacheMiss>(key);
      if (cached) {
        return isCacheMiss(cached) ? null : cached;
      }
      const found = await provider.find(song.id);
      const lines = found ? parseLyrics(found.lyrics, duration ?? 180) : [];
      const payload: LyricsPayload | null = lines.length > 0
        ? { source: found?.source ?? 'JioSaavn', type: 'plain', matchScore: 40, matchReason: 'JioSaavn • Plain text', lines }
        : null;
      await this.cache.set(key, payload ?? CACHE_MISS, payload ? HIT_TTL_SECONDS : MISS_TTL_SECONDS);
      return payload;
    })().catch(() => null);
  }

  /**
   * Cascade: LRCLIB (exact, then search, across title/artist variants) -> Lyrica and
   * BetterLyrics together -> a miss. Each tier is optional and never throws.
   */
  private async cascade(
    title: string,
    artist: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<LyricsPayload | null> {
    const cleaned = cleanLyricsQuery(title, artist);
    const lead = leadArtist(cleaned.artist);
    const key = cacheKey('lyrics', cleaned.title, cleaned.artist, String(duration ?? 0), String(syncedOnly));
    const missKey = cacheKey('lyrics', 'miss', cleaned.title, cleaned.artist, String(duration ?? 0), String(syncedOnly));
    if (await this.cache.get<boolean>(missKey)) {
      return null;
    }
    const cached = await this.cache.get<LyricsPayload>(key);
    if (cached) {
      return cached;
    }

    // 1. LRCLIB. The first attempt is the song exactly as the catalog names it; later ones are
    //    looser (lead artist, each co-artist, title without a "- New Version" suffix) and must
    //    still resemble the requested title so a loose search never returns a different song.
    const attempts = lrclibAttempts(cleaned.title, cleaned.artist);
    for (const [index, attempt] of attempts.entries()) {
      const payload = await this.fromLrclib(attempt.title, attempt.artist, cleaned.title, duration, syncedOnly, index > 0);
      if (payload) {
        await this.cache.set(key, payload, HIT_TTL_SECONDS);
        return payload;
      }
    }
    if (lead) {
      const loose = (await this.lrclib.searchText(`${cleaned.title} ${lead}`)).filter((entry) => isUsable(entry, syncedOnly) && titlesAlike(entry.trackName, cleaned.title));
      const best = loose.sort((left, right) => scoreLyrics(right, cleaned.title, duration).score - scoreLyrics(left, cleaned.title, duration).score)[0];
      if (best) {
        const payload = toPayload(best, cleaned.title, duration, 'LRCLIB-search');
        await this.cache.set(key, payload, HIT_TTL_SECONDS);
        return payload;
      }
    }

    // 2. The optional aggregators, asked together so a slow one does not delay the others.
    const aggregated = await this.fromAggregators(cleaned.title, cleaned.artist, lead, duration, syncedOnly);
    const found = aggregated
      .map((candidate) => candidatePayload(candidate, cleaned.title, duration))
      .filter((payload) => !syncedOnly || payload.type === 'synced')
      // Synced beats plain; on a tie the earlier source in fromAggregators' order wins.
      .sort((left, right) => Number(right.type === 'synced') - Number(left.type === 'synced'))[0];
    if (found) {
      await this.cache.set(key, found, HIT_TTL_SECONDS);
      return found;
    }

    await this.cache.set(missKey, true, MISS_TTL_SECONDS);
    return null;
  }

  private async fromLrclib(
    title: string,
    artist: string,
    requestedTitle: string,
    duration: number | undefined,
    syncedOnly: boolean,
    requireSimilarTitle: boolean
  ): Promise<LyricsPayload | null> {
    const precise = await this.lrclib.get(title, artist, duration);
    const fromGet = precise && isUsable(precise, syncedOnly) ? precise : null;
    const candidates = fromGet
      ? [fromGet]
      : (await this.lrclib.search(title, artist, duration)).filter((candidate) => isUsable(candidate, syncedOnly) && (!requireSimilarTitle || titlesAlike(candidate.trackName, requestedTitle)));
    const best = candidates.sort((left, right) => scoreLyrics(right, requestedTitle, duration).score - scoreLyrics(left, requestedTitle, duration).score)[0];
    return best ? toPayload(best, requestedTitle, duration, fromGet === best ? 'LRCLIB' : 'LRCLIB-search') : null;
  }

  /**
   * One answer from each aggregator, in preference order: Better Lyrics and LyricsPlus (word-timed,
   * often Apple), Unison (community-ranked), Lyrica, then KuGou, whose keyword search is the likeliest
   * to land on another recording.
   */
  private async fromAggregators(
    title: string,
    artist: string,
    lead: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<LyricsCandidate[]> {
    const artistForSearch = lead || artist;
    const found = await Promise.all([
      this.betterLyrics ? this.betterLyrics.find(title, artistForSearch, duration) : Promise.resolve(null),
      this.youLyPlus ? this.youLyPlus.find(title, artistForSearch, duration) : Promise.resolve(null),
      this.unison ? this.unison.find(title, artistForSearch, duration) : Promise.resolve(null),
      this.findLyrica(title, artist, lead, duration, syncedOnly),
      this.kugou ? this.kugou.find(title, artistForSearch, duration) : Promise.resolve(null)
    ]);
    return found.filter((candidate): candidate is LyricsCandidate => candidate !== null);
  }

  private async findLyrica(
    title: string,
    artist: string,
    lead: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<{ readonly lyrics: string; readonly source: string } | null> {
    if (!this.lyrica) {
      return null;
    }
    const first = await this.lyrica.find(title, lead || artist, duration, syncedOnly);
    if (first || !lead || lead === artist) {
      return first;
    }
    return this.lyrica.find(title, artist, duration, syncedOnly);
  }

  /**
   * Every distinct usable rendering the providers have, for the "Other lyrics" picker. Unlike
   * find() it asks every tier at once instead of stopping at the first hit, so it runs only when a
   * listener asks. An empty list is an answer (nothing else matched), not a failure.
   */
  public async alternatives(
    title: string,
    artist: string,
    duration: number | undefined,
    syncedOnly: boolean,
    song: SongHints = {}
  ): Promise<LyricsPayload[]> {
    // Listener-synced versions lead (and are never cached here); JioSaavn's own text comes next,
    // then the providers'. Unsynced site words are reserved for the finder and plain playback fallback.
    const saavn = syncedOnly ? null : this.saavnFallback(song.ref, duration);
    const [shared, saavnSettled, providers] = await Promise.all([
      this.verified(song.ref, title, artist, duration).then((view) => verifiedPayloads(view, duration)),
      saavn ? withinBudget(saavn, this.budgetMs) : Promise.resolve(null),
      this.providerAlternatives(title, artist, duration, syncedOnly)
    ]);
    const fromSaavn = saavnSettled && saavnSettled !== LATE ? [saavnSettled] : [];
    const seen = new Set<string>();
    return [...shared, ...fromSaavn, ...providers]
      .filter((payload) => {
        const fingerprint = lyricsFingerprint(payload);
        if (!fingerprint || seen.has(fingerprint)) {
          return false;
        }
        seen.add(fingerprint);
        return true;
      })
      // Stable: synced first (listener syncs lead), then JioSaavn's plain text.
      .sort((left, right) => Number(right.type === 'synced') - Number(left.type === 'synced'));
  }

  /** What the providers alone offer, cached by title and artist. */
  private async providerAlternatives(
    title: string,
    artist: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<LyricsPayload[]> {
    const cleaned = cleanLyricsQuery(title, artist);
    const lead = leadArtist(cleaned.artist);
    const key = cacheKey('lyrics-alternatives', 'v2', cleaned.title, cleaned.artist, String(duration ?? 0), String(syncedOnly));
    const cached = await this.cache.get<LyricsPayload[]>(key);
    if (cached) {
      return cached;
    }

    const attempts = lrclibAttempts(cleaned.title, cleaned.artist);
    // Every tier gets the same budget; whatever has answered by then is the list. A tier still
    // running is left to finish on its own, and the list is not cached, so a later ask sees it.
    const artistForSearch = lead || cleaned.artist;
    const single = (lookup: Promise<LyricsCandidate | null>): Promise<LyricsCandidate[]> => lookup.then((candidate) => (candidate ? [candidate] : []));
    const [exactSettled, lrclibSettled, looseSettled, ...aggregatorSettled] = await Promise.all([
      withinBudget(this.lrclib.get(cleaned.title, cleaned.artist, duration), this.budgetMs),
      withinBudget(Promise.all(attempts.map((attempt) => this.lrclib.search(attempt.title, attempt.artist, duration))), this.budgetMs),
      withinBudget(lead ? this.lrclib.searchText(`${cleaned.title} ${lead}`) : Promise.resolve([]), this.budgetMs),
      // Same preference order as fromAggregators; Unison and KuGou can offer several versions each.
      withinBudget(this.betterLyrics ? single(this.betterLyrics.find(cleaned.title, artistForSearch, duration)) : Promise.resolve([]), this.budgetMs),
      withinBudget(this.youLyPlus ? single(this.youLyPlus.find(cleaned.title, artistForSearch, duration)) : Promise.resolve([]), this.budgetMs),
      withinBudget(this.unison ? this.unison.search(cleaned.title, artistForSearch, duration) : Promise.resolve([]), this.budgetMs),
      withinBudget(single(this.findLyrica(cleaned.title, cleaned.artist, lead, duration, syncedOnly)), this.budgetMs),
      withinBudget(this.kugou ? this.kugou.findAll(cleaned.title, artistForSearch, duration) : Promise.resolve([]), this.budgetMs)
    ]);
    const complete = exactSettled !== LATE && lrclibSettled !== LATE && looseSettled !== LATE && aggregatorSettled.every((value) => value !== LATE);
    const searches = lrclibSettled === LATE ? [] : lrclibSettled;
    const loose = looseSettled === LATE ? [] : looseSettled;
    const aggregated = aggregatorSettled.flatMap((value) => (value === LATE ? [] : value));

    const exact = exactSettled !== LATE && exactSettled ? [exactSettled] : [];
    const fromLrclib = [...exact, ...searches.flat(), ...loose]
      .filter((entry) => isUsable(entry, syncedOnly) && titlesAlike(entry.trackName, cleaned.title))
      .sort((left, right) => scoreLyrics(right, cleaned.title, duration).score - scoreLyrics(left, cleaned.title, duration).score)
      .map((entry) => {
        const payload = toPayload(entry, cleaned.title, duration, 'LRCLIB');
        // Several LRCLIB entries share a source name; the recording they were filed under tells them apart.
        const filedAs = [entry.artistName, entry.trackName].filter(Boolean).join(' — ');
        return filedAs ? { ...payload, matchReason: `${filedAs} • ${payload.matchReason}` } : payload;
      });
    const fromAggregators = aggregated
      .map((candidate) => candidatePayload(candidate, cleaned.title, duration))
      .filter((payload) => !syncedOnly || payload.type === 'synced');

    const seen = new Set<string>();
    const versions = [...fromAggregators, ...fromLrclib]
      .filter((payload) => {
        const fingerprint = lyricsFingerprint(payload);
        if (!fingerprint || seen.has(fingerprint)) {
          return false;
        }
        seen.add(fingerprint);
        return true;
      })
      // Stable: synced first, each group keeping its provider and score order.
      .sort((left, right) => Number(right.type === 'synced') - Number(left.type === 'synced'))
      .slice(0, MAX_ALTERNATIVES);

    if (complete) {
      await this.cache.set(key, versions, versions.length > 0 ? ALTERNATIVES_TTL_SECONDS : MISS_TTL_SECONDS / 4);
    }
    return versions;
  }

  public async search(title: string, artist: string, duration?: number): Promise<Array<{
    readonly title: string;
    readonly artist: string;
    readonly duration?: number;
    readonly type: 'synced' | 'plain';
    readonly matchScore: number;
    readonly matchReason: string;
  }>> {
    const cleaned = cleanLyricsQuery(title, artist);
    const entries = await this.lrclib.search(cleaned.title, cleaned.artist, duration);
    return entries
      .filter((entry) => isUsable(entry, false))
      .map((entry) => {
        const score = scoreLyrics(entry, cleaned.title, duration);
        return {
          title: entry.trackName ?? cleaned.title,
          artist: entry.artistName ?? cleaned.artist,
          ...(entry.duration !== undefined ? { duration: entry.duration } : {}),
          type: entry.syncedLyrics?.trim() ? 'synced' as const : 'plain' as const,
          matchScore: score.score,
          matchReason: score.reason
        };
      })
      .sort((left, right) => right.matchScore - left.matchScore);
  }
}

export function cleanLyricsQuery(title: string, artist: string): { title: string; artist: string } {
  let cleanSong = title
    .replace(/\(Lyrics\)/gi, '')
    .replace(/\(Official.*?\)/gi, '')
    .replace(/\(MP3_\d+K\)/gi, '')
    .replace(/\(Audio\)/gi, '')
    // Catalog decorations that no lyrics database has in a track name: (From "Jawan"),
    // (Original Motion Picture Soundtrack), (Telugu), [Remastered] ...
    .replace(/\((?:from|original|remaster|feat|ft)\b[^)]*\)/gi, '')
    .replace(/\((?:hindi|telugu|tamil|kannada|malayalam|punjabi|bengali|marathi|english)\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+-\s+(?:from|original|remaster)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  let cleanArtist = artist === 'Unknown Artist' ? '' : artist.trim();

  if (!cleanArtist && cleanSong.includes(' - ')) {
    const parts = cleanSong.split(' - ');
    cleanArtist = (parts[0] ?? '').trim();
    cleanSong = parts.slice(1).join(' - ').trim();
  }

  return {
    title: cleanSong || title.trim(),
    artist: cleanArtist || artist.trim()
  };
}

/** The first credited artist of "A, B & C feat. D". */
export function leadArtist(artist: string): string {
  return (artist.split(/,|&| feat\.? | ft\.? | x /i)[0] ?? artist).trim();
}

/** Ordered, de-duplicated (title, artist) pairs to try against LRCLIB, exact pair first. */
function lrclibAttempts(title: string, artist: string): Array<{ readonly title: string; readonly artist: string }> {
  const lead = leadArtist(artist);
  const shortTitle = (title.split(/\s+-\s+/)[0] ?? title).trim();
  const coArtists = artist.split(/,|&| feat\.? | ft\.? | x /i).map((name) => name.trim()).filter(Boolean).slice(1, 3);
  const candidates = [
    { title, artist },
    { title, artist: lead },
    ...(shortTitle && shortTitle !== title ? [{ title: shortTitle, artist: lead }] : []),
    ...coArtists.map((name) => ({ title, artist: name }))
  ];
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      const key = `${candidate.title.toLocaleLowerCase()}|${candidate.artist.toLocaleLowerCase()}`;
      if (!candidate.title || !candidate.artist || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

/** Loose title guard for fuzzy searches: one name contains the other after normalising. */
function titlesAlike(found: string | undefined, wanted: string): boolean {
  const normalise = (value: string): string => value.toLocaleLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const left = normalise(found ?? '');
  const right = normalise(wanted);
  return left.length > 0 && right.length > 0 && (left.includes(right) || right.includes(left));
}

function toPayload(best: LrclibEntry, title: string, duration: number | undefined, source: 'LRCLIB' | 'LRCLIB-search'): LyricsPayload {
  const raw = best.syncedLyrics?.trim() || best.plainLyrics?.trim() || '';
  const score = scoreLyrics(best, title, duration);
  const synced = Boolean(best.syncedLyrics?.trim());
  return {
    source: synced ? source : 'interpolated',
    type: synced ? 'synced' : 'plain',
    matchScore: score.score,
    matchReason: score.reason,
    lines: parseLyrics(raw, duration ?? best.duration ?? 180)
  };
}

function toPayloadFromRaw(raw: string, title: string, duration: number | undefined, source: string): LyricsPayload {
  const synced = hasTimestamps(raw);
  const lines = parseLyrics(raw, duration ?? 180);
  return {
    source: synced ? source : 'interpolated',
    type: synced ? 'synced' : 'plain',
    matchScore: synced ? 50 : 20,
    matchReason: `${title} • ${synced ? 'Synced' : 'Plain text'}`,
    lines
  };
}

/** An aggregator's candidate as a payload; the recording it was filed under leads its match reason. */
function candidatePayload(candidate: LyricsCandidate, title: string, duration: number | undefined): LyricsPayload {
  const payload = toPayloadFromRaw(candidate.lyrics, title, duration, candidate.source);
  return candidate.filedAs ? { ...payload, matchReason: `${candidate.filedAs} • ${payload.type === 'synced' ? 'Synced' : 'Plain text'}` } : payload;
}

function languageCode(language: string | undefined): string {
  const codes: Readonly<Record<string, string>> = { tamil: 'ta', telugu: 'te', hindi: 'hi', malayalam: 'ml', kannada: 'kn', english: 'en' };
  return codes[language?.toLowerCase() ?? ''] ?? (language?.length === 2 ? language.toLowerCase() : 'und');
}

/** Private site provenance never reaches the plain playback payload. */
function sitePayloads(found: SiteLyrics | null, duration: number | undefined): LyricsPayload[] {
  return (found?.versions ?? []).flatMap(version => {
    const lines = parseLyrics(version.text, duration ?? 180);
    return lines.length ? [{ source: `Found online (${versionLabel(version)})`, type: 'plain' as const, matchScore: 30, matchReason: 'Plain text', lines }] : [];
  });
}

/** Same words and same kind means the same version, whichever provider or entry it came from. */
function lyricsFingerprint(payload: LyricsPayload): string {
  const words = payload.lines
    .map((line) => line.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean)
    .slice(0, 8)
    .join('|');
  return words ? `${payload.type}:${words}` : '';
}

function isUsable(entry: LrclibEntry, syncedOnly: boolean): boolean {
  const synced = entry.syncedLyrics?.trim() ?? '';
  const plain = entry.plainLyrics?.trim() ?? '';
  if (containsHtml(synced) || containsHtml(plain)) {
    return false;
  }
  return Boolean((syncedOnly ? synced : synced || plain));
}

function containsHtml(value: string): boolean {
  return /<div|<html|<!doctype/i.test(value);
}
