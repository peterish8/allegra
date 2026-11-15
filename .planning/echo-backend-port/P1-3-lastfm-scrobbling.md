# P1-3 Last.fm scrobbling (now playing + durable scrobble queue), optional ListenBrainz

Draft id: P1-5. Priority: P1. Largest item; ship as 5 PRs (section 5). Branch prefix: `feat/lastfm-*`.
Touches: `packages/shared` (sync:shared), `convex/` (convex dev --once, convex:test list), `apps/api` (new router +
supertest), `apps/web`, `apps/mobile` (version bump), `docs/api-contract.md`, privacy copy.

## 1. Goal and user-visible outcome

A signed-in listener can connect their Last.fm account from Settings on the website or the phone. From then on,
whatever they play on any of their devices shows as "now playing" on Last.fm and is added to their Last.fm history
once it counts as a listen under Last.fm's rules. Scrobbles that cannot be sent (Last.fm down, phone offline doesn't
matter because the server sends them) are kept and retried in order for up to 14 days. The listener can pause
scrobbling, disconnect, and their link and queue are erased with their account.

Non-goals: Last.fm data import, charts, recommendations from Last.fm, "love" sync (optional slice 7, off by default),
guest accounts (account only, as Spotify), scrobbling from the Expo/iOS path, scrobbling devices that only control
playback (Connect controllers, LuvLink controller-only members never post listens, `docs/api-contract.md:397-403`).

## 2. Evidence

Current state:

| Fact | Where |
| --- | --- |
| The playing device posts `POST /api/me/recently-played` after 5 heard seconds (`LISTEN_RULES.historyAfterSec`) | `docs/api-contract.md:397-403`, `packages/shared/listenSignal.ts:39-44`, route `apps/api/src/routes/user.ts:217` |
| When the song is left, the device posts `POST /api/me/taste/signal` with cumulative heard seconds, `playedAt`, the song snapshot and how it ended | `apps/api/src/routes/user.ts:309-335`; clients `apps/web/src/lib/api.ts:803`, `apps/mobile/src/services/account/allegraApi.ts:119` |
| `ListenerActions.listened` returns early when personalisation is off | `apps/api/src/user/actions.ts:350-351` |
| `SongSnapshot` = `{ ref, title, artist, album?, artwork, duration }`, duration in seconds | `packages/shared/songRef.ts` (interface `SongSnapshot`) |
| Third-party link pattern to copy: API owns protocol and encryption (AES-256-GCM, key from HKDF over the Convex server secret), Convex stores ciphertext through secret-gated functions, a Convex scheduler calls a secret-gated internal API route | `apps/api/src/db/spotifyStore.ts:1-18,158-170`, `convex/spotify.ts:1-60`, `convex/spotifyCron.ts:11-50`, `apps/api/src/routes/spotify.ts:11-88` |
| `accountUser` gate (Google account required) | `apps/api/src/routes/imports.ts` (`accountUser`, used at `routes/spotify.ts:15`) |
| Account erase deletes third-party rows in batches | `convex/account.ts:45,144-160` |
| Convex test list is explicit in the root script | `package.json` `convex:test` |
| `@convex-dev/rate-limiter` is installed and mounted | `convex/convex.config.ts` |
| API copies of shared modules are generated | `scripts/sync-shared.mjs:12-33` |
| No scrobbling exists anywhere | `rg -i "lastfm|scrobbl" apps convex packages` returns nothing (2026-11-13) |

Behavioural reference (Echo, read only): `Echo-Music/app/src/main/kotlin/com/music/echo/utils/lastfm/LastFM.kt`
(signature over sorted params, now playing, scrobble, love) and `.../utils/ScrobbleManager.kt` (client-side timer).
Echo's default threshold is `min(50% of duration, 50 s)` (`ScrobbleManager.kt:13-15,116-121`), which is stricter than
Last.fm's rule in one direction and looser in the other; Allegra must follow Last.fm's published rule, not Echo's default.

External facts (accessed 2026-11-13):
- Rules: "The track must be longer than 30 seconds. And the track has been played for at least half its duration, or for
  4 minutes (whichever occurs earlier)." Now Playing "should not be retried". Batch up to 50. Retry codes 11 and 16;
  code 9 means re-authenticate; all other codes must not be retried. Cache failed scrobbles and send in order.
  Ignored codes 1 artist, 2 track, 3 timestamp too old, 4 too new, 5 daily limit. https://www.last.fm/api/scrobbling
- `track.scrobble`: POST, array notation `artist[i]`, `track[i]`, `timestamp[i]` (UTC Unix seconds, start time),
  optional `album[i]`, `duration[i]` (seconds), `chosenByUser[i]`; "parameter names MUST be sorted according to the ASCII
  table (i.e., artist[10] comes before artist[1])". Errors 2-11, 13, 16, 26 suspended key, 29 rate limit.
  https://www.last.fm/api/show/track.scrobble
- Web auth: send the user to `http://www.last.fm/api/auth/?api_key=xxx&cb=<url>`; Last.fm redirects to the callback with
  `?token=` (or `&token=` when the callback has a query); tokens last 60 minutes and are single use; `auth.getSession`
  with `api_key`, `token`, `api_sig`; session keys do not expire unless the user revokes; signature = md5 of params sorted
  by name concatenated as `<name><value>`, then the secret appended, UTF-8. https://www.last.fm/api/webauth
