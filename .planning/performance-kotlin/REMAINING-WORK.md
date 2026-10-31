# Performance and Kotlin: the remaining work

> **Re-check before use.** This list was written against a local checkout that was behind `origin/main`. Main
> has since gained native Android views (`NativeLyricsView`, scrubber, transport bar, tab bar, queue list and more;
> see [HANDOFF-ANDROID-NATIVE-UI.md](HANDOFF-ANDROID-NATIVE-UI.md)). Item 9 and parts of items 3–5 may already be
> done or changed. Verify each item against current `main` and tick or drop it before coding.

Date: 2026-11-01. Written for a coding agent picking this up cold. It lists what is left of
[MASTER-PLAN.md](MASTER-PLAN.md) (2026-10-04) after checking the code as it is today, one item at a time, each
with what "done" means and what it must not break.

The direction is settled: **React Native stays the app shell.** Kotlin owns playback, the queue, background work
and anything that draws every frame. No whole-app rewrite (owner decision, 2026-10-19). The glow looks stay on
weak phones: cut their pixels and frame rate, never switch them off by default.

## What is already done (do not redo)

- Media3 `PlaybackService` and the Kotlin `QueueEngine` own audio and the whole queue; JavaScript is a remote
  control and mirror (`apps/mobile/CLAUDE.md`, "The queue on Android").
- Notification, lock-screen, Bluetooth and Android Auto skips go to the engine (`QueueForwardingPlayer`).
- Queue snapshot writes run on their own thread (`QueueEngine.writer`, `saveNow`), atomic temp-then-rename.
- Luvs player pool, palette, search, voice, downloads and updates (WorkManager), the system island.
- Galaxy M31 light path (`5e56dcd`): `CpuClass`, `FrameWatch`, `PerfMarks`, native skip buttons
  (`NativeSkipView`), lighter shader/glass, `scripts/perf/low-end-baseline.sh` and `seed-library.sh`.
- Hidden surfaces rest and frame callbacks are stable worklets (UI-1, [LUNA-VERIFICATION.md](LUNA-VERIFICATION.md)).
- Lyric layout geometry fix in code and tests (phase 0, [VERIFICATION.md](VERIFICATION.md)).
- Lyric lookups for the same song are shared while in flight (`services/lyrics/EchoLyricsCascade.ts` `inFlight`).

## Rules for every item

Read first: root `CLAUDE.md`, `apps/mobile/CLAUDE.md`, `docs/architecture.md`, and the area plans
([UI-PERFORMANCE-PLAN.md](UI-PERFORMANCE-PLAN.md), [NATIVE-PLAYBACK-PLAN.md](NATIVE-PLAYBACK-PLAN.md)).

- **One item per branch and PR** (`perf/…`, `feat/…`, `fix/…`), squash-merged, small. Never work on `main`.
  Do not touch branch `feat/island-take-over` or its files (in flight).
- **Checks before a PR**, in `apps/mobile`: `npm run ci` (or `node_modules\.bin\tsc.cmd --noEmit`,
  `node_modules\.bin\eslint.cmd src index.ts`, `node_modules\.bin\jest.cmd` if the npm shim is broken). Kotlin
  changes also: `cd android && gradlew.bat :app:testDebugUnitTest`. Root: `npm run typecheck`, `npm run lint`,
  `npm test`. All exit 0. One Gradle build at a time on this machine (`gradlew --stop` first).
- **Version bump:** any change under `apps/mobile/`, `packages/` or `convex/_generated/` that rebuilds the APK bumps
  `expo.version` in `apps/mobile/app.json` (patch for fixes, minor for features) in the same PR.
- **Every fix ships a regression test.** Kotlin logic goes in a pure, JVM-tested file (like `QueueMath.kt`).
- **The three playback invariants** (`requestPlayback` funnel; load effects never depend on `isPlaying`; seek
  captures `wasPlaying` and resumes) and the byte-range rule are not negotiable.
- Animate `transform` and `opacity` only; durations and easings from tokens; Reduce Motion collapses to opacity.
- TypeScript strict, no `any`, no `console.log` (use `diag` or a `__DEV__` guard). Every provider call has a
  timeout and returns empty on failure, never throws (`services/net/fetchWithTimeout.ts`).
- New Expo native module: add it to the checked-in `ExpoModulesPackageList.kt`.
- Worklets: no default parameters naming outside variables, no React refs, `useFrameCallback` gets a
  `useCallback` worklet (`src/workletSafety.test.ts` enforces it).
- `src/services/ytmusic/` stays metadata-only: no stream-URL extraction, client spoofing or PoToken code.
- Commits: conventional (`perf(mobile):`, `feat(mobile):`), short imperative subject, **no AI attribution lines**.
- **Never claim a speed-up you did not measure.** "Tests pass" is not "faster on a phone". If an item needs a
  device and none is attached (`adb devices`), finish the code, write down exactly what is unverified, and leave
  the device box unticked.
