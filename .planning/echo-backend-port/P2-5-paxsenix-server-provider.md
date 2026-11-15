# P2-5 Paxsenix (Apple Music word-synced lyrics) as a server-side provider, behind a feasibility gate

Draft id: P1-4 (Paxsenix + SimpMusic into apps/api). Demoted to P2 and split: Paxsenix only, gated by a probe;
SimpMusic stays on the phone (REJECTED.md). Branch: `feat/api-paxsenix-lyrics`. API only.
Cache-key bump: `lyrics-alternatives` v2 -> v3 (new source in the picker). Contract: doc text only (source list).

## 1. Goal and user-visible outcome

Web listeners (and phone listeners whose on-device providers miss) get Apple Music word-by-word lyrics for more songs,
because the API asks one more source, Paxsenix, after the providers it already has. If Paxsenix refuses Vercel's
servers, nothing ships beyond the probe.

Non-goals: moving the phone's on-device providers to the server (they work from listeners' own networks and would hit
the same blocking); SimpMusic on the server; new word-sync formats (the API already turns TTML into timed LRC).

## 2. Evidence

Draft premises re-checked:

| Draft claim | Verdict | Evidence |
| --- | --- | --- |
| "web gets word sync" by adding Paxsenix | PARTLY WRONG: the web already gets word-synced lyrics from BetterLyrics TTML and LyricsPlus syllables | `apps/api/src/providers/betterlyrics.ts:81-101`, `apps/api/src/providers/youlyplus.ts:1-104`, contract `docs/api-contract.md:47-50` |
| Move SimpMusic into the API | WRONG: SimpMusic is keyed by YouTube video id; the API has no YouTube ids (`rg -i videoid apps/api/src` matches only a comment in betterlyrics.ts) and the service calls itself "Educational and non-commercial" | `apps/mobile/src/services/lyrics/providers.ts:259-295`; https://lyrics.simpmusic.org/ (accessed 2026-11-13) |
| Server-side calls are a drop-in | UNVERIFIED and risky: from this planning machine both `lyrics.paxsenix.org/apple-music/search` and `api-lyrics.simpmusic.org/v1/<id>` returned a Cloudflare "Attention Required" 403 page on 2026-11-13 (curl, two user agents). Datacenter egress (Vercel) may get the same | probe log in this plan's section 5 step 0 |
| Paxsenix search endpoint | UNVERIFIED: the Paxsenix status page lists 16 routes and shows `/apple-music/lyrics` but no `/apple-music/search` (it lists search routes for Spotify, YouTube, NetEase, QQ and KuGou). The phone still calls `/apple-music/search` | https://lyrics.paxsenix.org/ (accessed 2026-11-13); `apps/mobile/src/services/lyrics/providers.ts:185-221` |
| Privacy | The Paxsenix status page shows a public request log with IP and User-Agent columns | https://lyrics.paxsenix.org/ (accessed 2026-11-13) |

Current API lyric path: LRCLIB first, then BetterLyrics, LyricsPlus, Unison, Lyrica, KuGou in parallel, synced preferred
(`apps/api/src/services/lyrics.ts:276-369`); alternatives for the picker (`:424-491`, cache key `lyrics-alternatives` v2 at `:432`);
11 s listener budget (`:35`); TTML -> LRC with word tags (`betterlyrics.ts:85-101`); providers built from config with an
`isOff` switch (`apps/api/src/config.ts:114-125`, `apps/api/src/services.ts:213-224`); `CircuitBreaker` exists
(`apps/api/src/lib/circuitBreaker.ts`) and is used by the catalog only.

Behavioural reference: `Echo-Music/paxsenixlyrics/src/main/kotlin/com/music/paxsenix/Paxsenix.kt` (three search queries
in turn: cleaned title + artist, title alone, title + artist + album; candidates scored on duration closeness, cleaned
title equality or containment, artist containment or word overlap, with penalties for remix/mixed results the request
did not ask for; the top few fetched in parallel; the first word-timed result wins, else the first other result;
TTML preferred, then multi-person enhanced LRC, then enhanced LRC, then plain, then the `content` array).
Response field names: `PaxsenixModels.kt` (`id, songName, trackName, artistName, albumName, duration(ms), artwork`;
lyrics `type, content[{timestamp, endtime, duration, text[{text, timestamp, endtime, duration, part}], background, oppositeTurn}], elrc, elrcMultiPerson, ttmlContent, plain`).

## 3. Design decisions

| Decision | Rationale |
| --- | --- |
| Step 0 is a probe; ship the provider only if at least 8 of 10 probe songs get HTTP 200 JSON from Paxsenix through a Vercel preview | Cloudflare may block datacenter IPs; no point building a provider that always 403s |
| Off by default: `PAXSENIX_API_URL` unset means not built; `off` keeps it off; a URL turns it on | Same switch style as `LYRICA_API_URL` etc. (`config.ts:114-125`) |
| Place it in `fromAggregators` after LyricsPlus and before Unison; never before LRCLIB | Keeps today's ordering; Apple word-timed sources sit together |
| Up to 2 search queries (lead artist + title, then title alone), up to 3 candidates fetched in parallel, 8 s per request | Bounded outbound work inside the 11 s budget |
| Own scoring (numbers below), with P2-4's `versionPenalty` | Clean-room; uses the shared version rule |
| Circuit breaker: 3 failures (403/5xx/timeout) open it for 10 minutes | Stops paying a timeout per lookup when blocked |
| User-Agent `Allegra/1.0` (as other API providers) | Honest identification; never impersonate another app |

