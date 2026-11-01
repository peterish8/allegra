# Code quality pass and remaining roadmap code: plan

Date: 2026-11-01. Written for a coding agent picking this up cold. The owner asked for two things:

1. **Finish the remaining code work** on the roadmap: the failing phone smoke test, the rest of the native Android UI
   migration, the website's shared cache and server rendering, and the small tidy-ups.
   **Not in scope:** music files from the PC (desktop), YouTube video with lyrics, Compose screens.
2. **Bring the whole repository to one standard:** the Google TypeScript style, TypeScript best practices
   (discriminated unions, `unknown` over `any`, no unchecked `as`, validation at boundaries), and the "ponytail"
   rule (the simplest code that works; delete what is not needed). Big changes are allowed; behaviour must not change.

Skills to load before starting: `google-typescript-style`, `typescript-best-practices`, `ponytail` (and `ponytail-audit`
for phase 4). Read root `CLAUDE.md`, `apps/mobile/CLAUDE.md`, `docs/architecture.md` first. They win over this file
where they disagree.

## Status (end of 2026-11-01 session)

No phase of this plan is finished yet. That session went to two side requests instead:

- **Vercel Fluid CPU** (#54, merged): the catch-all page is static now (`force-static` +
  `generateStaticParams` from `paths`), so page views come from the CDN instead of a function render, and
  the MCP SDK loads on the first authorised `/api/mcp` call instead of every cold start (cold-start CPU
  about 1.5 s → 1.05 s, measured on an esbuild bundle of `api/index.ts`). Follow-ups are in Part 3.