- Stop and ask the owner where an item says **Owner decision**. Do not pick for them.

## Order

Items 1–4 are independent and can go in any order. Item 5 needs item 1's numbers to judge it. Items 6–8 are
larger and gated. Items 9–10 are not to be built now.

---

### 1. Release performance baseline on a real phone

The plan's phase 1. Every later "is it faster" answer depends on it. Nothing has ever been measured on a device:
the last diagnostic APK build (2026-10-06) failed at `:expo-constants:createExpoConfig` because `NODE_ENV` was not
set; the runner `scripts/perf/build_android_perf.ps1` was patched afterwards but never re-run
([../performance/ANDROID-RESULTS.md](../performance/ANDROID-RESULTS.md)).

- [ ] Build the profileable release APK with the patched runner; record its SHA256 and size.
- [ ] `scripts/perf/low-end-baseline.sh` refers to `docs/perf-low-end.md`, which does not exist. Write it: how to
      seed (`seed-library.sh`), run, and read `summary.tsv`.
- [ ] Run the baseline on the Galaxy M31 (or the owner's slowest phone) and one normal phone, 3 runs each, FPS HUD
      off, nothing else building: cold start, Stream scroll, Library scroll at 500 songs, open/close Now Playing,
      long lyrics, skip, Luvs lane swipe.
- [ ] Save results in `.planning/performance-kotlin/evidence/<date>-<device>/` (gfxinfo, summary.tsv, device,
      build, refresh rate, thermal and network notes).

**Done when:** an APK built from a known commit, and per scenario per device: janky-frame %, 90th/95th
percentile frame time and tap-to-audible (from `PerfMarks`), median of 3 runs, committed as evidence.
**Constraints:** no listener data or tokens in logs; the release launch gate (`mobile-launch-check.sh`) and
recovery gates stay unchanged; do not install over the owner's app data without asking.

### 2. Lyrics scroll geometry, proven on a phone

Phase 0 code is in (`SynchronizedLyrics.tsx`, `playback/lyricLayout.ts`); it was never seen on a device.

- [ ] On a phone or emulator running the current build: the sung line stays at `activeLinePosition` (0.35) of the
      lyrics viewport for middle and final wrapped lines, after a seek, after manual scroll and resume, after a
      text-size change, after reopening the player, and in the Connect remote view.
- [ ] Screenshots for each case in `evidence/`.

**Done when:** every case above has a screenshot showing the sung line at its anchor (±1 line); any failing case
is fixed with a regression case in `lyricLayout.test.ts`.
**Constraints:** the lyrics glide rules in `apps/mobile/CLAUDE.md` (one glide, no per-line springs, opacity-only
highlight); `SynchronizedLyrics` stays the only owner of automatic lyric scrolling.

### 3. Virtualise Stream's home feed

`screens/StreamScreen.tsx` still renders every shelf inside a vertical `ScrollView` (~L633) and fetches an extra
YouTube Music home page straight away. Off-screen shelves stay mounted with their covers.

- [ ] Replace the vertical `ScrollView` with `FlashList` (already a dependency), one row per shelf; horizontal
      shelves stay as they are.
- [ ] Ask for the next YouTube Music home page only when the list nears its end, not at mount.
- [ ] Keep the feed cache behaviour (`services/stream/feedCache`: show cached at once, replace each half when
      fresh), pull-to-refresh, scroll-to-top on tab tap, and the search entry point.
- [ ] A test for the "load more near the end" decision (pure function).

**Done when:** mounted shelf count stays bounded while scrolling a long feed (log or test), no extra home-page
request before scrolling, nothing in the feed looks or behaves differently; on a device (if item 1 exists) Stream
scroll janky-frame % is equal or better than the baseline.
**Constraints:** same design, same order of shelves; scrolling lists clear both pills (~220pt); no live blur in
rows.

### 4. Cancel lyric lookups that are no longer needed

The cascade shares duplicate lookups but cannot cancel: no `AbortSignal` reaches the providers, so skipping fast
leaves the old songs' lookups running.

- [ ] Thread an `AbortSignal` from the caller through `EchoLyricsCascade` to every provider's
      `fetchWithTimeout` call (it already accepts `signal`).
- [ ] A song change aborts the previous song's lookup; a shared in-flight lookup is aborted only when no caller
      still wants it.
- [ ] Remember "no lyrics found" per song for a while (with an expiry), so a miss is not re-asked on every open;
      a provider error is not a miss.
- [ ] Tests: abort on song change, shared lookup survives one caller leaving, miss cached and expires, error not
      cached.

**Done when:** those tests pass; skipping five songs quickly leaves at most one cascade running (test with fake
providers, not a mock DB).
**Constraints:** every provider still returns null rather than throwing (rule 9); the lyrics picker
(`LyricsPicker`, every provider at once) keeps working; bump any cache key you change.

### 5. Graphics and memory budget, from the baseline

Only after item 1. Pick the costliest thing the baseline shows, not a guess.

- [ ] Candidates, in the plan's order: decoded cover sizes and bytes (`player/coverImages.ts`,
      `player/imageCache.ts`, six images by count, not bytes), full-screen blur layers in `AppleBackdrop`, Luvs
      retained lanes and warm players.