- All error codes: https://www.last.fm/api/errorcodes (8 "Operation failed... try again", 29 rate limit).
- API ToS: non-commercial use only without a commercial agreement; credit and link to Last.fm; rate limits at Last.fm's
  discretion; implement caching per HTTP headers. https://www.last.fm/api/tos
- PARTLY VERIFIED: `format` and `callback` are excluded from the signature. Source: third-party implementation notes
  (https://github.com/Vaporjawn/Last-FM-Scrobbler/blob/main/docs/modules/core.md). Default: exclude both; the live
  verification step in 5.3 proves it with a real key.
- UNVERIFIED: the exact JSON shape of `format=json` responses (Last.fm docs show XML). Default parser below tolerates
  `scrobbles.scrobble` as object or array and `@attr.accepted` / `@attr.ignored` as string or number; the live step
  records a real response into a fixture.
- UNVERIFIED: the numeric rate limit and how old a timestamp may be (code 3). Defaults: at most one flush per user per
  30 s, batches of 50, drop rows older than 14 days.
- UNVERIFIED whether `https://ws.audioscrobbler.com/2.0/` is accepted (docs print `http://`). Default: use https; the live
  step confirms; never send a session key over plain http.
- ListenBrainz: `POST /1/submit-listens`, header `Authorization: Token <user token>`, `listen_type` `single` |
  `playing_now` | `import`, `listened_at` Unix seconds, `playing_now` without timestamp, `additional_info.duration_ms`,
  `submission_client`, `media_player`, `music_service`. https://listenbrainz.readthedocs.io/en/latest/users/json.html and
  https://listenbrainz.readthedocs.io/en/latest/users/api/core.html . UNVERIFIED numeric limits
  (`MAX_LISTENS_PER_REQUEST`); default batch 50.

## 3. Design decisions

| Decision | Rationale |
| --- | --- |
| Follow the Spotify split: Express owns signing and HTTP, Convex owns durable rows, a Convex scheduler calls `/api/internal/scrobble/flush` | Same trust boundaries already reviewed; the shared secret and decryption key never live in Convex |
| Eligibility is decided server-side from the listen signal (`heardSeconds`, snapshot `duration`) | Both clients already send these; one rule, no client change needed for scrobbling itself |
| Rule: `duration > 30` and `heard >= min(duration / 2, 240)`; heard = cumulative audio heard, seeks excluded | Last.fm's published rule; `heardSeconds` is already "audio actually heard" (`listenSignal.ts:11-13`) |
| `timestamp` = floor(`playedAt` / 1000) where `playedAt` is the listen start; clamp future values | Last.fm wants start time in UTC seconds |
| Artist sent = the first credited artist (`creditedArtists(artist)[0]`, `packages/shared/identity.ts`), track = catalog title unchanged, album = snapshot album when present, `duration` = seconds | Catalog credits are comma-joined lists; Last.fm treats the string as one artist name. Do not "clean" titles (Last.fm: use well-structured metadata, not guesses) |
| `chosenByUser` omitted | Last.fm: "If there is any ambiguity or doubt then don't send this value" |
| Now playing is sent inline from `POST /me/recently-played`, bounded at 1.5 s, never retried, never queued | Docs say do not retry; must not slow the history write meaningfully |
| Scrobble queue rows are deduplicated by `(userId, dedupeKey)` with `dedupeKey = ref + "@" + timestampSec` | A retried signal post must not double-scrobble |
| Flush debounce 30 s after the first new row; batches of 50 oldest first; lease 60 s | Fewer requests from Vercel's shared IPs; in-order delivery |
| Retry delays for 8, 11, 16, 29, HTTP 5xx, timeouts: 60 s, 5 min, 30 min, 2 h, 6 h, then every 6 h; drop after 14 days | Bounded; matches "retry later" codes; drops what Last.fm would ignore as too old |
| Code 9: mark the link `needsReauth`, keep rows (still bounded by 14 days), stop flushing until reconnect | Docs: re-authenticate before retrying |
| Codes 10, 26: log at error level, keep rows, retry every 6 h | Operator problem (bad or suspended key), not the listener's |
| Any other code: drop the batch rows and log | Docs: do not retry |
| Scrobbling is independent of the personalisation switch | It is a separate, explicit link the listener made; the settings copy says so. Open question 1 |
| Feature flag `LASTFM_ENABLED` (default off) plus `LASTFM_API_KEY` and `LASTFM_SHARED_SECRET` | Ship dark; secrets server-side only (hard rule 2) |
| Callback URL derived from `ALLEGRA_ORIGIN` + `/api/lastfm/callback?state=<state>` | No hard-coded production URL (`CLAUDE.md`, before-you-call-it-done) |
| ListenBrainz behind the same queue as a second "sink", in a separate optional slice | Same rows, a `sink` field; token pasted by the listener |

Rejected: signing in Convex (no MD5 in Web Crypto, secret would live in Convex); client-side scrobbling (secret in
the app bundle, violates hard rule 2); queueing now-playing (docs say no retry); `@convex-dev/workpool` (not
installed; the scheduler plus a lease is enough for one row set per user).

## 4. Exact change list

### 4.1 `packages/shared/scrobble.ts` (create; add `'scrobble.ts'` to `SHARED_COPIES` in `scripts/sync-shared.mjs`)

Pure, no npm imports (`tests/infra` enforces).

```ts
export const SCROBBLE_RULES = {
  /** A track must be strictly longer than this (seconds). */
  minTrackSec: 30,
  /** Half the track, capped at this many heard seconds. */
  capSec: 240,
  batchSize: 50,
  flushDebounceSec: 30,
  leaseSec: 60,
  retryDelaysSec: [60, 300, 1_800, 7_200, 21_600] as const,
  maxAgeDays: 14,
  /** A client clock may be ahead by this much before playedAt is distrusted. */
  futureSlackSec: 300,
  nowPlayingBudgetMs: 1_500
} as const;

export type ScrobbleSink = 'lastfm' | 'listenbrainz';

/** Heard seconds needed before a track counts, or null when the track can never count. */
export function scrobbleThresholdSec(durationSec: number): number | null {
  if (!Number.isFinite(durationSec) || durationSec <= SCROBBLE_RULES.minTrackSec) return null;
  return Math.min(durationSec / 2, SCROBBLE_RULES.capSec);
}

export function isScrobbleEligible(input: { readonly durationSec: number; readonly heardSec: number }): boolean {
  const threshold = scrobbleThresholdSec(input.durationSec);
  return threshold !== null && Number.isFinite(input.heardSec) && input.heardSec >= threshold;
}

/** Retry delay after [attempts] failures (1-based), in seconds. */
export function retryDelaySec(attempts: number): number {
  const table = SCROBBLE_RULES.retryDelaysSec;
  return table[Math.min(Math.max(attempts, 1), table.length) - 1]!;
}

/** Unix seconds for a listen that started at [playedAtIso]; null when unusable. */
export function scrobbleTimestamp(playedAtIso: string, heardSec: number, nowMs: number): number | null {
  const started = Date.parse(playedAtIso);
  if (!Number.isFinite(started)) return null;
  const now = Math.floor(nowMs / 1000);
  let ts = Math.floor(started / 1000);
  if (ts > now + SCROBBLE_RULES.futureSlackSec) ts = now - Math.ceil(Math.max(0, heardSec));
  if (now - ts > SCROBBLE_RULES.maxAgeDays * 86_400) return null;
  return ts;
}

export interface ScrobbleStatus {
  readonly available: boolean;              // server has Last.fm configured
  readonly lastfm: { readonly username: string; readonly scrobbling: boolean; readonly needsReauth: boolean; readonly connectedAt: string } | null;
  readonly listenbrainz: { readonly username: string; readonly scrobbling: boolean } | null;
  readonly pending: number;                 // rows waiting, capped at 999 for display
}
```

Worked examples (exact test vectors):
- `scrobbleThresholdSec(30)` -> null (must be longer than 30). `(31)` -> 15.5. `(245)` -> 122.5. `(600)` -> 240. `(480)` -> 240.
- `isScrobbleEligible({ durationSec: 245, heardSec: 122 })` -> false; `122.5` -> true.
- `isScrobbleEligible({ durationSec: 600, heardSec: 239.9 })` -> false; `240` -> true.
- `retryDelaySec(1)` 60, `(5)` 21600, `(9)` 21600.
- `scrobbleTimestamp('2026-11-13T10:00:00.000Z', 200, Date.parse('2026-11-13T10:05:00Z'))` -> 1794564000.
  Future: playedAt `2026-11-13T10:30:00Z` (1794565800) with now 10:05 (1794564300) is more than 300 s ahead, heard 200
  -> 1794564300 - 200 = 1794564100.
  Too old: playedAt 2026-10-29T10:04:59Z with now 2026-11-13T10:05:00Z (15 days) -> null.

### 4.2 `apps/api/src/providers/lastfm.ts` (create)

```ts
export const LASTFM_API_ROOT = 'https://ws.audioscrobbler.com/2.0/';
export const LASTFM_AUTH_PAGE = 'https://www.last.fm/api/auth/';
const TIMEOUT_MS = 8_000;
/** Never part of the signature. */
const UNSIGNED = new Set(['format', 'callback', 'api_sig']);

export class LastfmError extends Error {
  public constructor(public readonly code: number, message: string, public readonly httpStatus: number) { super(message); this.name = 'LastfmError'; }
}

/** md5 over params sorted by name (UTF-16 code unit order == ASCII for these names), `<name><value>`, then the secret. */
export function lastfmSignature(params: Readonly<Record<string, string>>, secret: string): string;

export interface ScrobbleItem { readonly artist: string; readonly track: string; readonly timestamp: number; readonly album?: string; readonly durationSec?: number }
export interface ScrobbleOutcome { readonly accepted: number; readonly ignored: Array<{ readonly index: number; readonly code: number }> }

export class LastfmClient {
  public constructor(options: { apiKey: string; secret: string; fetchImpl?: typeof fetch; timeoutMs?: number });
  public authUrl(callbackUrl: string): string;                                     // LASTFM_AUTH_PAGE?api_key=..&cb=<encoded>
  public getSession(token: string): Promise<{ readonly sessionKey: string; readonly username: string }>;
  public updateNowPlaying(sessionKey: string, item: Omit<ScrobbleItem, 'timestamp'>): Promise<void>;
  public scrobble(sessionKey: string, items: readonly ScrobbleItem[]): Promise<ScrobbleOutcome>;  // 1..50 items, always array notation
}
```

Request building: `URLSearchParams` with all params plus `api_sig` and `format=json`; `POST` with
`Content-Type: application/x-www-form-urlencoded; charset=UTF-8`; use `fetchBodyWithTimeout`
(`apps/api/src/lib/fetchWithTimeout.ts:53-67`, the body deadline covers the body, hard rule 9). Parse JSON; if it has a
numeric `error`, throw `LastfmError(error, message, status)`. Never put `sk`, `api_sig` or the token in an error message.
`getSession` reads `session.key` and `session.name`.

Signature test vectors (computed 2026-11-13 with Node `crypto.createHash('md5')`, UTF-8):
1. Docs example: `md5("api_keyxxxxxxxxmethodauth.getSessiontokenxxxxxxxmysecret")` = `68afb32bee072407a63b6c41f3e1e2b4`.
2. `auth.getSession` with `api_key=0123456789abcdef0123456789abcdef`, `token=TOKEN123`, secret `s3cr3t`:
   base `api_key0123456789abcdef0123456789abcdefmethodauth.getSessiontokenTOKEN123s3cr3t` -> `b1fc43025345b55fc157500c52c1cbcf`.
3. Batch, secret `s3cr3t`, params `method=track.scrobble`, `api_key=0123456789abcdef0123456789abcdef`, `sk=SESSIONKEY`,
   `artist[0]=Björk`, `track[0]=Jóga`, `timestamp[0]=1700000000`, `artist[1]=A. R. Rahman`, `track[1]=Jai Ho`,
   `timestamp[1]=1700000300`, `duration[1]=319` (plus `format=json`, excluded). Sorted names:
   `api_key, artist[0], artist[1], duration[1], method, sk, timestamp[0], timestamp[1], track[0], track[1]`;
   md5 = `b391eb61195ff2a99977a8fc131eee41`.
4. Now playing: `api_key=0123...cdef, artist=Björk, method=track.updateNowPlaying, sk=SESSIONKEY, track=Jóga`, secret
   `s3cr3t` -> `6b121cd8e63a3b24aa5d9be5bdda1992`.
5. Ordering: names `artist[0]..artist[11]` sort as `artist[0], artist[10], artist[11], artist[1], ...` (ASCII '0' < ']').
   With batches capped at 50 indices, `[10]`..`[49]` interleave the same way; plain `Array.prototype.sort()` gives this.

Write `ö` and `ó` in test sources as `\u{f6}` and `\u{f3}` escapes (repo memory: typed `\uXXXX` can be rewritten).

### 4.3 `apps/api/src/db/scrobbleStore.ts` (create)

Mirror of `SpotifyStore`: `new ScrobbleStore(convex: ConvexGateway | undefined, serverSecret: string)`;
key = `hkdfSync('sha256', serverSecret, 'allegra-lastfm-v1', 'credential-encryption', 32)`; AES-256-GCM with a 12-byte
random IV; ciphertext format identical to `spotifyStore.ts:158-170` (reuse by extracting `sealText`/`openText` into
`apps/api/src/db/credentialCipher.ts` and pointing both stores at it; keep Spotify's info string so old rows still open).
Methods (each one Convex call through the gateway):

```ts
saveAuthState(stateHash: string, value: { userId: string; returnTo: 'web' | 'mobile' }, expiresAt: number): Promise<void>
consumeAuthState(stateHash: string, now: number): Promise<{ userId: string; returnTo: 'web' | 'mobile' } | null>
connect(userId: string, username: string, sessionKey: string, now: number): Promise<void>     // encrypts
status(userId: string): Promise<ScrobbleStatus>
setScrobbling(userId: string, sink: ScrobbleSink, enabled: boolean): Promise<boolean>
disconnect(userId: string, sink: ScrobbleSink): Promise<void>
enqueue(userId: string, row: QueuedScrobble, now: number): Promise<'queued' | 'duplicate' | 'not-linked'>
claim(userId: string, now: number): Promise<{ sessionKey: string; generation: number; leaseToken: string; rows: Array<QueuedScrobble & { id: string; attempts: number }> } | null>
settle(userId: string, leaseToken: string, result: SettleInput, now: number): Promise<void>
```

Without Convex (local dev) use an in-memory implementation `MemoryScrobbleStore` in the same file so `npm run dev` works.

### 4.4 `apps/api/src/services/scrobbles.ts` (create)

```ts
export class ScrobbleService {
  public constructor(deps: { client: LastfmClient | undefined; store: ScrobbleStore; origin: string | undefined; now?: () => number; log?: (fields: Record<string, unknown>, msg: string) => void });
  public get available(): boolean;                               // client && origin
  public status(userId: string): Promise<ScrobbleStatus>;
  public connectUrl(userId: string, returnTo: 'web' | 'mobile'): Promise<string>;   // state = 32 random bytes base64url; stores sha256(state)
  public callback(state: string, token: string): Promise<'web' | 'mobile'>;          // consume state (10 min TTL), getSession, connect
  public nowPlaying(userId: string, snapshot: SongSnapshot): Promise<void>;          // swallows all errors, bounded by caller
  public listened(userId: string, input: { snapshot: SongSnapshot; heardSec: number; playedAt: string }): Promise<void>;
  public flush(userId: string): Promise<{ sent: number; retried: number; dropped: number; more: boolean }>;
}
```

`listened`: `isScrobbleEligible` -> `scrobbleTimestamp` -> `store.enqueue` (Convex schedules the flush). Never throws to
the route (catch, log `scrobble enqueue failed` with userId hash only).

`flush` pseudocode:

```
claim = store.claim(userId, now) ; if !claim return {0,0,0,false}
try outcome = client.scrobble(claim.sessionKey, claim.rows.map(toItem))
  sent = rows not in outcome.ignored; dropped = ignored rows (codes 1..5 are final: Last.fm stored nothing and never will)
  settle({ sent, drop: ignored, retry: [] })
catch LastfmError e:
  if e.code == 9: settle({ retry: all with delay 6h, reauth: true })
  else if e.code in {8, 11, 16, 29} or e.httpStatus >= 500: settle({ retry: all with retryDelaySec(attempts+1) })
  else if e.code in {10, 26}: log.error; settle({ retry: all with 21600 })
  else: log.warn; settle({ drop: all })
catch timeout/network: settle({ retry: all with retryDelaySec(attempts+1) })
```

Logging: `{ route: 'scrobble/flush', user: redactSecret(userId), rows, accepted, ignored, code }` through the pino
logger (`createLogger(process.env.NODE_ENV === 'production')`, as `services.ts:196`), never `console.log`, never titles,
never the session key. Use `redactSecret` from P2-1 when it has landed; until then log no user id.

### 4.5 `apps/api/src/routes/scrobble.ts` (create) and wiring

```
GET    /api/lastfm/status                → accountUser → sendSuccess(ScrobbleStatus)
POST   /api/lastfm/connect   {returnTo}  → accountUser → { url }          (503 "Last.fm isn't set up here." when !available)
GET    /api/lastfm/callback?state&token  → 303 to `${origin}/settings?lastfm=connected|failed|cancelled` or `lyricflow://open/settings?lastfm=...`
PATCH  /api/lastfm/settings  {scrobbling: boolean} → accountUser → { scrobbling }
POST   /api/lastfm/disconnect            → accountUser → { disconnected: true }
POST   /api/internal/scrobble/flush {userId} → x-convex-server-secret constant-time check (copy routes/spotify.ts:72-88) → flush result
```

- `apps/api/src/app.ts`: mount `app.use('/api', scrobbleRouter(services.scrobbles, services.auth, options.convexServerSecret))`
  after the Spotify router (line ~157) and only when `options.lastfmEnabled === true` (otherwise the 404 fallback answers).
  Rate limiting (`createRateLimiter`, line 190+): route `path.startsWith('/api/lastfm')` to the `oauth` bucket
  (30/min). `/api/internal/` is already exempt (line 232).
- `apps/api/src/routes/user.ts:217` (`POST /me/recently-played`): after the existing `recordPlay`, run
  `withinBudget(services.scrobbles.nowPlaying(user.userId, snapshot), SCROBBLE_RULES.nowPlayingBudgetMs)` concurrently with
  the history write (`Promise.all`), only when a snapshot is present. Pass `ScrobbleService` into `userRouter` (signature
  change at `app.ts:146`).
- `apps/api/src/routes/user.ts:309` (`POST /me/taste/signal`): after `actions.listened(...)`, when `playback.song` (snapshot)
  and `playedAt` exist, `await withinBudget(services.scrobbles.listened(user.userId, { snapshot, heardSec: seconds, playedAt }), 2_000)`.
  Independent of personalisation (it is called even when `listened` returned early).
- `apps/api/src/services.ts`: build `LastfmClient` when `options.lastfm` is set; `ScrobbleStore` from the Convex gateway;
  add `scrobbles: ScrobbleService` to `AppServices`.
- `apps/api/src/config.ts`: `lastfm?: { apiKey: string; sharedSecret: string }` read from `LASTFM_API_KEY`,
  `LASTFM_SHARED_SECRET` (both required together; 32 hex chars each, throw at boot otherwise), `lastfmEnabled` from
  `LASTFM_ENABLED === 'true'`. Add both names to `apps/api/.env.example` with empty values and a comment.

### 4.6 Convex

`convex/schema.ts` (add tables; index names include every field per `convex/_generated/ai/guidelines.md`):

```ts
scrobbleLinks: defineTable({
  userId: v.string(),
  sink: v.union(v.literal('lastfm'), v.literal('listenbrainz')),
  username: v.string(),
  encryptedCredential: v.string(),          // '' after disconnect
  scrobbling: v.boolean(),
  needsReauth: v.boolean(),
  generation: v.number(),
  connectedAt: v.number(),
  updatedAt: v.number(),
  flushScheduledAt: v.optional(v.number())
}).index('by_userId_and_sink', ['userId', 'sink']).index('by_userId', ['userId']),

scrobbleAuthStates: defineTable({
  stateHash: v.string(), userId: v.string(), returnTo: v.union(v.literal('web'), v.literal('mobile')), expiresAt: v.number()
}).index('by_stateHash', ['stateHash']).index('by_userId', ['userId']).index('by_expiresAt', ['expiresAt']),

scrobbleQueue: defineTable({
  userId: v.string(),
  sink: v.union(v.literal('lastfm'), v.literal('listenbrainz')),
  dedupeKey: v.string(),
  artist: v.string(), track: v.string(), album: v.optional(v.string()),
  timestampSec: v.number(), durationSec: v.optional(v.number()),
  attempts: v.number(), nextAttemptAt: v.number(),
  leaseToken: v.optional(v.string()), leaseUntil: v.optional(v.number()),
  createdAt: v.number()
}).index('by_userId_and_sink_and_dedupeKey', ['userId', 'sink', 'dedupeKey'])
  .index('by_userId_and_sink_and_timestampSec', ['userId', 'sink', 'timestampSec'])
  .index('by_nextAttemptAt', ['nextAttemptAt'])
  .index('by_userId', ['userId'])
```

`convex/scrobbles.ts` (create; public mutations gated by `requireSecret(args.secret)` from `convex/profiles.ts`, the
same pattern as `convex/spotify.ts:21-60`; all args validated). Note: `convex/_generated/ai/guidelines.md` prefers
`internal*` functions for anything sensitive; the API reaches Convex over plain HTTP through `ConvexGateway`
(`apps/api/src/db/convexGateway.ts:97-141`), which can only call public functions, so the secret gate is the repo's
established substitute. Functions only Convex itself calls (`deleteQueueRest`, `sweepDue`, `sweepAuthStates`) are `internal*`.
- `saveAuthState`, `consumeAuthState` (delete on read; return null when expired).
- `connect({ secret, userId, sink, username, encryptedCredential, now })`: upsert link, `generation = now`, `scrobbling = true`, `needsReauth = false`.
- `status({ secret, userId })`: links + `pending` = `take(1000)` count on `by_userId` capped at 999 (bounded read).
- `setScrobbling`, `disconnect` (credential '' and bump generation; delete that sink's queue rows in batches of 200, scheduling a continuation with `ctx.scheduler.runAfter(0, internal.scrobbles.deleteQueueRest, ...)` when more remain).
- `enqueue({ secret, userId, sink, row, now })`: returns `'not-linked'` when no live link or `scrobbling` false or `needsReauth`; `'duplicate'` when the dedupe index hits; else insert with `attempts 0`, `nextAttemptAt now`; then if `flushScheduledAt` is unset or older than `leaseSec`, schedule `internal.scrobbleFlush.flushUser` with `runAfter(flushDebounceSec * 1000)` and set `flushScheduledAt = now`. Per-user cap: if the user already has 500 rows, delete the oldest before inserting (bounded storage).
- `claim({ secret, userId, sink, now, leaseMs })`: live link required; take up to 50 rows from `by_userId_and_sink_and_timestampSec` ascending where `nextAttemptAt <= now` and lease free (`leaseUntil` unset or `< now`); write `leaseToken`/`leaseUntil`; return encrypted credential + generation + rows. Rows later than a blocked earlier row are still sent (no head-of-line block beyond due time).
- `settle({ secret, userId, sink, leaseToken, sentIds, dropIds, retry: [{ id, nextAttemptAt }], reauth, now })`: only rows whose `leaseToken` matches; delete sent and dropped; patch retried (`attempts + 1`, clear lease); drop retried rows older than 14 days; on `reauth` patch link `needsReauth = true`; clear `flushScheduledAt`; if due rows remain and not reauth, schedule another flush `runAfter(0)`.
- `internal` `sweepDue`: reads `by_nextAttemptAt` up to `now`, `take(200)`, schedules one flush per distinct user (bounded).
- `internal` `sweepAuthStates`: delete expired states, `take(200)`.

`convex/scrobbleFlush.ts` (create): `internalAction flushUser({ userId })` copying `convex/spotifyCron.ts:36-50`: read
`process.env.ALLEGRA_API_URL` and `process.env.CONVEX_SERVER_SECRET` (existing variables, no new Convex env), POST
`${apiUrl}/api/internal/scrobble/flush` with `x-convex-server-secret`, 25 s `AbortSignal.timeout`. No `"use node"` needed (fetch only).

`convex/crons.ts`: `crons.interval('flush due scrobbles', { minutes: 15 }, internal.scrobbles.sweepDue, {})` and
`crons.interval('sweep expired scrobble auth states', { hours: 24 }, internal.scrobbles.sweepAuthStates, {})`.

`convex/account.ts:144-160` (inside `eraseSome`): delete `scrobbleLinks`, `scrobbleAuthStates` and `scrobbleQueue` rows
by `by_userId` in `BATCH`-sized takes, setting `more ||= rows.length === BATCH` like the Spotify block.
Export (`GET /api/me/export`): add `scrobbling: { links: { sink, username, connectedAt }[], queued: number }` (additive).

`package.json` `convex:test`: append `convex/scrobbles.test.ts`.

### 4.7 Clients

- Web: `apps/web/src/lib/api.ts` add `fetchScrobbleStatus`, `connectLastfm(returnTo)`, `setLastfmScrobbling(enabled)`,
  `disconnectLastfm()` next to the Spotify helpers (lines 672-693). `apps/web/src/components/SettingsPage.tsx`: a
  "Last.fm" row (connected user name linking to `https://www.last.fm/user/<name>` per ToS credit rule, switch "Scrobble
  what I play", Disconnect, a "Reconnect" state when `needsReauth`). Read `?lastfm=` on load to show the result.
  Copy (sentence case): "Send what you play to your Last.fm profile. Allegra sends the song, artist, album and when you
  played it. This stays on even if you turn off personalisation."
- Mobile: `apps/mobile/src/services/scrobble/scrobbleApi.ts` (same four calls through `allegraApi`'s authenticated
  `send`), a section in `apps/mobile/src/components/settings/AllegraAccountSettings.tsx` using `SettingsKit`, open the
  URL with the in-app browser used for Spotify (`apps/mobile/src/services/spotify/spotifyApi.ts` shows the pattern),
  handle `lyricflow://open/settings?lastfm=...` in `apps/mobile/src/hooks/useDeepLinks.ts`. Bump `expo.version` (minor).
- `packages/shared/legal.ts`: add Last.fm to the list of optional third parties the policy names (text only). Do not bump
  `POLICY_VERSION` (open question 2).

### 4.8 Docs

`docs/api-contract.md`: new section "Scrobbling — additive" with the routes above, the `ScrobbleStatus` shape, the
rate bucket row, and the export field. Add rows to the rate-limit table (line ~743). Update `docs/README.md` index if it lists contract sections.

## 5. Implementation order (PR slices)

1. `feat/lastfm-rules`: `packages/shared/scrobble.ts` + `scrobble.test.ts`, `npm run sync:shared`, `apps/api/src/providers/lastfm.ts` + `lastfm.test.ts`.
   Verify `npm run typecheck && npm run lint && npm test` (infra parity test included).
2. `feat/lastfm-convex`: schema, `convex/scrobbles.ts`, `convex/scrobbleFlush.ts`, crons, erase, `convex/scrobbles.test.ts`,
   `package.json` test list. Verify `npx convex dev --once` then `npm run convex:test`.
3. `feat/lastfm-api`: store, service, router, wiring, config, supertest. Verify root gates.
   Live verification (owner, with a real key on a preview deployment): connect, play 3 songs past the threshold, confirm
   they appear on last.fm, capture one real `format=json` scrobble response into
   `apps/api/src/providers/fixtures/lastfm-scrobble-ok.json` with the session key removed.
4. `feat/lastfm-web`: web settings + api helpers + contract doc. Verify gates and check at 360/768/1280/1920.
5. `feat/lastfm-mobile`: mobile settings + deep link + version bump. Verify `npm run mobile:check` (after `convex:test`).
6. Optional `feat/listenbrainz-sink`: `apps/api/src/providers/listenbrainz.ts`, a token paste field (validated with
   `GET /1/validate-token`), sink `listenbrainz` in the same queue, `listen_type: 'import'` batches of 50, `playing_now` for now playing.
7. Optional `feat/lastfm-love`: setting "Love songs I like" (default off), `track.love`/`track.unlove` from the like route, best effort.

## 6. Edge cases and failure modes

| Input / state | Required behaviour |
| --- | --- |
| Track 30 s exactly | Never scrobbled |
| Seeked to the end, heard 10 s of a 200 s song | Not eligible (heard is audio heard) |
| Same signal posted twice (retry) | Dedupe key hit -> `duplicate`, one scrobble |
| Same song played twice in a row | Different `playedAt` -> two rows |
| Client clock 2 h ahead | Timestamp replaced by server now - heard |
| Offline phone posts a listen 3 days later | Accepted (timestamp 3 days old, under 14) |
| Listen older than 14 days | Not queued |
| Last.fm down for a day | Rows retried 60 s, 5 min, 30 min, 2 h, 6 h, 6 h...; order kept by timestamp |
| User revokes the app on last.fm | Code 9 -> needsReauth, UI shows Reconnect; rows kept until 14 days |
| Disconnect while a flush is in flight | Generation changes; `settle` with an old lease token finds no matching rows (deleted) and does nothing |
| Account erase mid-flush | Rows and link deleted; settle is a no-op; the API flush then fails `claim` -> returns nothing |
| Two flushes for one user at once | The lease (60 s) means the second claim gets no rows |
| Vercel function cold, Convex scheduler retries | The flush is idempotent per lease; duplicates prevented by deleting sent rows in settle |
| Callback with unknown/expired state | 303 to `?lastfm=failed`; token never exchanged |
| Callback without token (user denied) | 303 `?lastfm=cancelled` |
| `LASTFM_ENABLED` off | Router not mounted (404); `status` not reachable; listen hooks skip (service `available` false) |
| Guest token | 401/403 from `accountUser` like Spotify |
| Personalisation off | Scrobbles still sent (decision); open question 1 |
| Song with "Unknown Artist" | Sent; Last.fm returns ignored code 1; row dropped |
| Batch with one ignored row | Others accepted; only that row dropped |

## 7. Test plan

- `packages/shared/scrobble.test.ts` (node:test; `packages/shared/package.json` runs `node --import tsx --test "*.test.ts"`,
  so it joins `npm test` automatically): every worked example in 4.1.
- `apps/api/src/providers/lastfm.test.ts`: the five signature vectors; `scrobble builds array notation and excludes format from the signature`
  (capture the body with a fake `fetchImpl`, recompute md5 over the received params minus `api_sig`/`format`, compare);
  `numeric error becomes LastfmError with code`; `session key never appears in error messages`;
  `single and array scrobble responses both parse` (fixtures `{scrobbles:{'@attr':{accepted:'1',ignored:'0'},scrobble:{...}}}`
  and the array form); `timeout rejects within budget`.
- `apps/api/src/services/scrobbles.test.ts`: eligibility gate; dedupe; flush mapping for codes 9, 11, 16, 29, 6, 10 and
  network error (assert the `settle` call each produces, using a fake store).
- `apps/api/src/app.scrobble.test.ts` (supertest through `createApp`, required by `CLAUDE.md` for a new router):
  `status needs an account`, `connect returns a last.fm auth url with a cb on ALLEGRA_ORIGIN`, `callback with a bad state
  redirects to failed`, `internal flush rejects a wrong secret with 401`, `router absent when LASTFM_ENABLED is off (404)`,
  `taste signal enqueues an eligible listen` (fake store spy).
- `convex/scrobbles.test.ts` (vitest + convex-test, `convex/_generated/ai/guidelines.md` testing section): connect/status;
  enqueue dedupe; claim respects lease and order; settle deletes sent, reschedules retried, drops 14-day-old rows;
  disconnect deletes queue; `account.erase` removes all three tables (extend `convex/account.test.ts` too).
- Existing: `apps/api/src/app.routes.test.ts`, `app.privacy.test.ts` (export shape), `tests/infra` parity test.
- Run `npm run convex:test` and `npm run mobile:check` sequentially, never overlapping (learning log item 20).

## 8. Security, privacy and cost

- `LASTFM_SHARED_SECRET` and `LASTFM_API_KEY` live only in Vercel env (API). The session key is AES-256-GCM encrypted
  before it reaches Convex; the decryption key derives from `CONVEX_SERVER_SECRET` with a distinct HKDF info string.
- State parameter: 32 random bytes, only its SHA-256 stored, 10-minute expiry, single use (CSRF protection; Last.fm has no
  state parameter of its own, so the state rides inside `cb`).
- Logs: no titles, artists, tokens, session keys, or raw user ids. Request logs already drop query strings
  (`apps/api/src/lib/logger.ts:15-30`), so the callback's `token` never lands in access logs.
- Consent: connecting is the consent; the connect sheet states exactly what is sent. Erase and export integrated.
- ToS: non-commercial (Allegra is free, no payments). Credit Last.fm and link to the user's profile in the settings row.
  If Allegra ever charges, a commercial agreement is required (ToS 3.2).
- Cost: one Convex insert per eligible listen, one flush per user per 30 s at most. Last.fm calls are free.
- Shared egress IPs (Vercel) make per-IP limits (code 29) a real risk at scale; batching and debounce are the mitigation.

## 9. Rollout and rollback

- Env: `LASTFM_ENABLED=false` (default), `LASTFM_API_KEY`, `LASTFM_SHARED_SECRET`. Register the API account at
  https://www.last.fm/api/account/create with the callback `${ALLEGRA_ORIGIN}/api/lastfm/callback`.
- Enable on a preview deployment first; prove: connect, now playing visible on the profile, three scrobbles after the
  threshold, disconnect removes rows (`npx convex data scrobbleQueue` shows none for the user), erase removes the link.
- Rollback: `LASTFM_ENABLED=false` (router unmounted, hooks inert); rows expire through the 14-day drop and erase.
- Read `vercel logs` filtered on `scrobble/flush` for the first week.

## 10. Acceptance checklist

- [ ] Eligibility exactly `duration > 30 && heard >= min(duration/2, 240)` (seconds).
- [ ] Signature vectors pass; `format` excluded; array names sorted with plain string sort.
- [ ] Now playing never retried, never queued, bounded at 1.5 s.
- [ ] Router mounted in `app.ts` and covered by a supertest through `createApp`.
- [ ] `npm run sync:shared` run; parity test green.
- [ ] `npx convex dev --once` run; `_generated` not hand-edited; `convex:test` list updated.
- [ ] Erase and export include the new tables; contract doc updated before clients use the routes.
- [ ] No secret, token or session key in any log line or client bundle.
- [ ] Mobile slice bumps `expo.version`.

Common mistakes: signing with `format` included; using `Date.now()` as the timestamp instead of the listen start;
scrobbling from `recently-played` (5 s) instead of the listen signal; putting the shared secret in a `NEXT_PUBLIC_*`
variable; reading the wall clock inside a Convex query (`now` is an argument); unbounded `.collect()` on the queue.

## 11. Open questions (defaults)

1. Pause scrobbling when personalisation is off? Default: no (separate explicit link); revisit if the owner prefers one switch.
2. Bump `POLICY_VERSION` for the new optional processor? Default: no; add a policy paragraph and the in-flow notice. Owner/lawyer decides.
3. Lead artist only, or full credit string? Default: lead artist (`creditedArtists()[0]`).
4. Ship ListenBrainz in the same release? Default: no, slice 6 after Last.fm is proven.
5. Love sync? Default: off, slice 7.
