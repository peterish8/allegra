import type { AppConfig } from './config.js';
import { ArtworkService } from './services/artwork.js';
import { LyricsService } from './services/lyrics.js';
import { RecommendationService } from './services/recommendations.js';
import { RadioService } from './services/radio.js';
import { TranslationService } from './services/translation.js';
import { CatalogService } from './catalog/catalog.js';
import { ConvexCoverStorage, ConvexGrantLedger, ConvexUserStore } from './db/convex.js';
import { ConvexGateway } from './db/convexGateway.js';
import { ConvexTasteTally } from './db/convexTasteTally.js';
import { MemoryGrantLedger, type GrantLedger } from './oauth/ledger.js';
import { AuthService } from './auth/auth.js';
import { ListenerActions } from './user/actions.js';
import { ConvexTokenVerifier, FirstMatchVerifier, GuestTokenVerifier, type TokenVerifier } from './auth/verifier.js';
import { MemoryCacheStore, type CacheStore } from './lib/cache.js';
import type { CoverStorage } from './lib/covers.js';
import { StreamResolver } from './lib/streamResolver.js';
import { GaanaProvider } from './providers/gaana.js';
import { ItunesProvider } from './providers/itunes.js';
import { LrclibProvider } from './providers/lrclib.js';
import { BetterLyricsProvider } from './providers/betterlyrics.js';
import { KuGouProvider } from './providers/kugou.js';
import { LyricaProvider } from './providers/lyrica.js';
import { UnisonProvider } from './providers/unison.js';
import { YouLyPlusProvider } from './providers/youlyplus.js';
import { MusicBrainzReleaseAuthority, type ReleaseAuthority } from './providers/musicbrainz.js';
import { SaavnProvider } from './providers/saavn.js';
import { MemoryUserStore, type UserStore } from './user/store.js';
import { MemoryTasteTally, type TasteTally } from './user/tasteTally.js';
import { ImportMatcher } from './services/importMatch.js';
import { createLogger } from './lib/logger.js';
import { ArtistFactsService } from './services/artistFacts.js';
import { BlendBuildService } from './services/blendBuild.js';
import { ConvexBlendStore } from './db/convexBlendStore.js';
import { MemoryBlendStore, type BlendStore } from './user/blendStore.js';
import { ConvexLibraryStore } from './db/convexLibrary.js';
import { snapshotOf } from './user/libraryOps.js';
import type { SongSnapshot } from './shared/songRef.js';
import { SpotifyProvider } from './providers/spotify.js';
import { SpotifyStore } from './db/spotifyStore.js';
import { SpotifyTransferService } from './services/spotifyTransfer.js';

/**
 * Provider settings exactly as config.ts loads them (documented there). Each is optional here so a
 * test sets only what it uses; an unset optional provider is simply not built.
 */
type ProviderSettings = Partial<
  Pick<
    AppConfig,
    | 'version'
    | 'saavnApiUrl'
    | 'saavnSecondaryApiUrl'
    | 'gaanaApiUrl'
    | 'lrclibApiUrl'
    | 'lyricaApiUrl'
    | 'betterLyricsApiUrl'
    | 'betterLyricsApiKey'
    | 'youLyPlusServers'
    | 'unisonApiUrl'
    | 'kugouApiUrl'
    | 'musicBrainz'
    | 'translation'
    | 'convexUrl'
    | 'convexServerSecret'
    | 'convexSiteUrl'
    | 'spotifyClientId'
    | 'spotifyRedirectUri'
  >
>;

export interface ServiceOptions extends ProviderSettings {
  readonly jwtSecret: string;
  readonly cacheStore?: CacheStore;
  readonly fetchImpl?: typeof fetch;
  /** Injected in tests so the election runs without reaching MusicBrainz. */
  readonly releaseAuthority?: ReleaseAuthority;
  readonly userStore?: UserStore;
  /** Injected in tests; otherwise Convex when configured and memory for local development. */
  readonly tally?: TasteTally;
  readonly blends?: BlendStore;
  /** Verifier for signed-in accounts. Built from convexSiteUrl unless supplied (tests). */
  readonly accountVerifier?: TokenVerifier;
}

