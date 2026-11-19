# Phone performance baseline (LuvLyrics, Android)

How to measure whether the phone app got faster. Use this before and after any performance change.
Emulator numbers are not evidence: the emulator shares the host's CPU and GPU. Use a real phone, and label
emulator runs as emulator-only.

## What ships to make it fast

| Layer | What | Guard |
|---|---|---|
| React | React Compiler (`app.json` `experiments.reactCompiler`) memoizes components at build time. Components that break the Rules of React are skipped and behave as before. | `src/reactCompiler.test.ts` |
| ART | Baseline Profile `android/app/src/main/baseline-prof.txt`, installed on sideloaded phones by `androidx.profileinstaller`. The app, React Native, Expo modules and Reanimated/Gesture Handler/Screens are compiled ahead of time on first launch. | `src/baselineProfile.test.ts`, APK workflow step "Verify Baseline Profile is in the APK" |
| UI thread | Reanimated 4.1.7 with `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS` | `package.json` |
| Kotlin | Debug builds log main-thread disk and network work (`StrictMode` in `MainApplication`). Read `adb logcat -s StrictMode` while using a debug build. | — |

ART needs a moment to compile after first launch. To measure the profile's effect immediately, force it:
`adb shell cmd package compile -f -m speed-profile com.lyricflow.app`. To measure without it:
`adb shell cmd package compile -f -m verify com.lyricflow.app`.

## Run it

All scripts live in `apps/mobile/scripts/perf/`.

1. Build and install the release APK (the CI `LuvLyrics-apk` artifact is fine). No FPS HUD, nothing else
   building, the phone cool, on the same Wi-Fi each time.
2. Put 500 songs in the library once: `seed-library.sh <serial> <work-dir>` (needs `ffmpeg`).
3. Run three times per phone: `low-end-baseline.sh <serial> <out-dir> <label> 3`.
   `EMULATE_M31=1` sets an emulator to the Galaxy M31's 1080x2340 at 420 dpi, for rehearsal only.
4. Cold start: `adb shell am force-stop com.lyricflow.app && adb shell am start -W -n com.lyricflow.app/.MainActivity`
   and read `TotalTime`, ten times.
5. Save everything in `.planning/performance-kotlin/evidence/<date>-<device>/` with the build (version, commit,
   SHA256), the device, its refresh rate, battery/thermal state and network.

## Read it

- `summary.tsv`: one row per run and scenario (library scroll, Stream scroll, player open/close, lyrics on) with
  frames, janky %, and p50/p90/p99 frame time in ms.
- `tap-to-audible.tsv`: tap on a song to the first audible output, from the `PerfMarks` log lines, for Library
  and Search.
- `*.gfxinfo.txt`: the raw `dumpsys gfxinfo framestats` for a closer look; open a Perfetto trace when a scenario
  is janky to see which thread (JS, UI or RenderThread) missed the frame.

## Budgets

| Scenario | Galaxy M31 (slowest supported) | Normal phone |
|---|---|---|
| Cold start (`TotalTime`) | under 1.5 s | under 0.8 s |
| Library / Stream scroll | p90 under 16 ms, janky under 5% | p99 under 16 ms |
| Player open/close | janky under 5% | janky under 2% |
| Tap to audible, downloaded song | under 300 ms | under 200 ms |

Compare medians of three runs. A change counts as faster only if the median moves by more than the spread between
runs.
