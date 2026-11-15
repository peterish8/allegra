# P2-2 Stream resolver hardening: case-safe cache key, refused-link memory, dead-song backoff

Draft id: P2-7 (refused-stream memory + quality step-down + alternate source), merged with backlog BE-001.
Priority: P2. Branch: `fix/stream-resolver-memory`. API only. Cache-key bump: yes (`stream` key v1 -> v2).
Contract change: none for slices 1-2; slice 3 (optional) is additive.

## 1. Goal and user-visible outcome

A song id never plays another song's audio because two ids differ only in letter case. When a song's CDN link is dead
even after a fresh lookup, the API stops hammering the provider and the CDN for a minute instead of repeating both calls
for every retry the browser makes, and answers the listener at once. Optionally (slice 3), a client that keeps failing
can ask for a lower-quality rendition through an explicit URL.

Non-goals: silent quality switching under the same URL (breaks byte ranges, see 3); switching a song to another
provider's recording (Saavn <-> Gaana) automatically; any change to the Range/206 pass-through.

## 2. Evidence

| Fact | Where |
| --- | --- |
| Cache key `cacheKey('stream', songId)` lowercases every part, so `saavn:AbC` and `saavn:abc` share a cached URL | `apps/api/src/lib/streamResolver.ts:119`, `apps/api/src/lib/cache.ts:77-81`; backlog `audit/FIX-BACKLOG.md:393-406` (BE-001) |
| URL cached 3600 s; first fetch 403/404 triggers one forced refresh; anything not 200/206/416 -> `ProviderUnavailableError` | `streamResolver.ts:46-56,118-139` |
| Rendition choice: the `320kbps` asset, else the last asset | `streamResolver.ts:132` |
| Production cache is a per-instance `MemoryCacheStore` (the `LayeredCacheStore` class exists but is not wired) | `apps/api/src/createAppFromEnv.ts:13-18`, `apps/api/src/lib/cache.ts:36-75` |
| Rate limits: 300 stream requests/min/IP; 30 distinct songs/min | `apps/api/src/app.ts:195-197` |
| Contract: `/api/stream/:songId` returns audio bytes; 206 must stay 206 | `docs/api-contract.md:363-373`, `CLAUDE.md` byte-range rule |

External (accessed 2026-11-13): Chrome retries a failed media load up to `kMaxRetries` times (about 29 s of delays)
with fresh Range requests, and rejects a response whose total length differs from the one already pinned for that URL
(`HasCompatibleLengths`). https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/media/resource_multi_buffer_data_provider.cc
Consequence 1: a dead song can cost about 30 x (provider lookup + CDN request) per listener without backoff.
Consequence 2: serving a different rendition (different byte length) under the same URL mid-song makes Chrome fail;
quality must never change silently under one URL.

Behavioural reference: `Echo-Music/app/src/main/kotlin/com/music/echo/utils/InnerTubeXResolver.kt:236-331`
(per-track, per-client exclusion for 10 minutes after a refusal, bounded memory of 64 entries). Allegra has one client
per provider, so the useful part is "remember a refusal for a while and do not repeat it".

## 3. Design decisions