## 4. Exact change list

### 4.1 Create `apps/api/src/providers/paxsenix.ts`

```ts
export const PAXSENIX_TIMEOUT_MS = 8_000;
export const PAXSENIX_MAX_CANDIDATES = 3;
export const PAXSENIX_MIN_SCORE = 1;

interface PaxSearchHit { readonly id: string; readonly songName?: string; readonly trackName?: string; readonly artistName?: string; readonly albumName?: string; readonly duration?: number /* ms */ }
interface PaxWord { readonly text: string; readonly timestamp?: number; readonly endtime?: number; readonly part?: boolean }
interface PaxLine { readonly timestamp: number; readonly text?: readonly PaxWord[] }
interface PaxLyrics { readonly type?: string; readonly content?: readonly PaxLine[]; readonly elrc?: string; readonly elrcMultiPerson?: string; readonly ttmlContent?: string; readonly plain?: string }

export interface PaxsenixProviderOptions { readonly baseUrl: string; readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number; readonly breaker?: CircuitBreaker }

export class PaxsenixProvider {
  public constructor(options: PaxsenixProviderOptions);
  public find(title: string, artist: string, duration: number | undefined): Promise<LyricsCandidate | null>;
  public findAll(title: string, artist: string, duration: number | undefined): Promise<LyricsCandidate[]>; // up to 3, for the picker
}

export function scorePaxHit(hit: PaxSearchHit, title: string, artist: string, durationSec: number | undefined): number;
export function paxLyricsToLrc(body: PaxLyrics): { readonly lrc: string; readonly wordTimed: boolean } | null;
```

Scoring (`durationSec` is seconds; Paxsenix `duration` is milliseconds, convert with `/ 1000`):

```
score = 0
if durationSec and hit.duration:
   gap = |hit.duration / 1000 - durationSec|
   score += gap <= 2 ? 100 : gap <= 5 ? 50 : gap <= 10 ? 10 : -50
name = norm(hit.trackName ?? hit.songName); want = norm(title)           // norm: lower-case, drop (...) and [...], collapse spaces
score += name === want ? 80 : (name.includes(want) || want.includes(name)) && name && want ? 40 : 0
lead = norm(leadArtist(artist)); got = norm(hit.artistName)
score += got.includes(lead) && lead ? 50 : wordsOverlap(lead, got) ? 25 : 0  // any word of 3+ letters shared
score += versionPenalty(title, hit.trackName ?? hit.songName ?? '')      // P2-4
keep hits with score >= PAXSENIX_MIN_SCORE, sort descending, take 3
```

Worked example: request "Blinding Lights" / "The Weeknd" / 200 s. Hit A "Blinding Lights", "The Weeknd", 200040 ms ->
100 + 80 + 50 + 0 = 230. Hit B "Blinding Lights (Slowed + Reverb)", "The Weeknd", 262000 ms -> gap 62 -> -50; `norm` drops the
bracket so the name equals -> 80; artist 50; version -120 -> -40 (dropped, below 1). The version penalty is what removes
B; without P2-4 it would score 80 and survive.

`paxLyricsToLrc` order: `ttmlContent` via `ttmlToLrc` (`apps/api/src/providers/betterlyrics.ts:85`) ->
`content` with every word timed -> one enhanced line per entry using `alignSyllables`/`enhancedLine` from
`apps/api/src/shared/wordSync.ts` (seconds = ms / 1000; a `part` word joins the next without a space) -> `elrcMultiPerson`
-> `elrc` -> `plain`. `wordTimed` = the LRC contains `<mm:ss` word tags. Reject strings that `looksLikeHtml`.

`find` flow: if breaker open return null; queries `[`${title} ${lead}`, title]`; for each query until hits: GET
`${base}/apple-music/search?q=` -> scored list; fetch top 3 `GET ${base}/apple-music/lyrics?id=` in parallel
(`Promise.allSettled`); pick the first word-timed in score order, else the first non-null. 403/5xx/timeout -> `breaker.failure()`;
any 200 -> `breaker.success()`. Return `{ lyrics, source: 'Paxsenix', filedAs: `${artistName} — ${trackName}` }`.

### 4.2 Wire

- `apps/api/src/config.ts`: `paxsenixApiUrl = isOff(env.PAXSENIX_API_URL) ? undefined : readOptionalProviderUrl(env.PAXSENIX_API_URL, production, 'PAXSENIX_API_URL')` (no default URL; off unless set). Add to `AppConfig` and to the `ProviderSettings` pick in `services.ts:54-78`.
- `apps/api/src/services.ts:216-224`: `...(options.paxsenixApiUrl ? { paxsenix: new PaxsenixProvider({ baseUrl: options.paxsenixApiUrl, breaker: new CircuitBreaker(3, 600_000), ...fetchImpl }) } : {})`.
- `apps/api/src/services/lyrics.ts`: `LyricsSources.paxsenix?: PaxsenixProvider`; in `fromAggregators` (line 361) add it
  after `youLyPlus`; in `providerAlternatives` (line 447-452) add `withinBudget(this.paxsenix ? this.paxsenix.findAll(...) : Promise.resolve([]), this.budgetMs)`
  in the same position; bump the alternatives key at line 432 from `'v2'` to `'v3'`.
