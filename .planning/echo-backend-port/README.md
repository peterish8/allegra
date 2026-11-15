# Echo backend port: master index

Planning set written 2026-11-13 against `fix/web-auth-dialog-focus` @ 8a084c07. Reference codebase: Echo-Music
(`github.com/EchoMusicApp/Echo-Music` @ 0d8435dc, GPL-3.0), read for behaviour only. Every plan is clean-room: it
describes behaviour, numbers and protocols in Allegra's own words and code; none tells the implementer to copy Echo.

Read [CLAUDE.md](../../CLAUDE.md), [the codebase map](../../docs/current-codebase.md) and the plan you are executing.
Each plan is self-contained (goal, evidence with file:line, decisions, exact change list, order, edge cases, tests,
security, rollout, checklist, open questions with defaults). Path convention: every cited path that exists on main
today was checked on 2026-11-13; any path that does not exist yet (new modules, new test files, fixtures) is a file the
plan creates and appears in that plan's change list or test plan. Line numbers are for the commit above; recheck them
against the live diff before editing.

## Executive summary

The draft's ten items were re-checked against live code and current external documentation. Three premises were wrong
or overtaken: browsers and ExoPlayer already retry a broken stream body with a Range request (so a server-side resume is
low value), the website already receives word-synced lyrics (BetterLyrics TTML, LyricsPlus), and SimpMusic cannot run on
the server (it needs YouTube video ids the API never has). Production also uses a per-instance memory cache only
(`LayeredCacheStore` exists but is not wired, `apps/api/src/createAppFromEnv.ts:13-18`), which shapes every
"remember for 10 minutes" design. The biggest listener-facing wins are on Android (a disk cache and a byte-level resume
layer under ExoPlayer, then an end-of-track guard) and the web player's handling of a mid-song network error, which today
stops the song with "This track could not be loaded". Last.fm scrobbling is the one new feature and follows the
existing Spotify integration's trust split. Supply-chain hardening was promoted because it is cheap and closes backlog
CI-002. Translation was redesigned as bring-your-own-key (same model as the DJ) instead of a server-paid LLM.

## Priority table (this set's numbering)

| # | File | Draft item | Verdict on the draft premise | Scope | Branch(es) |
| --- | --- | --- | --- | --- | --- |
| P1-1 | [Android stream cache + resuming data source](P1-1-android-stream-cache.md) | P1-2 | CONFIRMED (`PlaybackService.kt:272-282` plain `DefaultHttpDataSource`); Media3 1.8.0 returns end-of-input silently on an early socket close | mobile | `feat/android-stream-cache` |
| P1-2 | [Premature-end guard (Android) + mid-song recovery (web)](P1-2-premature-end-recovery.md) | P1-3 | CONFIRMED, extended: Android needs a playlist auto-transition hook, not only `STATE_ENDED`; web error path stops playback (`useAudioPlayer.ts:569-587`); AND-003 is mostly fixed already (`ResumeOnline.kt`) | mobile + web | `fix/android-cutoff-guard`, `fix/web-midsong-recovery` |
| P1-3 | [Last.fm scrobbling (+ optional ListenBrainz)](P1-3-lastfm-scrobbling.md) | P1-5 | PARTLY WRONG: signing must live in the API (not Convex), mirroring Spotify; Echo's 50 s threshold breaks Last.fm's rule | shared, Convex, API, web, mobile | `feat/lastfm-rules`, `feat/lastfm-convex`, `feat/lastfm-api`, `feat/lastfm-web`, `feat/lastfm-mobile` (+2 optional) |
| P1-4 | [Supply chain: pinned Actions, Dependabot, CodeQL](P1-4-supply-chain-ci.md) | P2-10 (promoted) | CONFIRMED (no config; mutable tags, backlog CI-002) | CI | `chore/ci-pin-actions`, `chore/ci-dependabot`, `chore/ci-codeql` |
| P2-1 | [Structured diagnostics](P2-1-diagnostics.md) | P2-9 | CONFIRMED (stream path logs nothing); Allegra keeps pino JSON rather than Echo's `k=v` lines | API | `chore/api-diagnostics` |
| P2-2 | [Stream resolver hardening](P2-2-stream-resolver-hardening.md) | P2-7 (+ backlog BE-001) | PARTLY WRONG: silent 320->160 step-down and cross-provider fallback would break byte ranges; replaced by refusal memory, dead-song backoff, optional explicit `?quality=low` | API | `fix/stream-resolver-memory` |
| P2-3 | [Lyrics translation, BYOK LLM](P2-3-lyrics-translation-byok.md) | P1-6 (demoted) | PARTLY WRONG: a server-paid key conflicts with a free product; the DJ already proxies listener keys | API + web | `feat/lyrics-translate-ai` |
| P2-4 | [Shared track-version rules](P2-4-track-version-rules.md) | P2-8 (narrowed) | PARTLY WRONG: cleaning already exists (`lyrics.ts:520-583`); only a shared version-tag rule is missing | shared + API | `feat/shared-track-version` |
| P2-5 | [Paxsenix server provider behind a probe](P2-5-paxsenix-server-provider.md) | P1-4 (demoted, split) | PARTLY WRONG: web already has word sync; SimpMusic impossible server-side; Cloudflare challenges seen; `/apple-music/search` not listed on the service's status page | API | `feat/api-paxsenix-lyrics` |
| P3-1 | [Stream proxy mid-body resume (gated)](P3-1-stream-proxy-midstream-resume.md) | P1-1 (demoted) | CONFIRMED that no resume exists (`streamResolver.ts:76-95`), but Chrome already retries short/failed loads with Range; build only on log evidence | API | `feat/stream-midbody-resume` |
| O-11..O-15 | [Optional feasibility](OPTIONAL-FEASIBILITY.md) | O-11, O-12, O-13 + new | O-13 already built (`luvLinkReady`/`luvLinkBarriers`); `animatedArtwork.ts` exists only under `.planning/recovery/replayed/` | - | - |
| R-1..R-11 | [Rejected](REJECTED.md) | do-not-port list + own rejections | - | - | - |

