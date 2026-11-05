# V6 implementation and release ledger

Updated 2026-11-06. Checkout: `C:\dev\allegra`, branch `feat/mobile-frontend-polish`.
Base: `1b72928`, matched freshly fetched `origin/main` before preparing the PR.
Target version: **1.37.1**. Publication is pending; a source version is not a shipped APK.

## Decisions and scope

The owner accepted all five recommended defaults and asked to finish coding, test, push and merge.
The local gallery/source replaces the canvas for this implementation; canvas republishing is waived.
The owner explicitly deferred physical-device checks while code preparation continues, and requested
GitHub Actions for APK creation. The pending polish and V6 source migration are combined in this release.

## In source

- Semantic colour, geometry, type and motion tokens in `allegraTheme.ts`; reusable text, buttons,
  chips, segmented controls, rows, collection cards, transport disc, screens and sheets in `src/ui`.
  UI primitives accept callbacks; application bindings stay outside the library.
- Static current-cover glow through `AppScreen`/`AppSafeArea`. No resting shader before playback.
- Five tabs: Stream, Luvs, Library, Search, You. Kotlin V6 tab bar plus React Native fallback.
  The flush shell uses cover-bitmap frost with reduced-transparency, Battery Saver and low-end fallbacks.
- Separate mini seek band, preview/thumb, unknown-duration state, accessible ten-second steps,
  track-change/loading cancellation and failed-seek rollback. Existing audio owners remain intact.
- Derived playback feedback: audible/loading/paused/error; stable spinner/retry disc and cover error details.
  Retry is passed from the playback owners, preserving Connect/LuvLink boundaries. No volume row.
- Library scope tabs, search, remembered sort, album grid, artist circles; playlist mosaic grid and
  large-text single-column layout. Playlist cover/meta/actions, shared normal song rows, edit mode,
  removal Undo and existing-membership ticks. Loading failures keep cached rows and expose Retry.
- Stream hierarchy: moods, six Jump back in shortcuts, four vertical Quick picks, one Made for you
  collection shelf with real mix pages/actions, artists and typed provider shelves.
- Compact artist/album compositions, shared screen typography, utility-screen glow, You groups.
  Luvs/DJ/Blend keep their functional interactions while sharing the V6 tokens/control library.
- Stream top-right LuvLyrics mark retained. About opens with Updates, then creator, links, feedback and
  privacy. WorkManager and Android still own download/install; the updater does not open a browser.
- Design source/generator/gallery regenerated: 21 boards, static audit passes. Representative HTML
  review from the foundation is design evidence, not proof of every runtime screen or state.
- README, mobile README, DESIGN.md, root/mobile CLAUDE.md and primitive maintenance rules updated.

The pending Metro Windows resolver and listenTracker reentrancy fixes have regression coverage and
are included as playback/build prerequisites. Queue-next helpers are consumed by the shared song actions.
The unrelated local Gradle tuning and unused build-tools devDependency/lockfile change remain unstaged.

## Verification

- `npm run mobile:check`: latest complete run passed **129 suites / 1,039 tests**, typecheck and lint
  with zero errors. Repeated after fixes to transport ownership, seeking and Undo. Local logs are ignored.
- `npm run security:secrets`: passed.
- `:app:compileDebugKotlin :app:testDebugUnitTest`: exit 0 using process-local JDK 21.
  This is compilation/JVM evidence, not an APK launch or device check. No APK was built locally.
- `python v5_build.py ../design-gallery`: 21 boards; `python v5_audit.py`: exit 0.
- Design guards ratchet down after migrations; shared primitives prohibit duplicate colours/type recipes.
  Contrast, target minima, shell geometry, state precedence, seek cancellation, native retry ownership
  and Undo ordering have automated checks.
- GitHub Actions now builds the APK and runs its emulator launch gate on pull requests. Only main may
  publish `apk-latest`, and publication depends on checks, build and launch passing.

## Pending evidence

- PR CI, APK build, emulator launch, merge and `apk-latest` publication: fill in from live GitHub results.
- Physical phone: playback invariants, sheet drag/keyboard, 360/393/430 widths, 200% text, TalkBack.
  No connected device was available. Do not promote compile/unit/HTML/emulator results to phone proof.
- Frame times, memory and playlist loading measurements. The suspected SQL/loading topology was not
  changed without measurements. No latency, frame-rate, audible-sync or performance target is claimed.
- Every-screen visual/interaction parity remains subject to emulator artifacts and physical review.
  Static audits cannot establish animation quality, computed target geometry or artwork contrast.

## Continuation

Fix CI failures on the same branch; merge only after all required checks including APK launch pass.
Verify the main release run, asset/version and updater manifest before calling 1.37.1 published.
Record exact commit/run/PR evidence here. Keep the three unrelated dirty local files intact.

## PR 58 launch-gate follow-up

PR: https://github.com/peterish8/allegra/pull/58. Initial head `5fda4d5`.
GitHub run `42116277462`: arm64 and x86_64 APK builds passed, as did root/mobile checks and Kotlin tests.
The first cold start reached About/Updates and the cover/lyrics checks passed. The second cold start
reached Stream but its header was above the viewport; the update button could not be found. The artifact
`second-no-about.png` and UI dump show a scrolled feed rather than a process or screen-layer crash.

Fix: keep the Stream title, Connect and LuvLyrics mark outside FlashList, and disable automatic visible-item
anchoring for asynchronously restored home sections. Add structural regression checks for both guarantees.
Version bumped to 1.37.1. The launch gate stays unchanged and must pass before merge.

Coverage follow-up: restored explicit React imports in four presentation files for the Jest classic-JSX
coverage transform. Runtime typechecking uses automatic JSX; the release gate also verifies coverage collection.

The external config-audit comment flags the existing signing-keystore environment binding. It is the
GitHub secret written to the signing file, not printed or embedded in frontend configuration; secret
scan passes. PR publication remains disabled, and main publication retains its build/check/launch gates.
The external missing-ECC-manifest warning does not change the app or its release gates.

Launch-fix validation: `npm run mobile:check` passed 130 suites / 1,041 tests, with no lint or
type errors and no coverage-collection failures. PR 58 will rerun the unchanged emulator gate on this fix.