export interface AppServices {
  readonly catalog: CatalogService;
  readonly stream: StreamResolver;
  readonly artwork: ArtworkService;
  readonly lyrics: LyricsService;
  readonly auth: AuthService;
  /** Profiles, share links and reports: the store the account routes read and erase through. */
  readonly users: UserStore;
  /** Bounded per-listener most-played tally used for personalization and Blend. */
  readonly tally: TasteTally;
  /** Finds imported Spotify/CSV tracks in the catalog (shared, cached results). */
  readonly importMatcher: ImportMatcher;
  /** Blend membership, invites and stored builds. */
  readonly blends: BlendStore;
  /** Builds a Blend when it is due and shapes it for one viewer. */
  readonly blendBuilder: BlendBuildService;
  /** Read-only Spotify Web API OAuth and bounded incremental playlist transfer. */
  readonly spotify: SpotifyTransferService;
  /** What a listener does (likes, playlists, sharing, plays), for the routes and the MCP tools alike. */
  readonly actions: ListenerActions;
  readonly translation: TranslationService;
  readonly recommendations: RecommendationService;
  /** Candidates for a song radio; the client ranks them as the listener skips and finishes. */
  readonly radio: RadioService;
  /** Playlist cover storage (Convex). Undefined without Convex: uploads answer 503. */
  readonly covers?: CoverStorage;
  /** Single use for MCP OAuth codes and refresh tokens. */
  readonly grants: GrantLedger;
  /** True when real (Google) accounts exist, so MCP connects require one rather than a guest. */
  readonly accountsEnabled: boolean;
}