Background facts from the draft, re-verified: `StreamResolver.pipe` destroys on body error (CONFIRMED,
`streamResolver.ts:83-95`); "layered cache" (PARTLY WRONG: class exists, production wires `MemoryCacheStore` only);
Paxsenix/SimpMusic mobile-only (CONFIRMED, `apps/mobile/src/services/lyrics/providers.ts:154-295`); MyMemory anonymous cap
(CONFIRMED, `translation.ts:25-29`); no scrobbling/recognition/dependabot/CodeQL (CONFIRMED); `animatedArtwork.ts` missing
from `apps/api/src` (CONFIRMED; `CLAUDE.md`'s single-test example points at it, see OPTIONAL-FEASIBILITY O-12).

## Dependency graph

```
P2-1 diagnostics ──────────────┬──> P2-2 resolver hardening ──> P3-1 mid-body resume (also needs P2-1's sentBytes logs as its gate)
                               ├──> P1-3 Last.fm (logging fields; may land before P2-1 with no user field logged)
                               └──> P2-5 Paxsenix (timedWarn)
P2-4 track-version rules ──────────> P2-5 Paxsenix
P1-1 Android cache ────────────────> P1-2 Android guard (ship order; the guard also works alone)
P1-2 web recovery                    independent
P1-3 slices: rules -> convex -> api -> web -> mobile -> (listenbrainz, love)
P1-4 CI                              independent; do the pin PR first so later PRs run on pinned Actions
P2-3 translation                     independent
```

Suggested order: P1-4 pins, P2-1, P1-1, P1-2 (web), P1-2 (Android), P1-3 slices, P2-2, P2-4, P2-3, P2-5 probe, P3-1 gate.

## PR slicing and commit subjects

Conventional commits, short imperative subject, no AI attribution footers (`CLAUDE.md`, `apps/mobile/CLAUDE.md`).
Squash-merge, reviewed by a non-author.

| Branch | Commit subject (squash title) |
| --- | --- |
| `chore/ci-pin-actions` | `chore(infra): pin workflow actions to commit SHAs` |
| `chore/ci-dependabot` | `chore(infra): add grouped Dependabot updates` |
| `chore/ci-codeql` | `chore(infra): scan TypeScript, workflows and Rust with CodeQL` |
| `chore/api-diagnostics` | `chore(api): add redacted correlation logging to the stream path` |
| `feat/android-stream-cache` | `feat(mobile): cache streamed songs on disk and resume broken downloads` |
| `fix/web-midsong-recovery` | `fix(web): resume a song after a mid-song network error` |
| `fix/android-cutoff-guard` | `fix(mobile): resume a track that ends before its length` |
| `feat/lastfm-rules` | `feat(api): add Last.fm signing and scrobble rules` |
| `feat/lastfm-convex` | `feat(convex): store Last.fm links and a durable scrobble queue` |
| `feat/lastfm-api` | `feat(api): connect Last.fm and send now playing and scrobbles` |
| `feat/lastfm-web` | `feat(web): connect Last.fm from settings` |
| `feat/lastfm-mobile` | `feat(mobile): connect Last.fm from settings` |
| `feat/listenbrainz-sink` (optional) | `feat(api): send scrobbles to ListenBrainz` |
| `feat/lastfm-love` (optional) | `feat(api): love liked songs on Last.fm` |
| `fix/stream-resolver-memory` | `fix(api): keep stream cache keys case-sensitive and back off dead songs` |
| `feat/shared-track-version` | `feat(shared): add track version tags for matching` |
| `feat/lyrics-translate-ai` | `feat(api): translate and romanise lyrics with the listener's AI key` |
| `feat/api-paxsenix-lyrics` | `feat(api): add Paxsenix word-synced lyrics behind a switch` |
| `feat/stream-midbody-resume` | `feat(api): resume a stream body that breaks mid-response` |
| (docs) | `docs: point the single-test example at an existing test` |

## Side effects per item

Rule reminders: any change under `apps/mobile/**`, `packages/**`, `convex/_generated/**` or `.github/workflows/mobile-apk.yml`
rebuilds the APK and must bump `apps/mobile/app.json` `expo.version` in the same PR (`.github/workflows/mobile-apk.yml:10-27`,
currently 1.60.0; use the next number after whatever main holds). A change under `apps/desktop/**` bumps
`apps/desktop/Cargo.toml` `version`.

| Item / PR | expo.version | Cargo.toml | Cache key bump | sync:shared | convex dev --once + convex:test list | docs/api-contract.md |
| --- | --- | --- | --- | --- | --- | --- |
| P1-1 | minor | - | - (new native key `v1`) | - | - | - |
| P1-2 Android | patch | - | - | - | - | - |
| P1-2 web | - | - | - | - | - | - |
| P1-3 `lastfm-rules` | patch (`packages/**`) | - | - | yes (`scrobble.ts`) | - | - |
| P1-3 `lastfm-convex` | patch (`convex/_generated/**`) | - | - | - | yes; add `convex/scrobbles.test.ts` to `convex:test` | - |
| P1-3 `lastfm-api` | - | - | - | - | - | yes (new section, rate table, export field) |
| P1-3 `lastfm-mobile` | minor | - | - | - | - | - |
| P1-4 pins | patch (`mobile-apk.yml`) | patch (`desktop.yml` rebuilds) | - | - | - | - |
| P1-4 dependabot / codeql | - | - | - | - | - | - (`docs/workflows.md` section) |
| P2-1 | - | - | - | - | - | - |
| P2-2 | - | - | `stream` -> `stream:v2:` | - | - | slice 3 only (`?quality=low`) |
| P2-3 | - | - | new `translate:llm-v1` key | - | - | yes (`mode`, `ai`) |
| P2-4 | patch (`packages/**`) | - | - | yes (`trackVersion.ts`) | - | - |
| P2-5 | - | - | `lyrics-alternatives` v2 -> v3 | - | - | yes (source lists) |
| P3-1 | - | - | - | - | - | - |

New Express routers and their mandatory supertest through `createApp`: P1-3 (`scrobbleRouter`, test
`apps/api/src/app.scrobble.test.ts`). P2-3 changes an existing router and adds `app.translate.test.ts`.

## Licence facts and recommended action (not legal advice)

Facts found in the repository on 2026-11-13:

1. The brief describes Allegra as proprietary, but the repository says otherwise: the root `LICENSE` is the GNU GPL v3
   text; root `package.json` declares `"license": "GPL-3.0-only"` (added in 75570113, 2026-10-02); `README.md:131-137`
   says "source code under GPL-3.0"; `CREDITS.md` says the code is offered under GPL v3.
2. `CREDITS.md` credits "Echo Music" with a link to `github.com/brahmkshatriya/echo` under the "Unabandon Public License"
   (`licenses/echo-UPL.md`, GPLv3 plus a public-source requirement). The reference checkout used for this plan is a
   different project, `github.com/EchoMusicApp/Echo-Music`, whose `LICENSE` file is plain GPL-3.0 (Metrolist lineage).
3. Several shipped files say they were ported from Echo Music: `apps/mobile/src/services/lyrics/providers.ts:2`
   ("Lyrics providers ported from Echo Music"), `apps/mobile/src/services/lyrics/EchoLyricsCascade.ts:2`,
   `apps/mobile/src/services/lyrics/lrc.ts:2`, `apps/mobile/src/services/lyrics/lyricsPicker.ts:2`; `apps/mobile/CLAUDE.md`
   describes the queue engine, Listen Together codec, YouTube Music browse parsers, player menu and glow maths as ported from
   Echo. `providers.ts` arrived with the LuvLyrics import (52d50eb9, 2026-09-29).

Recommended action for the owner:
- Confirm which upstream each "ported from Echo" file came from (the two Echo projects have different licences) and
  correct the `CREDITS.md` row (name, URL, licence) accordingly.
- Keep per-file attribution headers on ported files; if the project stays GPL-3.0, make sure every distributed APK and
  desktop build points to its corresponding source (CREDITS.md already says so).
- If Allegra is ever to become proprietary, inventory the ported files listed above (and any others found with
  `rg -i "echo|metrolist|ported" apps packages`) and rewrite them clean-room or remove them before relicensing.
- Have a lawyer review the UPL's extra public-source term and the GPL obligations before the next public release.
- This planning set itself contains no Echo code; plans cite Echo paths only as behavioural references.

## Global definition of done

Local gates (every PR):

```
npm run typecheck      # exit 0
npm run lint           # exit 0
npm test               # workspaces + infra + convex tests, all green
```

Plus, as applicable:
- Mobile paths: `npm run convex:test` finished first, then `npm run mobile:check`, then
  `cd apps/mobile/android && ./gradlew :app:testDebugUnitTest` (never overlap convex and mobile runs; learning log item 20).
- `packages/shared` edited: `npm run sync:shared` and the infra parity test.
- `convex/` edited: `npx convex dev --once`; never hand-edit `convex/_generated`; new test file added to `convex:test`.
- New router: supertest through `createApp`.
- Matcher/scorer changed: cache key bumped.
- Response shape changed: `docs/api-contract.md` updated in the same PR, before clients rely on it.
- Web UI: checked at 360 / 768 / 1280 / 1920; motion only `transform`/`opacity` with tokens; reduced motion collapses to opacity.
- Every fix ships a regression test (owner rule); full local `npm run e2e` before merging a feature.

Evidence that local tests cannot give (recorded separately, never implied by green CI):
- Vercel: the item's route requested on a preview or production deployment, `vercel logs` read for the route, and for any
  stream change the Range rule proven (`curl -s -D - -o /dev/null -H "Range: bytes=0-1023" .../api/stream/<id>` -> 206 with
  `Content-Range` and `Accept-Ranges`, `docs/workflows.md:122-127`).
- Phone: a physical Android device for P1-1 and P1-2 (airplane-mode and Wi-Fi handoff checks, background playback),
  recorded in `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md`. CI emulator runs prove launch, not playback quality.
- Third parties: P1-3 live Last.fm connect and three scrobbles; P2-5 probe table; P2-3 one real-key translation.

## Top risks

1. Paxsenix and SimpMusic sit behind Cloudflare challenges; server-side calls from Vercel may be blocked outright (P2-5 probe gate).
2. Last.fm rate limits are per IP and Vercel egress IPs are shared by every listener (P1-3 batching and debounce).
3. P1-2's Android guard must suppress the undone track-change reports exactly, or JS sees phantom skips (listen
   tracker, lyrics, history).
