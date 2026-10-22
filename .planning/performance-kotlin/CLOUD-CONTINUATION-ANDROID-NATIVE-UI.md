# Allegra Android UI migration — cloud continuation handoff

Updated: 2026-10-22

## Checkout and commits

- Repository: `https://github.com/peterish8/allegra` (`origin`). Work only on `perf/mobile-player-responsiveness`.
- Checkout: `/workspace/allegra`; current branch tip before this handoff edit: `9385c6d feat(mobile): migrate Android Apple backdrop`.
- The remote-tracking branch was `b769904` before this session. Fetching the target branch returned HTTP 503 from GitHub's proxy; retry before assuming the remote tip is current.
- Local commits created in this session:
  - `7e17262 test(mobile): mock catalog recommendations in stream tests` — prevents the StreamService Jest test from making a real catalog request.
  - `9385c6d feat(mobile): migrate Android Apple backdrop` — Slice 16 renderer, version bump to 1.30.0, tests and relevant handoff/architecture updates.
- No PR was opened. Push only to `origin/perf/mobile-player-responsiveness`; do not open a PR, merge, or push elsewhere without a new instruction.

## What was checked

- Read `CLAUDE.md`, `apps/mobile/CLAUDE.md`, `HANDOFF-ANDROID-NATIVE-UI.md`, and this continuation file.
- `/workspace/.android-sdk/platform-tools/adb devices -l` returned only `List of devices attached`. No Android phone or emulator is available in this cloud checkout. Slice 7's queue check remains first, including short horizontal and vertical drags around the 1 dp handle threshold.
- `cd apps/mobile && npm run typecheck`: passed (`tsc --noEmit`).
- `cd apps/mobile && npm run lint`: passed with 0 errors and 78 warnings.
- `cd apps/mobile && npm test -- --runInBand`: passed, 113 suites and 926 tests. Jest reported an open-handle warning after the passing run.
- Focused backdrop props and native-module registration tests: 2 suites, 5 tests passed.
- Standalone Kotlin compiler check of `AppleBackdropGeometry.kt`: passed; all 9 geometry assertions passed. This does not compile the Android Expo view or run Gradle unit tests.
- `:app:compileDebugKotlin :app:testDebugUnitTest`: failed before Kotlin compilation during dependency resolution. Google Maven and `plugins.gradle.org` returned HTTP 503 for Android Gradle Plugin transitives (48 additional dependency failures reported).
- `:app:assembleDebug`: also failed before compilation during dependency resolution with HTTP 503 responses. No APK was built.
- `git diff --check`: passed before the Slice 16 commit.

## Slice 16 now in the branch

`NativeAppleBackdropView` and `NativeAppleBackdropModule` draw Android's Apple-style Now Playing room and hero. They use Media3's existing bitmap loader with a 2048 px cap, byte-bounded decoded-art and reduced-room caches, a cached blur, the 65% sharp hero and dissolve, cover/hero transitions, and the inverse mask over canvas video. Reanimated supplies horizontal cover shift on the UI thread. The view does not own playback, routing, lyrics, or gestures. iOS and missing-module builds retain the Skia renderer. `apps/mobile/app.json` is 1.30.0.

The Slice 16 Android compilation, APK, visual parity, accessibility, memory behavior, and frame pacing are not verified. The exact device checklist is in `HANDOFF-ANDROID-NATIVE-UI.md`, section 16. No performance improvement is claimed.

## Resume in this order

1. Inspect `git status --short --branch`, `git log -5 --oneline`, and `git remote -v`; preserve the existing commits and files. Fetch `origin/perf/mobile-player-responsiveness` when the proxy responds.
2. Finish Slice 7's device check first, including short horizontal and vertical handle drags around the 1 dp threshold, then the rest of its queue parity checklist. If no device is available, keep it explicitly pending.
3. Run `:app:compileDebugKotlin :app:testDebugUnitTest` and `:app:assembleDebug` when Google Maven and the Gradle Plugin Portal recover. Do not mark the Android compile, unit tests, or APK as passing until their full tasks succeed.
4. Check Slice 16 on an Android device using section 16 of the main handoff.
5. Continue one vertical slice at a time through the remaining Now Playing title/artist, gestures and sheet, controls, then Stream, Library, Luvs and More. Keep JavaScript routing/playback ownership and iOS/missing-module fallbacks unless an approved slice changes them. Bump `expo.version` for every APK-reaching change and add a specific device checklist.
6. Make small conventional commits with no AI attribution footer. Push only to `origin/perf/mobile-player-responsiveness`; no PR or merge without the user's instruction.

## Environment notes

- Dependencies are installed with `cd apps/mobile && npm ci --ignore-scripts`; use a writable cache such as `/tmp/allegra-npm-cache`.
- JDK 17.0.20.1+1, Gradle 8.14.3, Android SDK 36, build tools 36.0.0, platform-tools, and NDK 27.1.12297006 are available under `/workspace`.
- Set `ANDROID_HOME` and `ANDROID_SDK_ROOT` to `/workspace/.android-sdk`, `ANDROID_USER_HOME=/tmp/allegra-android-user` (do not also set `ANDROID_SDK_HOME`), and `GRADLE_USER_HOME` to a writable directory. The system Java trust store at `/etc/ssl/certs/java/cacerts` is needed for the proxy CA. Do not disable TLS checks.
- Gradle and GitHub requests have returned HTTP 503 from the proxy in this session. These are external service failures, not test failures; retry when the repositories recover.