export function createServices(options: ServiceOptions): AppServices {
  const cache = options.cacheStore ?? new MemoryCacheStore();

  const saavn = new SaavnProvider({
    baseUrl: options.saavnApiUrl ?? 'https://example.invalid/api',
    ...(options.saavnSecondaryApiUrl ? { secondaryBaseUrl: options.saavnSecondaryApiUrl } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
  const gaana = new GaanaProvider({
    baseUrl: options.gaanaApiUrl ?? 'https://example.invalid/api',
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
  // Names the record behind a row the provider only has on a playlist.
  const releaseAuthority = options.releaseAuthority
    ?? (options.musicBrainz
      ? new MusicBrainzReleaseAuthority({
          baseUrl: options.musicBrainz.baseUrl,
          coverArtUrl: options.musicBrainz.coverArtUrl,
          contact: options.musicBrainz.contact,
          ...(options.version ? { appVersion: options.version } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
        })
      : undefined);
  const catalog = new CatalogService({ saavn, gaana, cache, ...(releaseAuthority ? { releaseAuthority } : {}) });
  // With both set, listener data lives in Convex; otherwise it stays in memory.
  const convex = options.convexUrl && options.convexServerSecret
    ? new ConvexGateway({ url: options.convexUrl, serverSecret: options.convexServerSecret, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) })
    : undefined;
  const convexStore = convex ? new ConvexUserStore(convex) : undefined;
  const userStore = options.userStore ?? convexStore ?? new MemoryUserStore();
  const tally = options.tally ?? (convex ? new ConvexTasteTally(convex) : new MemoryTasteTally());

  // Guest tokens are ours; Convex Auth signs the ones that come back from Google.
  // Without a Convex site URL only guest sessions exist, which is how local dev runs.
  const guestVerifier = new GuestTokenVerifier(options.jwtSecret);
  const convexVerifier = options.accountVerifier
    ?? (options.convexSiteUrl ? new ConvexTokenVerifier({ siteUrl: options.convexSiteUrl }) : undefined);

  const fetchImpl = options.fetchImpl ? { fetchImpl: options.fetchImpl } : {};
  const stream = new StreamResolver({ saavn, gaana, cache, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  const auth = new AuthService({
    store: userStore,
    guest: guestVerifier,
    verifier: new FirstMatchVerifier(guestVerifier, convexVerifier),
    ...(convexStore ? { directory: convexStore } : {}),
    songSnapshots: async (ids) => {
      const snapshots = new Map<string, SongSnapshot>();
      for (const song of await catalog.getSongs([...ids])) {
        const snapshot = snapshotOf(song);
        if (snapshot) snapshots.set(song.id, snapshot);
      }
      return snapshots;
    },
    // Likes and playlists live in Convex rows beside the profile; in memory otherwise.
    ...(convexStore && convex ? { library: new ConvexLibraryStore(convex) } : {})
  });
  // Playlist cover storage needs Convex; without it uploads answer 503.
  const covers = convex ? new ConvexCoverStorage(convex) : undefined;

  const importMatcher = new ImportMatcher(catalog, cache);
  const spotifyProvider = options.spotifyClientId ? new SpotifyProvider(options.spotifyClientId, options.fetchImpl ?? fetch) : undefined;
  const spotifyStore = new SpotifyStore(convex, options.convexServerSecret ?? options.jwtSecret);
  const spotify = new SpotifyTransferService(spotifyProvider, options.spotifyClientId, options.spotifyRedirectUri ?? 'https://allegravibe.vercel.app/api/spotify/callback', spotifyStore, auth, importMatcher);
  const blendLog = createLogger(process.env.NODE_ENV === 'production');
  const blends = options.blends ?? (convex ? new ConvexBlendStore(convex) : new MemoryBlendStore());
  const blendBuilder = new BlendBuildService({
    blends,
    tally,
    library: () => auth.library,
    facts: new ArtistFactsService(catalog, cache),
    catalog,
    resolver: importMatcher,
    // Counts and timings only (PLAN.md §0); silent outside production.
    log: (fields) => { blendLog.info(fields, 'blend build'); }
  });

  return {
    catalog,
    stream,
    artwork: new ArtworkService(new ItunesProvider({ ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }), catalog, cache),
    lyrics: new LyricsService(new LrclibProvider({
      ...(options.lrclibApiUrl ? { baseUrl: options.lrclibApiUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
    }), cache, {
      ...(options.lyricaApiUrl ? { lyrica: new LyricaProvider({ baseUrl: options.lyricaApiUrl, timeoutMs: 25_000, ...fetchImpl }) } : {}),
      ...(options.betterLyricsApiUrl ? { betterLyrics: new BetterLyricsProvider({ baseUrl: options.betterLyricsApiUrl, ...(options.betterLyricsApiKey ? { apiKey: options.betterLyricsApiKey } : {}), ...fetchImpl }) } : {}),
      ...(options.youLyPlusServers ? { youLyPlus: new YouLyPlusProvider({ servers: options.youLyPlusServers, ...fetchImpl }) } : {}),
      ...(options.unisonApiUrl ? { unison: new UnisonProvider({ baseUrl: options.unisonApiUrl, ...fetchImpl }) } : {}),
      ...(options.kugouApiUrl ? { kugou: new KuGouProvider({ baseUrl: options.kugouApiUrl, ...fetchImpl }) } : {})
    }),
    auth,
    users: userStore,
    tally,
    importMatcher,
    blends,
    blendBuilder,
    spotify,
    actions: new ListenerActions(auth, userStore, catalog, covers, Date.now, tally),
    translation: new TranslationService(cache, {
      ...(options.translation?.baseUrl ? { baseUrl: options.translation.baseUrl } : {}),
      ...(options.translation?.contactEmail ? { contactEmail: options.translation.contactEmail } : {}),
      ...(options.translation?.fallbackBaseUrl ? { fallbackBaseUrl: options.translation.fallbackBaseUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
    }),
    recommendations: new RecommendationService(catalog, cache),
    radio: new RadioService(catalog),
    ...(covers ? { covers } : {}),
    grants: convex ? new ConvexGrantLedger(convex) : new MemoryGrantLedger(),
    accountsEnabled: Boolean(convexVerifier)
  };
}
