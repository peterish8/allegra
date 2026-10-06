# API CONTRACT — frozen at T+1

> **The single most important document on this project.**
> Frontend builds against a mock of this. Backend builds toward it. Neither is ever blocked on the other.
>
> **To change it:** propose in the channel → update this file → both sides adapt. **Never a silent shape change.** A renamed field at hour 20 costs a night.

Base URL: same-origin `/api`. `NEXT_PUBLIC_API_BASE_URL` is blank everywhere — in dev Next rewrites `/api` to the Express server, and on Vercel it is the Express function.

## Envelope — every response

```ts
type ApiResponse<T> =
  | { success: true;  data: T }
  | { success: false; data: null; error: string };   // error is USER-FACING copy
```
Never leak provider errors. Map network / timeout / 404 / 429 / 5xx to friendly text server-side.

## Shared types — `packages/shared/types.ts`

```ts
export interface UnifiedSong {
  id: string;
  title: string;          // HTML entities already decoded
  artist: string;         // decoded, comma-joined
  album?: string;
  artwork: string;        // 1000x1000 when available
  streamUrl: string;      // ALWAYS our proxy: /api/stream/:id — never a CDN URL
  duration: number;       // SECONDS
  hasLyrics: boolean;
  language?: string;
  playCount: number;      // 0 for Gaana-sourced
  source: 'Saavn' | 'Gaana';
  /** Other release rows for the same recording (search / suggestions only). Never nested. */
  variants?: UnifiedSong[];
}

export interface LyricLine {
  timestamp: number;      // SECONDS (float). All-zero ⇒ unsynced
  text: string;           // '[INSTRUMENTAL]' for empty stamped lines
  lineOrder: number;      // 0-based, contiguous
  /** Optional, additive. Word/syllable timing from word-synced sources (YouLyPlus, BetterLyrics TTML).
   *  SECONDS. `text` of each piece keeps a trailing space where a word ends, so the pieces joined
   *  spell the line exactly; clients ignore `words` that don't (packages/shared/wordSync.ts). */
  words?: { text: string; start: number; end: number }[];
}

export interface LyricsPayload {
  source: string;         // 'LRCLIB' | 'LRCLIB-search' | 'interpolated'
  type: 'synced' | 'plain';
  matchScore: number;     // 0-100
  matchReason: string;    // 'Title match • Synced • Exact duration'
  lines: LyricLine[];     // PRE-PARSED. The browser never parses LRC.
}
```

## Endpoints

### `GET /api/health`
`→ { ok: true, version: string }` — Render health check.

### `GET /api/search`
`q` (required) · `limit`=20 · `page`=0
`→ ApiResponse<{ results: UnifiedSong[]; source: 'Saavn'|'Gaana' }>`
Empty results → `success: true` with `results: []`, **not** an error.
Cache 1 h. Budget: <800 ms cold, <200 ms cached.

**Recording collapse (2026-09-21):** the provider lists one row per release, so the
same song can appear ~20 times with different compilation covers. Search groups by
recording identity (title without bracketed trailers + sorted artists), elects one
canonical row per group, and attaches the rest as `variants`. Election order:
1. **Meaningful** `playCount` lead (near-ties within 2% / 2 000 plays count as equal —
   Saavn often stamps the same count on every compilation placement).
2. Prefer album name matching the song title (the official single) over editorial
   playlist placements.
3. Prefer a real primary artist over "Various Artists".
4. Prefer albums that are not shared across many different artists in the same
   result set.
Over-fetches from the provider so `limit` is filled after collapse when possible.
The UI may expose `variants` behind a small "N other versions" control — they are
never listed as separate top-level search hits.

**Relevance order (2026-10-06):** results keep the provider's order (Saavn before Gaana). Play
count only elects the canonical row inside a recording group; it no longer re-sorts the list, so
`kes` leads with Kesariya rather than the most-played song containing "kes".

### `GET /api/search/suggest`
`q` (required) · `limit`=8 (max 12)
`→ ApiResponse<{ results: UnifiedSong[]; source: 'Saavn' }>`
As-you-type search. Same relevance order and recording collapse as `/api/search`, without the
release correction or the Gaana fallback, with a 4 s provider deadline. Rows are playable.
Not personal: `Cache-Control: public, max-age=60, s-maxage=600, stale-while-revalidate=86400`, so
the edge answers popular prefixes. Own rate-limit bucket (Typeahead, below).