- `apps/api/.env.example`: `PAXSENIX_API_URL=` with a comment "off unless set; see .planning/echo-backend-port/P2-5".
- `docs/api-contract.md:289` and `:335`: add Paxsenix to the source lists, noting it is optional.

## 5. Implementation order

0. Probe (before any provider code is merged). On a throwaway branch, add a temporary route guarded by
   `process.env.VERCEL_ENV === 'preview'` that fetches `https://lyrics.paxsenix.org/apple-music/search?q=<q>` for 10
   fixed songs (5 English, 5 Indian-language) and returns only `{ q, status, contentType }` per song. Deploy a preview,
   call it three times over an hour, record the table in this file's section 12, delete the branch. Gate: >= 8/10 JSON
   200 on every run. If the search route 404s but `/apple-music/lyrics` works, stop: there is no way to find ids (do not
   add a different search provider in this item).
1. `paxsenix.ts` + tests (fixtures captured during the probe, with ids only). Verify
   `cd apps/api && node --import tsx --test src/providers/paxsenix.test.ts`.
2. Wiring, key bump, docs. Verify `npm run typecheck && npm run lint && npm test`.
3. Preview with `PAXSENIX_API_URL=https://lyrics.paxsenix.org`; open Other lyrics for the probe songs; confirm a
   "Paxsenix" entry with word timing for at least half.

## 6. Edge cases

| Input / state | Behaviour |
| --- | --- |
| Cloudflare 403 HTML | Not JSON -> failure -> breaker counts; never parsed as lyrics |
| Breaker open | `find` returns null at once; other providers unaffected |
| Search returns nothing for query 1 | Query 2 |
| All candidates plain | First plain one, used only when no synced source wins in `fromAggregators` |
| Duration unknown | No duration points; title/artist decide |
| `part` words | Joined without a space (`paxLyricsToLrc`) |
| Lookup slower than 11 s | `withinBudget` returns LATE; result still caches (existing behaviour) |

## 7. Test plan

`apps/api/src/providers/paxsenix.test.ts` with a fake `fetchImpl`:
`scores the exact recording highest` (worked example A = 230), `drops a slowed upload` (B = -40, dropped),
`prefers a word-timed candidate over a better-scored plain one`, `ttml content becomes timed LRC with word tags`,
`content array with part words joins syllables without spaces`, `cloudflare html is a failure, not lyrics`,
`three failures open the breaker`, `duration is compared in seconds after dividing milliseconds`.
`apps/api/src/services/lyrics.test.ts` add: `paxsenix sits after LyricsPlus in alternatives`, `absent provider changes nothing`.
Existing `lyricsSources.test.ts`, `lyrics.test.ts` green.

## 8. Security, privacy and cost

- Server-side calls expose Vercel's IP, not listeners' (the phone's direct calls expose the listener's IP and UA on the
  public Paxsenix log; noted for the owner, open question 2).
- Third-party ToS: no published terms found (UNVERIFIED). The service proxies Apple Music lyrics; lyrics remain rights
  holders' work (`CREDITS.md`). Keep the switch so it can be turned off at once.
- Cost: at most 2 + 3 requests per uncached lookup, cached 30 days through the existing lyrics cache.

## 9. Rollout and rollback

Env-gated (`PAXSENIX_API_URL`). Rollback: unset or `off`, redeploy. Evidence: the probe table, preview screenshots of
Other lyrics, `vercel logs` showing no repeated `paxsenix` failures after the breaker opens.

## 10. Acceptance checklist

- [ ] Probe passed and recorded before merge.
- [ ] No default URL in code; off unless configured.
- [ ] `lyrics-alternatives` key bumped to v3.
- [ ] Seconds vs milliseconds conversion tested.
- [ ] Phone providers untouched.

Common mistakes: shipping without the probe; impersonating another app's User-Agent; parsing an HTML challenge page;
forgetting the alternatives key bump.

## 11. Open questions (defaults)

1. If the probe fails, try again from a different region? Default: no; leave Paxsenix to the phone.
2. Route the phone's Paxsenix calls through the API to hide listener IPs? Default: no until the probe passes; then a
   separate mobile PR (version bump) can switch `paxsenix` in `apps/mobile/src/services/lyrics/providers.ts` to the API's
   alternatives endpoint.
3. Does `/apple-music/search` still exist? Default: assume unknown; the probe decides. If it is gone, open a mobile bug:
   the phone's Paxsenix provider would be dead code (verify with `lyricflow://diagnose` logs on a device).

## 12. Probe results

(Fill in during step 0: date, preview URL, 10 rows of `q | status | content-type`, three runs.)