- [ ] Write the chosen target and the before numbers in the PR description first.

**Done when:** the chosen scenario's numbers improve against item 1's on the same device, with before/after
evidence committed; nothing looks different (the outgoing cover still dissolves; glows stay).
**Constraints:** keep the glow (owner); use `utils/visualBudget` for any frame cap or density, not new constants.

### 6. Download completion that survives a killed app

`workers/DownloadWorker.kt` can finish a file while no JavaScript is alive to add its library row, so a download
can be on disk but missing from the Library.

- [ ] Before notifying JavaScript, the worker writes a small completion record (song id, file paths, metadata)
      atomically, like `QueueSnapshot`.
- [ ] At start and on resume, JavaScript reads the records and adds each row idempotently (a second pass adds
      nothing), then deletes the record.
- [ ] Kotlin unit test for the record format; JS test against real SQLite (no mock DB) for idempotent reconcile.

**Done when:** killing the app between "file written" and "row added" (test the reconcile path directly) leaves
the song in the Library after the next start, exactly once; download state on every surface still comes from
`hooks/useDownloadState`.
**Constraints:** `MAX_CONCURRENT` stays 2; no change to the download queue's public shape.

### 7. Radio top-up and fresh stream links without JavaScript

Today the engine asks JavaScript for more songs (`onQueueLow` → `StreamService.extendRadio`) and for fresh links
(`playback/recovery.ts`). With the screen off and JavaScript asleep, a radio queue runs dry and an expired link
stops the music.

- [ ] **Owner decision first.** Write `RADIO-NATIVE-DESIGN.md`: where Kotlin gets recommendations and audio links
      (the existing API, or porting `recommend.ts` + `resolver.ts`), the queue-tag/generation checks, and any API
      contract change (propose it in `docs/api-contract.md` before coding, rule 1). Stop for approval.
- [ ] After approval: service-owned, cancellable coroutines; the engine refuses songs for a queue that was
      replaced (tag check, as today); never for repeat-one or Listen together (`shouldRefillQueue`).
- [ ] JVM tests for the refill and stale-tag decisions.

**Done when:** with the screen off for 30 minutes on a phone, a radio queue keeps refilling and an expired link
is refreshed without the app being opened (logcat evidence); all existing queue tests still pass.
**Constraints:** no provider secrets on the phone; no stream extraction in `ytmusic/`; one audio authority.

### 8. Media3 upgrade

Still on `androidx.media3` 1.3.1 (`android/app/build.gradle`). Needed before newer preload APIs.

- [ ] Upgrade all three artifacts together to the current stable release; read every release note in between for
      session and notification changes.
- [ ] Keep `addSession()` in `PlaybackService.onCreate`, `WAKE_MODE_NETWORK`/`LOCAL` switching, the stall
      watchdog, `QueueForwardingPlayer`, and the island's direct player use (`IslandPlayback`).

**Done when:** Gradle tests pass, the APK passes `mobile-launch-check.sh` and the player probe, and on a phone:
background playback for 10 minutes with the screen off, notification and lock-screen controls, Bluetooth skip,
and a seek in a streamed song (the 206 range rule) all work.
**Constraints:** its own PR with nothing else in it; patch version bump.

### 9. Native lyrics renderer (not now)

Phase 5. Large and risky. Start only after items 1 and 2, and only if the baseline shows lyrics as a real cost.

- [ ] **Owner decision:** go or no-go, with item 1's lyrics numbers.

**Done when (if approved):** a native view inside the RN shell with feature parity (line and letter highlight,
synced and plain, provider picker, text size, RTL, Reduce Motion, seek, manual follow, Connect remote clock) and
before/after frame traces on the M31 and a normal phone; the RN renderer stays as the fallback during the pilot.

### 10. YouTube video with lyrics, and Compose (do not build)

Phase 6 needs an **owner decision** between the official YouTube embed and an extractor feeding Media3; the
extractor conflicts with today's metadata-only `ytmusic/` rule. Phase 7 (Compose screens) is only to be
evaluated after item 9 ships with evidence. Neither is to be coded from this list.

---

## Checklist

- [ ] 1. Release baseline on a real phone
- [ ] 2. Lyrics geometry proven on a phone
- [ ] 3. Stream feed virtualised
- [ ] 4. Lyric lookups cancel, misses cached
- [ ] 5. Graphics/memory budget from the baseline
- [ ] 6. Download completion records
- [ ] 7. Native radio top-up and link refresh (design approved first)
- [ ] 8. Media3 upgrade
- [ ] 9. Native lyrics renderer (owner go/no-go)
- [ ] 10. YouTube video and Compose (owner decision; not built from this list)

Tick a box only when its "Done when" is met. Write device-only gaps next to the item rather than ticking it.