### `GET /api/radio/:songId` · Bearer optional
`?languages=` (guests only; a signed-in listener's setting wins)
`→ ApiResponse<{ candidates: { song: UnifiedSong; source: 'similar' | 'artist' | 'taste'; rank: number }[]; taste: { artists: { name: string; score: number }[]; languages: string[] } | null }>`
Candidates for a song radio: the seed's suggestions, its lead artist's top songs, and (signed in,
personalisation on) the listener's favourite artists in the seed's language. Never the seed itself.
The client ranks them with `packages/shared/radio.ts` while the listener skips and finishes.
`taste` is null for guests and when personalisation is off. Personal: `no-store`.

### `GET /api/songs/:id` → `ApiResponse<UnifiedSong>` · cache 6 h
### `GET /api/songs?ids=a,b,c` → `ApiResponse<UnifiedSong[]>` · batch hydrate
### `GET /api/songs/:id/suggestions?limit=15` → `ApiResponse<UnifiedSong[]>` · cache 24 h
Same recording collapse as search — suggestions never return twenty copies of one song.
Bare IDs remain Saavn-compatible. Provider-qualified IDs (`gaana:<id>`; also `saavn:<id>`) select a
provider explicitly. Gaana search results and hydrated songs use a provider-qualified stream URL so
the server resolves audio from the same catalog that returned the song.

### `GET /api/home`
`?languages=tamil,english&region=TN` (both optional) `→ ApiResponse<{ trending: UnifiedSong[]; madeForYou: UnifiedSong[]; recommended: UnifiedSong[]; chart?: { region, regionName, language } }>`
Cache 1 h. Fallback = hardcoded curated playlist IDs.
Additive, 2026-10-05: `languages` (the listener's, parsed like suggestions) shapes all three shelves.
`region` picks the state for "Top 10 today": an ISO 3166-2:IN code without the prefix (`TN`, `KL`;
old codes `TS`, `OR`, `CT`, `UT` accepted), `IN` for the all-India chart, or absent/`auto` to use
the request's Vercel geo headers when it comes from India (never stored). A state's chart is that
state's language's top songs (`packages/shared/regions.ts`); `trending` is replaced only when the
catalog has at least 5 of them, and then `chart` says which state and language. Songs on the chart
are dropped from the other two shelves.

### `GET /api/artists/:name` → `ApiResponse<ArtistProfile>` · cache 6 h — added 2026-09-21
Additive endpoint (no existing shape changed). `name` is the lead artist as shown on a song. Resolves the name through the provider's artist search (exact match preferred), then returns `ArtistProfile` from `packages/shared/types.ts`: a real `image` (500×500 photo or `null`), `isVerified`, `followerCount`, optional `bio`, `songs` (most popular first, all playable), `albums` (with cover + year) and `similar` artists. `404` when no artist matches.
### `GET /api/artists/faces?names=a,b,c` → `ApiResponse<ArtistSummary[]>` · cache 24 h — added 2026-09-21
Up to 12 comma-separated names; returns `{ id, name, image }` for each one that has a photo. Unmatched names are simply omitted. Used for avatars on lists.

### `GET /api/artwork`
`title`, `artist`, `limit`=5 → `ApiResponse<{ urls: string[] }>` · cache 30 d
Index 0 is the best guess; the array exists for a future "fix artwork" picker.

### `GET /api/canvas` — additive
`title` (req), `artist` (req), `album`?, `duration`? (seconds)
`→ ApiResponse<MotionArtwork | null>` · cache 24 h on hit, 6 h on miss

Finds Apple Music album motion artwork **server-side** and returns its URL only when a
matched release has one. Providers, in order: the official Apple Music catalog (only when
`APPLE_MUSIC_DEVELOPER_TOKEN` is set), `artwork.boidu.dev`, `artwork.m8tec.top` (needs
`album`). `videoUrl` is always an `https://*.apple.com` URL — a direct MP4 when available,
otherwise an HLS `.m3u8` that the client shows only where the browser plays HLS natively.
It is mobile-player-only UI, never blocks ordinary cover art, and returns `null` (with a
successful envelope) when no release qualifies or every provider is down. Provider URLs and
tokens stay server-side. `MotionArtwork` is `{ source: 'Apple Music', videoUrl: string }`.

### `GET /api/lyrics` ⭐
`songId`?, `title` (req), `artist` (req), `duration`?, `syncedOnly`=false
`→ ApiResponse<LyricsPayload>`
No lyrics anywhere → `404 { success: false, error: "No lyrics found for this song." }`
Cache 30 d on hit, **24 h on miss**.

Sources: LRCLIB first, then Better Lyrics, LyricsPlus, Unison, Lyrica and KuGou asked together (each
optional, synced preferred, in that order on a tie). **Answers within ~11 s**: a lookup still running
then answers `404` and keeps going in the background, caching its result, so the client's retry gets
it. The client treats `404` as "no lyrics" (an empty state), never as a connection error.

### `GET /api/lyrics/alternatives` — additive
`title` (req), `artist` (req), `duration`?, `syncedOnly`=false
`→ ApiResponse<LyricsPayload[]>`

Runs only when the listener opens **Other lyrics**. Returns up to six usable, de-duplicated renderings (synced first) from every configured source: LRCLIB, Better Lyrics, LyricsPlus, Unison (up to five of its ranked entries), Lyrica and KuGou (up to three candidates); every item is a complete `LyricsPayload`, so selecting it requires no follow-up provider request. Two entries with the same opening words and type count as one. When a source says which recording it filed an item under, its `matchReason` starts with it (`Artist — Title • …`) so the picker can tell them apart. Sources get the same ~11 s budget; a list missing a slow source is returned but not cached. The normal `/api/lyrics` cascade stays the fast default. An empty array is a successful response: no alternative match was found. Cache 24 h on hit, 6 h on miss.

### `GET /api/stream/:songId` ⭐⭐ — not JSON
Returns **audio bytes**.

| Request | Response |
|---|---|
| no `Range` | `200` + `Content-Type`, `Content-Length`, `Accept-Ranges: bytes` |
| `Range: bytes=N-M` | **`206`** + `Content-Range: bytes N-M/TOTAL` + `Accept-Ranges: bytes` |

Also sets `Cross-Origin-Resource-Policy: cross-origin` (needed for Web Audio).
**A `206` must never be collapsed to `200` — seeking dies silently.**
Frontend usage: `<audio src={`${API}/api/stream/${song.id}`} crossOrigin="anonymous" />`

### `POST /api/auth/anon`
`→ ApiResponse<{ token: string; userId: string }>`
Called once on first load, token stored client-side and sent as `Authorization: Bearer`. Listening never needs an account.

### Library — all require `Authorization: Bearer <token>`
```
GET    /api/libraries                  → ApiResponse<Library[]>
POST   /api/libraries                  { name, description?, isPublic? }
PATCH  /api/libraries/:id              { name?, description?, isPublic?, coverKey? }
DELETE /api/libraries/:id
POST   /api/libraries/:id/songs        { songId }
DELETE /api/libraries/:id/songs/:songId

GET    /api/me/liked                   → ApiResponse<UnifiedSong[]>
POST   /api/me/liked                   { songId }
DELETE /api/me/liked/:songId
GET    /api/me/recently-played     → newest first, at most 25 (older listens are dropped on write)
POST   /api/me/recently-played         { songId, playDuration, playedAt? }
                                      or { songRef, song?, playDuration, playedAt? }
GET/PATCH /api/me/settings
```

`Library` is additive: optional `coverKey` (a Convex storage id) and derived `coverUrl`. `coverUrl` is
never persisted; the API resolves it from Convex on read. `PATCH` accepts the `coverKey` returned by
the authenticated cover-upload flow or `coverKey: null` to clear it.

### `POST /api/ai/mood` ★ stretch
`{ prompt: string }` → `ApiResponse<{ queue: UnifiedSong[]; explanation: string }>`
**Not shipped.** The mood pills in the UI run a plain `/api/search` instead.

### `POST /api/lyrics/translate`
`{ title, artist, lines: LyricLine[], targetLanguage? = "English", language? }` (no auth required)
`→ ApiResponse<{ lines: LyricLine[]; provider: string }>`
Same `lines` length/order/timestamps as the request; `[INSTRUMENTAL]` markers pass through unchanged.
Translated lines carry no `words` (the timing belongs to the original wording).
MyMemory is the free keyless primary. A configured, self-hosted LibreTranslate instance is the
fallback; unmanaged public mirrors are never assumed. The legacy `/api/ai/translate-lyrics` path is
an alias for compatibility. `502` means both available providers failed.

### `GET /api/recommendations`
`songId`? (current song, added to taste context if present) · requires `Authorization: Bearer <token>`
`→ ApiResponse<{ songs: UnifiedSong[]; provider: string; reasoning: string }>`
Ranks the catalog's suggestions with the listener's liked/recent songs, artists, and languages. When
the server has the YouTube Music signal enabled, each seed's song radio is blended in too, after being
matched back to catalog rows (shape unchanged). Seeds also include the listener's most-played songs
this week and of all time, from the play tally that `POST /api/me/recently-played` (a play) and
`POST /api/me/taste/signal` (seconds listened) now maintain — no request or response shape changed. Every result is a real playable catalog row, never an
invented model result. Excludes already-liked or
recently played recordings. `404` means there is no listening context yet. The legacy
`/api/ai/recommendations` path is an alias for compatibility.

## Library sync — additive, 2026-10-05

Likes and playlists are the same on Allegra web and LuvLyrics (`apps/mobile`). No existing shape changed:
the library routes above behave as before, but every one of them (and sharing, MCP, the guest merge) now
writes through library **operations** (`packages/shared/library.ts`), stored per item in Convex
(`convex/library.ts`). The rules:

- Per item, the **newest change wins**, by when the listener made it. A late, older change never
  overwrites a newer one; a time from the future is clamped to now.
- Deletes are remembered, so a stale add cannot bring an item back.
- `likedSongIds` and `libraries[].songIds` stay Allegra (Saavn) ids in their order. A song only a phone
  can name (a Gaana ref) syncs between devices but does not appear in those arrays.

| Endpoint | Auth | Body → response |
|---|---|---|
| `POST /api/me/library/ops` | Bearer | `{ ops: LibraryOp[], sentAt?: number }` (1–100) → `{ rev, rejected: { index, reason }[], superseded: number[], applied: number }`. `sentAt` is the device wall-clock time when it sent the batch; when it differs from server receive time by more than 2 s, each op timestamp is shifted by that clock offset while preserving its age within the batch. A malformed batch is refused whole (`400`). `reason` is `no_playlist`, `missing_name` or `bad_time`. An op older than the current state is reported by its index in `superseded`; clients should pull changes when this list is non-empty. |
| `GET /api/me/library/changes?since=<rev>&limit=<n>[&resync=true]` | Bearer | → `{ rev, changes: LibraryChange[], more, resync?: true }`. `limit` ≤ 500, default 200. Pass `rev` back as `since` and repeat while `more`. `since=0` returns current rows only; no tombstones are needed for a first sync. |

```
SongRef       'saavn:<id>' | 'gaana:<id>'
SongSnapshot  { ref, title, artist, album?, artwork (https URL or ''), duration (seconds) }
LibraryOp     { op: 'like', ref, song?, origin?, at }  |  { op: 'unlike', ref, at }
            | { op: 'playlist_upsert', playlistId, name?, description? (null clears), isPublic?, origin?, at }  (name needed to create)
            | { op: 'playlist_delete', playlistId, at }
            | { op: 'playlist_add', playlistId, ref, song?, at }  |  { op: 'playlist_remove', playlistId, ref, at }
              at: ms since epoch when the listener did it.  playlistId: [A-Za-z0-9_-]{1,100}
LibraryChange { kind: 'like', rev, ref, song?, liked, likedAt, origin? }
            | { kind: 'playlist', rev, playlistId, name, description?, isPublic, coverUrl?, deleted, createdAt, origin? }
            | { kind: 'playlist_item', rev, playlistId, ref, song?, deleted, addedAt }
```

`origin?: 'import'` (additive, 2026-10-05) is set by Import on likes and on the playlists it creates.
A later like made in the app clears it on that like; a playlist keeps it through later edits; playlist
items carry none. Absent means native. Any other value is ignored. Older clients may ignore the field.

Covers are never set through `ops`: only the website's checked upload flow sets one. A signed-in client
can subscribe to the Convex query `library:myRev` to learn that its library changed elsewhere, then refetch.

When a positive `since` predates a removal the server no longer retains, the first request omits
`resync` and its response includes `resync: true`, starting at the first page of the full live
library. Only after that response, clients send `resync=true` on continuation pages while `more` is
true; the flag continues from the supplied `since` cursor while filtering tombstones, so a cursor
still below the highest pruned revision does not restart the first page. Do not set this query
parameter on ordinary incremental requests or on the first request. The phone gathers every page
before replacing its synced local rows, preserves its unsent outbox edits, and saves the final `rev`
only after reconciliation succeeds.

## Accounts, taste and sharing — additive, shipped 2026-09-21

Additive only: no existing shape changed. Every response uses `{ success, data, error? }`.

### Accounts — **changed 2026-09-22: Google via Convex Auth replaces email/password**

Two kinds of bearer token reach this API, and every route accepts either:

1. **Guest** — minted by `POST /api/auth/anon`, signed by the API (`JWT_SECRET`).
2. **Account** — minted by **Convex Auth** after Google sign-in. The browser gets it from Convex
   directly; the API verifies it against the deployment's published keys
   (`CONVEX_SITE_URL/.well-known/jwks.json`). **The API never sees a Google secret or a password.**

Convex Auth's subject is `<userId>|<sessionId>`; the profile is keyed on the `userId` half, so a
second device or a re-login is the same listener. The first time an account appears, the API creates
its profile and copies the name and email from Convex.

| Endpoint | Auth | Body → response |
|---|---|---|
| `POST /api/auth/link` | account `Bearer` | `{ guestToken }` → the account profile. Folds that guest's likes, playlists, recents and taste **into the account**. Idempotent (merging is a union). `400` without a guest token, `401` if the bearer is not a verified caller. |
| `GET /api/auth/me` | Bearer | → `{ userId, isGuest, createdAt, displayName?, email?, consent? }` (`consent` added 2026-10-02, see below) |
| `PATCH /api/me/profile` | Bearer | `{ displayName }` → same profile. Empty string clears it. |

**Removed** (no longer routed; they answer `404`): `POST /api/auth/register`, `POST /api/auth/login`.
No stored password hashes remain — `passwordHash` is gone from the user record.

Sign-out is client-side: Convex clears its session, then the browser calls `POST /api/auth/anon` for a
fresh guest session.

### Taste (what the app learns about a listener)

| Endpoint | Auth | Body → response |
|---|---|---|
| `GET /api/me/taste` | Bearer | → `{ topArtists: {name,score}[] (<=12), languages: {name,score}[] (<=5), signals: number, onboarded: boolean }` |
| `POST /api/me/taste/seed` | Bearer | `{ artists: string[] (<=30), languages: string[] (<=8) }` → same as `GET`. Onboarding: strong weight, sets `onboarded: true`. |
| `POST /api/me/taste/signal` | Bearer | `{ songId, seconds, playedAt? }` or `{ songRef, song?, seconds, playedAt? }` → `204`. `playedAt` is an ISO timestamp and is recommended; the most-played tally needs it to ignore repeated delivery. Additive 2026-10-06: optional `exit` (`'ended' \| 'skipped' \| 'paused' \| 'switched'`) and `exitPositionSec`. With `exit`, `packages/shared/listenSignal.ts` decides: heard out or left in the last 15 s counts for the artist, left inside 30 s counts against, anything between is neutral. Without it, the older rule: `<10 s` counts against the artist, most of a song counts for them. |

Taste is also updated **automatically** by existing routes. Legacy songId writes resolve through the catalog; provider-aware writes include a validated `SongSnapshot`, so Gaana plays train the same account taste without a colliding bare ID. Recent rows retain the ref and snapshot for account history and recommendation seeds. The artist profile remains as described above; separately, the most-played tally stores at most 200 song identities, adds listened minutes (or −1 for a skip under 10 seconds), +10 once for a native like, and +5 for a native playlist add. Tally weights halve every 45 days. A future `playedAt` is clamped to server time; a signal older than 30 days is ignored by the tally.

Listening delivery adds optional `playId` (stable playback-session ID, at most 128 characters)
and `cumulativeSeconds` (finite 0–7200). New clients reuse the ID and original `playedAt` on retry
and send cumulative heard seconds. The tally applies only the newly heard amount. Dedupe is
bounded to the last 16 checkpoints per retained song; older clients retain timestamp dedupe.
Learning preference is checked authoritatively when accepting writes and publishing a Blend.

### Sharing a playlist

| Endpoint | Auth | Body → response |
|---|---|---|
| `POST /api/libraries/:id/share` | Bearer (owner) | → `{ code, path: "#shared/<code>" }` (`201` first time, `200` after). Sets the playlist `isPublic: true`. The link is **live**: it points at the owner's playlist. |
| `DELETE /api/libraries/:id/share` | Bearer (owner) | → `204`. Link stops working immediately; `isPublic: false`. |
| `GET /api/shared/:code` | **none** | → `{ code, name, description?, coverUrl?, ownerName, songs: UnifiedSong[] }`. `404` if the code is unknown, malformed, or sharing was turned off. |
| `POST /api/shared/:code/save` | Bearer | → `201 LibraryRecord`. Copies the playlist into the caller's own library (`isPublic: false`, new id). |

Codes are 8 characters from `abcdefghjkmnpqrstuvwxyz23456789`.

### Playlist cover uploads — additive, shipped 2026-09-21

| Endpoint | Auth | Body → response |
|---|---|---|
| `POST /api/uploads/sign` | Bearer (owner) | `{ libraryId }` → `{ uploadUrl, coverKey }`. The browser uploads the image to the short-lived Convex upload URL, then `PATCH`es the library with its `coverKey`. `503` if Convex is not configured. |

## Consent, data rights and reports — additive, 2026-10-05

Additive only: no existing shape changed except that the account profile gained an optional
`consent`. The values the policies promise (policy version, minimum age, retention periods,
report reasons) live in `packages/shared/legal.ts`.

| Endpoint | Auth | Body → response |
|---|---|---|
| `POST /api/me/consent` | Bearer | `{ policyVersion }` → the account profile, now with `consent: { policyVersion, at }` (`at` is the server's time, ISO). `400` when `policyVersion` is not the current `POLICY_VERSION`: the client is showing old terms and should reload. Sent once after sign-in when the listener ticked the box. |
| `GET /api/me/export` | Bearer | → `AccountExport` (below). Everything held about the caller, guest or account. |
| `DELETE /api/me` | Bearer | → `204`. Erases the caller's profile, library, playlist covers, share links, devices, player session and (for an account) the sign-in identity. Not reversible; safe to repeat. The client then signs out and starts a guest session. A session token that outlives its erased account answers `401`. |
| `POST /api/shared/:code/report` | **none** | `{ reason: 'copyright' \| 'illegal' \| 'abuse' \| 'other', details? (<=1000), contact? (<=200) }` → `201 { received: true }`. `404` when the link is unknown or off, `400` for an unknown reason. Counted in the Writes rate bucket. |

```
AccountExport {
  exportedAt, policyVersion, complete: boolean,
  profile: { userId, isGuest, createdAt, displayName?, email?, consent? },
  settings, taste | null, tally: { title, artist, weight }[], recentlyPlayed,
  library: { changes: LibraryChange[] (current rows only), complete: boolean },
  shares: { code, libraryId, createdAt }[],
  devices: { name, kind, appVersion, createdAt }[],
  blends: { name, joinedAt, members: displayName[] }[]
}
```

`tally[].weight` is weighted listening: heard minutes plus like and playlist bonuses, decayed to today. It is not a minute count.

`complete` is false if the bounded library scan, 100-share limit or 50-device limit was exceeded.
The file remains usable, but must not be presented as a complete account export in that case.

**Personalisation switch.** `PATCH /api/me/settings` with `{ personalization: false }` turns
learning off for the account on every device: taste, the most-played tally and recent listens are erased in the same
write, and from then on `POST /api/me/recently-played`, `POST /api/me/taste/signal`, likes and
playlist adds still succeed with the same replies but record no history and teach nothing.
`{ personalization: true }` turns it back on. Missing means on.

**Retention.** Convex erases guest profiles unused for 90 days and accounts unused for 730 days
(`convex/account.ts`, daily). "Used" is any profile or library write; a signed-in listener who
only reads is kept active by the API.

## Import — additive, 2026-10-05

Behind `IMPORT_ENABLED=true` (API) and `NEXT_PUBLIC_IMPORT_ENABLED=true` (web). With the flag off
both routes answer the standard `404` envelope. The import file (Spotify "Download your data" ZIP or
JSON, or a CSV) is read on the device and never uploaded; only title, artist, album and length are
sent, in batches. Account only: a guest gets `403` with
`"Sign in to import your library, so it follows you to every device."`

| Route | Auth | Body → reply |
|---|---|---|
| `POST /api/import/match` | Bearer (account) | `{ tracks: { title, artist, album?, durationSec? }[] }` (1–50; title and artist 1–200 characters, album ≤ 200, `durationSec` 0–7200) → `{ results: { index, song: SongSnapshot \| null, confidence: 'exact' \| 'close' \| 'none' }[] }`. `index` is the track's position in the request. `exact`: same normalised title and lead artist, length within 5 s when both are known. `close`: same title with an overlapping artist, or a near title (bigram similarity ≥ 0.85) by the same lead artist. Only Saavn rows match. A provider failure answers `none` for that track; the batch still succeeds. Errors `400`, `401`, `403`, `429`. Rate limit: 30 requests a minute per IP (`import` bucket). Results are cached server-side for everyone (hit 30 days, miss 7 days). |
| `POST /api/me/taste/import-seed` | Bearer (account) | `{ artists: { name (1–200), count (integer 1–100000) }[] }` (1–500) → the taste summary (as `GET /api/me/taste`). The 25 artists with the highest counts (names merged case-insensitively) each add `5 × log2(1 + count) / log2(1 + maxCount)` to the artist taste; `signals` grows by at most 25; languages are untouched. With learning off: `204`, nothing changes. Writes bucket. |

Matching additionally returns optional `retryable: true` when catalog work is unavailable or
exceeds the batch deadline. This is not a definitive miss: clients retry it with bounded backoff
and do not checkpoint it as complete. Cache keys include matcher version, release/album evidence
and duration. Exact matches may be preselected; ambiguous `close` matches require review.
The request is bounded by a total deadline as well as provider timeouts.

Saving an import uses `POST /api/me/library/ops` with `origin: 'import'` on each like and on each
imported playlist's `playlist_upsert` (see Library sync). An imported playlist's id is
`import-<first 12 hex of sha256(source + name)>`, so importing the same file again updates the same
playlists. Imported likes and playlists never add to the most-played tally.
Each import manifest retains its original operation timestamps and `sentAt` across retries;
the fully serialized `{ ops, sentAt }` envelope is measured in UTF-8 bytes before sending.
HTTP success alone is insufficient: rejected operation indexes must be reviewed before a chunk
is acknowledged. Import files, selections, match decisions and save progress stay account-scoped
on the device; the original export file is never uploaded.

## Blend — additive, 2026-10-05

Behind `BLEND_ENABLED=true` (API) and `NEXT_PUBLIC_BLEND_ENABLED=true` (web); with the flag off every
route below answers the standard `404`. Account only: a guest gets `403` with
`"Sign in to make a Blend. Blends need an account so your friend knows it's you."` — except the
invite preview, which anyone with the link may read. A Blend id that is not yours answers exactly like
one that does not exist (`404 notfound`, never `403`). Types live in `packages/shared/blendView.ts`,
`blendTypes.ts` and `blendStories.ts`.

Errors add a machine-readable `code` beside the usual envelope: `{ success: false, data: null, error, code }`.

| `code` | HTTP | `error` |
|---|---|---|
| `full` | 409 | This Blend is full. |
| `limit` | 409 | You're in 20 Blends, the most there can be. Leave one to join this. |
| `expired` | 410 | This invite has expired. Ask for a new link. |
| `notfound` | 404 | We couldn't find that Blend. The link may be wrong or the Blend may have ended. |
| `consent` | 400 | Agree to how Blends use your listening before you blend. |
| `invalid` | 400 | Something's missing from that request. |

| Route | Body | Reply | Errors |
|---|---|---|---|
| `POST /api/blends` | `{ name? (1–60, default "Our Blend"), consent: { policyVersion } }` | `201 BlendCreated` = `BlendSummary & { invite: { code, url, expiresAt } }` | `limit`, `consent`, `invalid` |
| `GET /api/blends` | — | `BlendSummary[]` (≤ 20) | — |
| `GET /api/blends/:id` | — | `BlendDetail`; rebuilds first when the build is for an earlier UTC day or membership changed | `notfound` |
| `POST /api/blends/:id/invite` | `{ regenerate?: boolean }` | `{ code, url, expiresAt }`: the live link, or a new one (`regenerate` expires the old) | `notfound` |
| `GET /api/blend-invites/:code` | — (no auth needed) | `BlendInvitePreview` = `{ inviterName, memberCount, full }` | `notfound` for unknown, malformed **and expired** codes alike (lookup bucket) |
| `POST /api/blend-invites/:code/accept` | `{ consent: { policyVersion } }` | `BlendSummary` (joining twice returns it) | `expired`, `full`, `limit`, `consent`, `notfound` |
| `POST /api/blends/:id/leave` | — | `{ left: true }` | `notfound` |
| `PATCH /api/blends/:id` | `{ name }` (1–60) | `BlendSummary`; owner only, anyone else gets `notfound` | `notfound`, `invalid` |

```
BlendMemberView  { userId, displayName, initials, isYou, learning }   // never a photo or email
BlendSummary     { id, name, memberCount, members: BlendMemberView[], builtFor? }
BlendDetail      { id, name, ownerId, members, pairs: PairMatch[], change?: ChangeReason, tracks: BlendTrack[],
                   builtFor: 'YYYY-MM-DD', state: 'ready' | 'not_enough', stories: Story[],
                   buildVersion?, inputVersion?, stale?, status?: 'waiting' | 'refreshing' | 'ready' | 'not_enough' }
BlendTrack       { song: SongSnapshot (always a Saavn ref), for: userId[], kind: 'shared' | 'pick' | 'discovery' }
PairMatch        { a, b, match (0–99), cover: { a, b } (0–1), rare, confidence: 'normal' | 'low', together, contributions }
ChangeReason     { kind: 'up' | 'down', points, artist }
Story            match | song | directions | artist | gift | brought        (two members, ≤ 6, in that order)
                 groupMatch | mostInTune | leastInTune | glue                (3+ members, ≤ 4; never a song card)
```

`consent.policyVersion` must equal the current `POLICY_VERSION`. Invite codes are 12 characters from
`abcdefghjkmnpqrstuvwxyz23456789`, valid for 7 days; `url` is `<site>/blend/join/<code>`. A Blend holds
at most 6 members; a listener may be in at most 20. `state: 'not_enough'` means fewer
than 10 tracks. Writes use the writes bucket. `GET /api/me/export` adds
`blends: { name, joinedAt, members: displayName[] }[]`. Turning learning off (`PATCH /api/me/settings`)
marks the listener's memberships `learning: false`; deleting the account leaves every Blend (the
longest-standing member becomes owner; a Blend left empty is deleted).

Blend creation accepts optional `Idempotency-Key` (6–128 characters). New clients retain one key
for the same create attempt across response-loss retries. Replaying that account/key returns the
original Blend; reusing it with different creation input is rejected. Legacy requests without a
key still work. Creation result retention is bounded. Other members cannot retrieve its result.
Membership and learning changes increment an internal input revision. Publishing requires both
the captured input revision and build version to match, plus authoritative current learning
preferences. A bounded durable build lease prevents duplicate provider work; it expires after a
failed worker. One-member Blends are waiting, and waiting expiry starts when that state is entered.
Departed-member attribution and withdrawn learned output are invalidated immediately, including
when a rebuild fails. Private Blend responses use `Cache-Control: private, no-store`.

## Spotify connection and incremental playlist transfer — additive

This connection transfers playlist metadata through the official Spotify Web API; audio remains
Allegra catalog audio. Export-file import remains available without a Spotify connection.

| Method | Route | Result / behavior |
| --- | --- | --- |
| GET | `/api/spotify/status` | Authenticated account: `{ configured, connected, dailyEnabled, playlists }`. Tracked playlists include Spotify ID, destination library ID, last sync time and counts. Never tokens. |
| POST | `/api/spotify/connect` | `{ returnTo?: 'web' \| 'mobile' }`: `{ url }` for OAuth with PKCE, single-use state and read-only playlist scopes. |
| GET | `/api/spotify/callback` | Spotify callback; consumes state once and returns to the import screen. No tokens in redirects. |
| GET | `/api/spotify/playlists` | `{ playlists: [{ id, name, snapshotId, total, imageUrl, kind?, needsReconnect? }] }` for the connected account. The first row is always Liked Songs (`id: 'liked'`, `kind: 'liked'`, `imageUrl: null`); `needsReconnect: true` when the connection predates the `user-library-read` scope. `imageUrl` is a Spotify CDN cover (`i.scdn.co` / `mosaic.scdn.co`) or `null`. Development-mode ownership/collaboration restrictions apply. (Additive, 2026-10-05.) |
| POST | `/api/spotify/sync` | `{ playlistId }` (a playlist ID or `'liked'`): one bounded, leased step. Liked Songs save as Allegra likes (`like` ops, `origin: 'import'`) and answer `libraryId: 'liked'`; a connection without the library scope gets `403`; `{ complete, added, skipped, reviewNeeded, libraryId }`. Repeat while incomplete. Existing source IDs are skipped; only exact catalog matches save automatically. Uncertain/unavailable matches are retried on the next scan. |
| PATCH | `/api/spotify/settings` | `{ dailyEnabled: boolean }`: explicit opt-in to the backend daily job for previously selected playlists. |
| POST | `/api/spotify/disconnect` | Removes stored Spotify authorization and stops scheduled transfers; existing Allegra playlists remain. |

Encrypted refresh tokens and PKCE verifiers stay behind the server gateway. Spotify requests have
timeouts and respect Retry-After. Checkpoints advance only after library writes are acknowledged.
Stable source IDs, timestamps and destination IDs make response-loss retries safe. Full source scans
find new songs inserted at the top; transfer adds songs and preserves local edits. Daily work runs
durably in Convex with bounded steps and a per-account/playlist lease. A daily run skips a playlist
whose Spotify `snapshot_id` hasn't changed since its last finished scan; manual sync always rescans.
The internal `POST /api/internal/spotify/daily` (server secret only) answers `{ more }`; Convex calls
again while `more` is true. Account erase removes all
connections/checkpoints. Missing configuration is an explicit unavailable state.

## Errors

| HTTP | When | `error` copy |
|---|---|---|
| 400 | Bad params | "Something's missing from that request." |
| 401 | Wrong email/password, or no session | "That email and password did not match." / "Please start a guest session first." |
| 404 | Not found | "We couldn't find that." |
| 409 | Email already registered | "That email already has an account. Try signing in instead." |
| 429 | Rate limited | "Too many requests — give it a moment." |
| 502 | All providers down | "Music service is having a moment. Try again shortly." |
| 504 | Timeout | "That took too long. Check your connection and retry." |

### Rate limits

Per client IP, per minute, in memory on each function instance (no database call per request).
A `429` carries `Retry-After` / `RateLimit` headers and the envelope above.

| Bucket | Routes | Limit |
|---|---|---|
| Song changes | different songs started via `GET /api/stream/:songId` (seeks within a song are free) | 30 |
| Stream | every `/api/stream` request, Range requests included | 300 |
| Plays | `POST /api/me/recently-played` | 30 |
| Writes | non-GET `/api/me/*`, `/api/libraries*`, `/api/shared*` | 60 |
| Lookup | `/api/search`, `/api/lyrics*`, `/api/artists*` | 90 |
| Typeahead | `GET /api/search/suggest` | 240 |
| Discovery | `/api/ai/*`, `/api/lyrics/translate`, `/api/recommendations`, `/api/radio/*` | 20 |
| Uploads | `/api/uploads/*` | 10 |
| Guests | `POST /api/auth/guest`, `POST /api/auth/anon` (each creates a profile) | 10 |
| Auth / OAuth | `/api/auth/*`, `/api/oauth/*` | 30 |
| MCP | `/api/mcp` | 120 |
| Everything else | | 240 |

## Mock server
P3 stands this up at T+2 from this document. P2 develops against it and **flips one env var** when the real API is live. That's the whole integration.
