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