| Decision | Rationale |
| --- | --- |
| Key `stream:v2:<songId>` built without `cacheKey()` (case kept); `cacheKey` unchanged globally | BE-001 fix; search/text caches rely on lowercasing (BE-001 "Do not") |
| After the forced refresh is also refused (403/404/410), store `stream-dead:v1:<songId>` = `{ status }` for 60 s and answer 502 immediately while it exists | Breaks the retry storm; short enough that a recovered provider is used again within a minute |
| Remember refused URLs: `stream-refused:v1:<sha256(url) first 16>` for 600 s; a forced refresh that returns a URL already in that set is treated as refused without fetching it | Providers sometimes hand back the same stale link; skip the doomed CDN call (Echo's 10-minute window) |
| Memory is per instance (memory cache) | Matches today's cache; a cold instance just re-learns; no Convex write per stream |
| No silent rendition fallback; optional explicit `?quality=low` (slice 3) with its own cache key | Byte lengths differ per rendition; a distinct URL is a distinct resource for Chrome and for P1-1's cache key (path differs) |
| No cross-provider fallback | Would play a different recording under the same id; identity matching is not safe enough for audio |

## 4. Exact change list

### 4.1 `apps/api/src/lib/streamResolver.ts`

Constants:

```ts
const STREAM_URL_TTL_SECONDS = 3_600;
const DEAD_SONG_TTL_SECONDS = 60;
const REFUSED_URL_TTL_SECONDS = 600;
const REFUSED_STATUSES = new Set([403, 404, 410]);
const streamKey = (songId: string, rendition: Rendition): string => `stream:v2:${songId}${rendition === 'low' ? ':low' : ''}`;
const deadKey = (songId: string, rendition: Rendition): string => `stream-dead:v1:${songId}${rendition === 'low' ? ':low' : ''}`;
const refusedKey = (url: string): string => `stream-refused:v1:${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;
export type Rendition = 'default' | 'low';
```

`pipe(songId, range, response, corr?, rendition: Rendition = 'default')` pseudocode (replaces lines 46-56):

```
if await cache.get(deadKey(songId, rendition)) -> throw new ProviderUnavailableError()   // 502 JSON via sendFailure
upstream = fetchResolved(songId, range, force=false, rendition)
if REFUSED_STATUSES.has(status):
   cache.set(refusedKey(upstream.url), true, REFUSED_URL_TTL_SECONDS)
   upstream.abort()
   upstream = fetchResolved(songId, range, force=true, rendition)      // resolve() skips URLs in the refused set (below)
   if REFUSED_STATUSES.has(status):
      cache.set(refusedKey(upstream.url), true, REFUSED_URL_TTL_SECONDS)
      cache.set(deadKey(songId, rendition), { status }, DEAD_SONG_TTL_SECONDS)
      cache.delete(streamKey(songId, rendition))
      upstream.abort(); log.warn(...'stream song dead'); throw new ProviderUnavailableError()
if !PASSTHROUGH_STATUSES.has(status): (unchanged)
... rest unchanged (headers, Cache-Control, CORP, body pipe)
```

`resolve(songId, force, rendition)`: read/write `streamKey(...)` instead of `cacheKey('stream', songId)`; when `force` and
the provider's URL is in the refused set (`await cache.get(refusedKey(url))`), throw `ProviderUnavailableError` without
fetching (the caller's second branch then marks the song dead because `fetchResolved` maps it to the same error; make
`fetchResolved` return a synthetic `{ status: 403 }` result in that case so the dead marking runs: simplest is a small
internal `RefusedLinkError` caught in `pipe`).

Rendition selection (slice 3 only): `default` keeps line 132 exactly. `low` picks the first of `160kbps`, `96kbps`, `48kbps`
present, else the last asset.

`resolveSourceUrl` (karaoke source, line 42) uses `default` and is otherwise unchanged.

### 4.2 Slice 3 (optional): `apps/api/src/routes/stream.ts`

Read `request.query.quality`; accept only the literal `'low'`; anything else (including absent) is `default`; a present
but different value -> 400 `"Something's missing from that request."`. Pass to `pipe`. Contract addition in
`docs/api-contract.md` under `/api/stream/:songId`: "Optional `?quality=low` serves a lower-bitrate rendition; it is a
different resource with its own length; clients use it only as a fresh load, never mid-song for the same element source."
No client uses it until open question 1 is settled.

## 5. Implementation order

1. Slice 1 (BE-001): versioned case-preserving key + test. Verify `cd apps/api && node --import tsx --test src/lib/streamResolver.test.ts`.
2. Slice 2: refused-URL memory, dead-song backoff, logging through P2-1 (`redactUrl`). Same verify, then root gates.
3. Preview proof (section 9).
4. Slice 3 only if evidence shows 320 refusals with working lower renditions (open question 1).

## 6. Edge cases and failure modes

| Input / state | Required behaviour |
| --- | --- |
| `saavn:AbC` then `saavn:abc` | Two keys, two lookups, correct audio each (regression test) |
| Range request for a dead song | 502 JSON before headers (existing `sendFailure`); Chrome eventually surfaces a network error; P1-2 web recovery retries at most twice, then the existing failure path |
| Dead marker expires while provider recovered | Next request resolves normally |
| First fetch refused, refresh OK | Normal 206/200; the old URL stays in the refused set 10 min (harmless) |
| Provider returns the refused URL again on refresh | No CDN call; song marked dead 60 s |
| 416 | Still passed through (unchanged) |
| Instance A marked dead, instance B not | B tries once more and learns; acceptable |
| Gaana refs | Same logic; keys include the full `gaana:` id |

## 7. Test plan

`apps/api/src/lib/streamResolver.test.ts` (reuse `fakeResponse`, `json`, fake providers already in the file):
- `case-distinct ids resolve separately` (BE-001 regression: two ids `song-AbC` / `song-abc` with distinct URLs; assert each CDN fetch targets its own URL).
- `a song refused twice is answered from the dead marker without new lookups` (second `pipe` call: provider and CDN call counters unchanged, rejects `ProviderUnavailableError`).
- `the dead marker expires` (inject a `MemoryCacheStore`, then `cache.delete(deadKey)`; or construct with a fake clock store).
- `a refresh returning a refused url is not fetched` (provider returns the same URL twice; CDN called once).
- `range and status pass-through unchanged` (existing 206 test still green).
- `low rendition picks 160kbps and its own cache key` (slice 3).
Existing `app.routes.test.ts` stream cases must pass.

## 8. Security, privacy and cost

Lowers provider and CDN load under failure. Cache keys contain public song ids and URL hashes only. No new data stored
outside instance memory.

## 9. Rollout and rollback

No flag. Rollback by revert (the v2 key simply goes cold). Prove on a preview: request a known-dead id 20 times in a
row (`for i in $(seq 20); do curl -s -o /dev/null -w "%{http_code}\n" -H "Range: bytes=0-" https://<preview>/api/stream/<dead-id>; done`):
first two take provider time, the rest return 502 in a few ms; `vercel logs` shows exactly one `stream song dead` line per
instance per minute. Then play a normal song through the website and seek: Network tab shows 206 with `Content-Range`.

## 10. Acceptance checklist

- [ ] `cacheKey()` itself unchanged; only the stream key bypasses it.
- [ ] Stream cache key carries a version (`v2`).
- [ ] 206/`Content-Range`/`Accept-Ranges` behaviour byte-for-byte unchanged (existing tests).
- [ ] No silent rendition change under one URL.
- [ ] Logs use `redactUrl`; no signed URL in logs.

Common mistakes: lowercasing through `cacheKey`; marking a song dead on a timeout (only 403/404/410 count); caching the
dead marker longer than a minute; changing the rendition on a Range request.

## 11. Open questions (defaults)

1. Ship `?quality=low` and teach clients to use it? Default: no, until production logs (P2-1) show refusals that a lower rendition would have avoided.
2. Share dead markers across instances via Convex? Default: no (write per failure, small gain).