4. P1-1 cache keys: keying by full signed URL makes the cache useless; keying by id alone could mix two renditions.
   The plan keys by id + host + path.
5. Version-bump drift: `packages/**` and `convex/_generated/**` changes rebuild the APK; several "backend" PRs need a
   mobile bump, and Dependabot PRs cannot add one by themselves (`needs-version-bump` label).

## UNVERIFIED facts the owner must check

- Paxsenix `/apple-music/search` still exists and whether Vercel IPs are allowed (P2-5 step 0).
- Paxsenix and SimpMusic terms of use (none found).
- Last.fm: exact `format=json` response shape; `format`/`callback` excluded from the signature (third-party source only);
  https endpoint accepted; numeric rate limit; maximum timestamp age (P1-3 step 3 live check).
- ListenBrainz `MAX_LISTENS_PER_REQUEST` and payload size limits.
- Media3 1.8.0 method names `DataSpec.subrange` and `MediaItem.Builder.setCustomCacheKey` (P1-1 step 1 compile spike).
- Exact delivery order of `onPositionDiscontinuity` vs `onMediaItemTransition` (P1-2 is designed not to depend on it).
- OpenAI strict JSON schema support for `minItems`/`maxItems` (P2-3 avoids them).
- Repository visibility and GitHub Advanced Security availability for CodeQL (P1-4).
- Current Action commit SHAs (resolve with `gh api`, never from memory).
- Whether Dependabot security updates are delayed by `cooldown`.