- **unslop-ui polish** (#55 website + desktop, merged; #56 phone, open at the time of writing): the
  owner chose polish mode, keeping glass, glow and layouts. Report with before/after screenshots:
  https://claude.ai/artifact/W3g3argXnanxSYikXUkVCt. Leftovers are in Part 3.
- **Phase 5** was diagnosed but not fixed; the findings are under Phase 5 below.

Start the next session at Phase 5 with the starter prompt at the end of this file.

## Audit (2026-11-01, `main` at `73038c7`)

Counts are rough greps (`.ts`/`.tsx`, generated code excluded); use them to size and to track progress.

| Area | Files | Lines | `as` casts | `any` | Unbraced `if`/loops | `const f = (…) =>` | `type X = {` | `void x` | Files > 1000 lines |
|---|---|---|---|---|---|---|---|---|---|
| `apps/mobile/src` | 502 | 72.7k | 1,008 | 67 | 1,835 | 910 | 33 | 73 | 4 |
| `apps/web/src` | 237 | 37.7k | 499 | 3 | 1,358 | 54 | 14 | 232 | 3 |
| `apps/api/src` | 182 | 25.3k | 372 | 2 | 663 | 61 | 8 | 4 | 0 |
| `packages` | 85 | 14.3k | 214 | 0 | 518 | 52 | 1 | 30 | 2 |
| `convex` | 31 | 8.3k | 72 | 0 | 324 | 19 | 0 | 0 | 1 |

- Files over 1,000 lines: `apps/web/src/App.tsx` (2,398), `components/LyricsPanel.tsx` (1,167), `components/PlayerPanel.tsx`
  (1,106); `convex/connect.ts` (1,442); `packages/connect/src/connectSession.ts` (1,078, plus its 1,216-line test);
  `apps/mobile/src/components/MiniPlayer.tsx` (1,107), `screens/PlaylistDetailScreen.tsx` (1,104),
  `screens/NowPlayingScreen.tsx` (1,017), `components/SynchronizedLyrics.tsx` (1,003).
- `console.log` without a `__DEV__` guard: 12 lines in `apps/mobile/src` (repo rule 10 bans them in production paths).
- Lint setups differ: web `eslint.config.js` (typescript-eslint recommended + `consistent-type-imports`), api its own,
  mobile `.eslintrc.js` (`@react-native` preset). None enforces `curly`, `eqeqeq` or interface-over-type.
- tsconfig: api has `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; web and root `strict` only;
  mobile `strict`.
- Kotlin (`apps/mobile/android`) and Rust (`apps/desktop`) are out of the TypeScript rules; leave their style alone.

## Rules for every phase

- **One PR per phase per app** (`chore/style-…`, `refactor/…`, `fix/…`, `feat/…`), squash-merged, from a branch off
  `main`. Never commit to `main`.
- **Style and refactor phases change no behaviour.** Tests are the proof: every check below exits 0 before a PR, and no
  test is edited to make it pass except to follow a rename.
- Checks: root `npm run typecheck`, `npm run lint`, `npm test`; in `apps/mobile` `npm run ci`; Kotlin changes
  `cd apps/mobile/android && gradlew.bat :app:testDebugUnitTest`. CI runs all of these, including the Kotlin tests.
- **Version bumps:** a change under `apps/mobile/`, `packages/` or `convex/_generated/` bumps `expo.version` in
  `apps/mobile/app.json` (patch for style or fixes, minor for features); a change under `apps/desktop/` bumps
  `apps/desktop/Cargo.toml`.
- **Never** touch `convex/_generated`, generated Android files, or `apps/mobile/android/app/src/main/java/expo/modules/
  ExpoModulesPackageList.kt` except to add a module. After editing `packages/shared`, run `npm run sync:shared`.
- **Don't break** the API contract (`docs/api-contract.md`), the three playback invariants, the byte-range rule,
  worklet safety (`src/workletSafety.test.ts`), or motion rules (transform and opacity only, token durations).
- Conventional commits, no AI attribution lines. Edit with the editor, not sed or python rewrites (owner rule).
- **Worktrees:** if one is used, never `git worktree remove` one whose `node_modules` is a junction to the main
  checkout. Remove the junction first (`cmd /c rmdir <path>`). That exact removal deleted the main checkout's files
  once (see the memory note "Worktree junction gotchas").
- Tick a box only when its done-when is met. Note any gap that needs a phone next to the box instead.

---

## Part 1: style and type quality, whole repo

### Phase 0: one lint rule set that enforces what tools can

Mechanical first, so later phases are small. Add the same rules to all three lint configs (web, api, mobile), and to a
config covering `packages/` and `convex/` if none does:

- `curly: ['error', 'all']`, `eqeqeq: ['error', 'smart']`, `no-var`, `prefer-const`, `prefer-arrow-callback`,
  `quotes: ['error', 'single', { avoidEscape: true }]` (mobile: keep its preset's quote rule if it already matches).
- `@typescript-eslint/consistent-type-definitions: ['error', 'interface']`,
  `@typescript-eslint/consistent-type-imports`, `@typescript-eslint/array-type: ['error', { default: 'array-simple' }]`,
  `@typescript-eslint/no-namespace`, `@typescript-eslint/ban-ts-comment`, `@typescript-eslint/no-explicit-any: 'error'`.
- `@typescript-eslint/no-non-null-assertion` and `@typescript-eslint/consistent-type-assertions` at `warn` for now;
  they become `error` per area as phase 1 clears them.

Then `eslint --fix` per app, one PR each (mobile, web, api, packages + convex).

- [ ] mobile · [ ] web · [ ] api · [ ] packages + convex

**Done when:** the rules are on in every config, autofix is applied, all checks pass, and no behaviour changed (no test
edits). Expect the unbraced-`if` and `type X = {` counts to reach 0.

### Phase 1: `any` and `as` casts (about 2,100)

Work boundary files first (network responses, native modules, storage reads, `JSON.parse`, event payloads), then the
rest.

- Each `any` becomes a narrow interface for the fields used, or `unknown` narrowed before use (rule 8). The 67 in
  mobile include `getNativeModule<any>(…)`: give each native module a typed interface (as `NativeDynamicIsland.ts` does).
- Each `as` becomes validation, a type guard that really checks, `satisfies`, or a correct declaration. Where one must
  stay (a proven invariant, a test fixture), add a one-line comment saying why.
- Then raise `consistent-type-assertions` and `no-non-null-assertion` to `error` for that area.

- [ ] packages + convex · [ ] api · [ ] web · [ ] mobile (split by folder: `services/`, `store/`, `components/`, `screens/`)

**Done when:** `any` is 0 outside documented third-party shims; every remaining `as` has a comment; the two rules are
`error`; checks pass.

### Phase 2: function and module shape

- Named `const f = (…) => …` at module level becomes `function f(…)` (about 1,100). Arrows stay for callbacks and
  short closures. React components stay as they are when the file's pattern is consistent; don't churn a file for this
  alone.
- Object shapes become `interface`; unions and mapped types stay `type`. Exports: only the intended API, documented
  with a JSDoc line each.
- Replace `void promise` (339) with `promise.catch(…)` that does something meaningful, or a named fire-and-forget
  helper where one already exists (`playback/nativeQueue.ts` `fire`).
- Remove the 12 unguarded `console.log` lines in mobile (use `diag` or a `__DEV__` guard).

- [ ] packages + convex · [ ] api · [ ] web · [ ] mobile

**Done when:** the patterns are gone or justified; checks pass.

### Phase 3: break up the nine files over 1,000 lines

One PR per file. Extract cohesive pieces (hooks, pure helpers, sub-components) and keep the public surface the same:

- [ ] `apps/web/src/App.tsx` (2,398): routes, the player orchestration, and the Connect wiring each move to their own
  module; App only composes.
- [ ] `apps/web/src/components/LyricsPanel.tsx`, `PlayerPanel.tsx`.
- [ ] `convex/connect.ts` (1,442): split by concern (sessions, commands, presence), the same exported functions.
- [ ] `packages/connect/src/connectSession.ts` (and split its test file to match).
- [ ] `apps/mobile/src/components/MiniPlayer.tsx`, `screens/PlaylistDetailScreen.tsx`, `screens/NowPlayingScreen.tsx`,
  `components/SynchronizedLyrics.tsx`. Mind the load-ownership and playback invariants in `apps/mobile/CLAUDE.md`.

**Done when:** each file is under 1,000 lines with no behaviour change; checks pass; for mobile files, the player
probe and launch check in CI are no worse.

### Phase 4: ponytail audit and deletion

Run `ponytail-audit` per app. Delete dead code, unused exports, near-duplicate helpers (reuse the canonical one),
wrappers that add nothing, config for values that never change. Each deletion is its own small commit in one PR per
app, with the reason in the message.

- [ ] mobile · [ ] web · [ ] api · [ ] packages + convex

**Done when:** the audit list is worked through (or each skipped item has its reason in the PR); checks pass.

---

## Part 2: remaining roadmap code

### Phase 5: the failing phone smoke test (do this first)

`mobile-smoke.yml`'s player probe (`.github/scripts/mobile-player-probe.sh`) has failed on every `main` build since
2026-10-21:

- **C rounds 2–5:** `controls missing: Previous Next Play/Pause (app nodes on screen: 0)`. Zero app nodes means the
  app is not on screen at all. Lead: in round 2, `KEYCODE_BACK` exits the app instead of closing the player (or the
  native Now Playing views do not expose the content descriptions the probe looks for), so the pill tap misses. Check
  `navigation/playerBack.ts` (#35) and the native transport views' accessibility names (`Previous`, `Next`,
  `Play`/`Pause`).
- **D:** `KEYCODE_MEDIA_NEXT did not change the song` with the screen off. Could be real: check that media-button
  events reach `QueueForwardingPlayer` with the new native views and Media3 1.11.1.

**Findings so far (2026-11-01, run 41284061659, artifacts via `gh run download`):**

- The failure starts before the probe. In the main smoke walk, "closing the player" (`KEYCODE_BACK`) leaves the
  pill on screen (`after-close.png`), and three seconds after "reopening from the pill" the screen is the launcher
  (`player-reopened.png`).
- In the probe's section C, round 1 is a **false pass**: `assert_controls` only greps for `Previous`, `Next` and
  `Play`/`Pause`, and the mini pill exposes all three ("Now playing: X. Open player", then Previous, Pause, Next).
  The logcat shows `[diag:player-back] consume 1` → `unregister 1 active` on BACK, then **no** `[diag:player]
  background …` line and **no** `register 2` after the pill tap: Now Playing never mounted again. Round 2's BACK
  then logs `no focused handler`, Android finishes `MainActivity`, and every later check sees 0 app nodes.
- So the bug to find: after a hardware-back close (`handlePlayerBack` → `animateClose` → `finishClose` →
  `setHoldRoute(false)` → `safeGoBack`), a pill tap (`MiniPlayer.openNowPlaying` → `openPlayerSheet`) does not
  navigate to `NowPlaying`. Suspects: `openPlayerSheet`'s `getCurrentRoute()?.name === 'NowPlaying'` guard seeing a
  route that is still in the state, `usePreventRemove(holdRoute, handleBack)` blocking the pop when `goBack` runs
  in the same commit that clears `holdRoute`, or the tap not reaching the pill's press handler. On CI's emulator
  (fast, Reduce Motion on) the close finished 60 ms after BACK; on a local Android 36 emulator running the arm64
  APK through translation it took 14 s and the pill tap **did** reopen the player (`register 2`), so timing
  matters. Also harden the probe: assert Now Playing mounted (a control only it has), not just the transport.
- **D** (`KEYCODE_MEDIA_NEXT` did not change the song) ran after the activity was gone; re-check it once C passes
  before treating it as a separate bug.

**Local emulator notes (Windows):**

- An AVD was made by hand (no `avdmanager`): `~/.android/avd/probe.avd/config.ini`,
  `system-images/android-36/google_apis_playstore/x86_64`. WHPX acceleration works.
- Run the probe from Git Bash with `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'` and platform-tools on `PATH`.
  Without them Git Bash rewrites `/sdcard/ui.xml` to `C:/Program Files/Git/sdcard/ui.xml` and every
  `uiautomator dump` "fails".
- The `apk-latest` APK is arm64 only and crawls under translation. Build x86_64 like CI does:
  `cd apps/mobile/android && ./gradlew.bat assembleRelease --no-daemon -PreactNativeArchitectures=x86_64`
  (`android/app/debug.keystore` already exists locally). Don't switch branches while it builds.
- Never `taskkill //IM timeout.exe`: it took the emulator down with it.

- [ ] Reproduce on an emulator (`.github/scripts/mobile-player-probe.sh <apk> <out-dir>`), fix the cause (the app's,
  not the probe's, unless the probe looks for the wrong thing), add a regression test where the logic is testable.

**Done when:** the Mobile smoke test is green on `main`.

### Phase 6: the rest of the native Android UI migration

Continue `.planning/performance-kotlin/HANDOFF-ANDROID-NATIVE-UI.md` exactly as its "Remaining screens" and "Pattern for
interactive slices" say: one vertical slice per PR, the React Native component kept as the fallback, a JVM-tested
geometry/model file, a payload builder with a Jest test, registered in `ExpoModulesPackageList.kt`, a version bump.

- [ ] Now Playing title and artist row
- [ ] Gestures and the player sheet
- [ ] The remaining Now Playing controls
- [ ] Stream screen
- [ ] Luvs screen
- [ ] More screen

**Done when (each):** built, automated checks pass, and the handoff's "Needs a device check" list is written for the
owner. Never write "verified" without a device.

### Phase 7: website items from `.planning/ROADMAP.md` ("Next")

- [ ] **Shared cache.** Each Vercel instance keeps its own memory cache, so a cold start re-fetches search and lyrics.
  `apps/api/src/lib/cache.ts` already has `CacheStore`, `MemoryCacheStore` and a `LayeredCacheStore`: first check
  what `createApp` actually wires (the 2026-10-04 master plan warns an unused layered cache may look active), then
  add a Convex-backed store as the second layer behind memory. No contract change. Done when a test shows a second instance (a fresh `CacheStore`)
  reads what the first wrote, and providers' TTLs are unchanged.
- [ ] **Server-rendered content.** The shell is client-only (`ssr: false`), so `/artist/x` has no HTML for crawlers or
  first paint. Render the static half of the artist, album and playlist pages on the server (App Router server
  components), keep the player and the single `<audio>` element client-side, and keep the `/api` rewrite order in
  `vercel.json`. Done when those pages return their title and track list in the HTML (`curl`), playback still
  survives navigation, and `vercel build` passes.

### Phase 8: tidy-ups

- [ ] Media3 `DataSourceBitmapLoader` constructor (deprecated, five places: `island/IslandArt.kt`,
  `island/IslandThumbs.kt`, `views/CoverArt.kt`, `views/NativeAppleBackdropView.kt`, `views/NativeFlowGlowView.kt`)
  moves to its builder.
- [ ] Lint warnings to zero (most are `no-void` and `react-hooks/exhaustive-deps`; fix the cause, don't silence).

---

---

## Part 3: follow-ups from the 2026-11-01 session

### Vercel Fluid CPU (after #54)

Context: Hobby plan, so `vercel usage` has no billing data and request logs only reach back 12 hours
(`npx vercel logs requests -e production --since 11h -n 10000 --json`). Traffic was about 75 requests an hour;
the cost is per request, mostly cold starts.

- [ ] After a day of #54 in production, compare Active CPU in the dashboard (Observability → Functions) with the
  week before, and confirm page routes no longer show function invocations.
- [ ] Prove an authorised `POST /api/mcp` still works in production (the SDK is now a dynamic import; only the
  unit tests cover it).
- [ ] Drop `jsonwebtoken` for `jose`, which is already loaded (about 100 ms of cold-start CPU each). Touches guest
  tokens (`auth/verifier.ts`) and OAuth tokens (`oauth/tokens.ts`); keep HS256 and every claim identical.
- [ ] Public reads (lyrics, search, artwork) can't be CDN-cached while clients send `Authorization`: Vercel never
  caches those requests. Send no token on public GETs from web and phone, then add `s-maxage` +
  `stale-while-revalidate` to those routes (`lyrics/verified` has only `max-age=60` today).
- [ ] Preview deployments have no `JWT_SECRET`, so every preview's API returns 500 (`loadConfig`). Add a preview
  value in Vercel so PR previews can test the API.
- Phase 7's shared cache cuts provider refetches after cold starts; do it as planned.

### unslop-ui leftovers (after #55 / #56)

The skill is installed at `~/.claude/skills/unslop-ui` (renamed so it doesn't replace the writing skill
`unslop`). Direction recorded in memory: polish mode, keep glass and glow.

- [ ] Merge #56 if it isn't merged yet (phone, 1.35.3).
- [ ] Phone before/after screenshots for the report (About, Artist, LuvLink panel, DJ current track); needs the
  x86_64 build above, `apk-latest` from before #56 as "before".
- [ ] Check the website at 768 and 1920 wide (only 1440 and 390 were captured).
- [ ] Suggestions the owner hasn't approved yet: search palette placeholder "Search songs, artists…" → "Search";
  the Library empty state's ✦ glyph → a heart; the two pink vertical lines on the onboarding screen (in both
  before and after).
- Dead CSS found (`.hero-feature`, `.feature-readout`, their `stage-breathe` / `signal-line` loops): delete in
  Phase 4.

## Order and parallel work

1. **Phase 5 first:** a red smoke test hides every regression the later phases could cause.
2. **Phase 0 next, one app at a time:** it touches every file, so nothing else should be open on that app meanwhile.
3. **Phases 1–4 per app.** Different apps can run in parallel (separate agents, separate branches); the same app
   cannot.
4. **Phases 6, 7 and 8** are independent of each other and of other apps' style work. Phase 6 must not run while
   phase 0–4 is open on `apps/mobile`.

## Checklist

- [ ] 5. Smoke test green
- [ ] 0. Lint rules on and autofixed (mobile, web, api, packages + convex)
- [ ] 1. `any` and `as` cleared
- [ ] 2. Function and module shape
- [ ] 3. No file over 1,000 lines
- [ ] 4. Ponytail audit worked through
- [ ] 6. Native UI slices (six)
- [ ] 7. Shared cache · Server-rendered pages
- [ ] 8. Media3 builder · zero lint warnings
- [ ] Part 3. Vercel CPU follow-ups · unslop-ui leftovers

## Starter prompt for the next session

Paste this into a fresh Claude Code session in `C:\dev\allegra`:

```text
Repo: C:\dev\allegra (Windows). Read CLAUDE.md, apps/mobile/CLAUDE.md, docs/architecture.md, then
.planning/CODE-QUALITY-AND-ROADMAP-PLAN.md completely, including "Status", the Phase 5 findings and Part 3.
Load skills google-typescript-style, typescript-best-practices, ponytail (ponytail-audit for phase 4).

Continue the plan in its stated order: phase 5 (smoke test) first, using the findings already written under
Phase 5 (start from the "no register 2 after the pill tap" lead; build the x86_64 APK and use the local AVD
notes there). Then phase 0 per app, then phases 1-4 per app, then 6, 7, 8, then Part 3. One PR per phase per
app, branched from main, squash-merged once CI is green. Style/refactor phases change no behaviour: no test
edits except renames. Before each PR: root npm run typecheck, npm run lint, npm test; apps/mobile npm run ci;
Kotlin changes gradlew.bat :app:testDebugUnitTest. Bump apps/mobile/app.json expo.version for any
APK-reaching change. Conventional commits, no AI attribution. Edit with the editor, never sed/python rewrites.
Phase 7's server-rendered pages must keep the catch-all page static (#54 made it force-static for Vercel CPU).

GITHUB_TOKEN in this machine's environment is invalid: run git push and gh with `env -u GITHUB_TOKEN` and
`-c credential.helper= -c "credential.helper=!gh auth git-credential"`. Never `git worktree remove` a worktree
whose node_modules is a junction; rmdir the junction first.

Tick each checklist box in the plan only when its done-when is met; write device-only gaps next to it.
Report per PR: link, files, checks run with results, what's unverified.
```
