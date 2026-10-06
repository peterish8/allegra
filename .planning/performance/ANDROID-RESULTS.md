# Android search-to-play performance checkpoint

Updated: 2026-10-06

## Status

Android measurement instrumentation and focused tests are implemented. No Android search/play timing has been collected, and no performance improvement is claimed. AVD boot is verified, but an existing `com.lyricflow.app` install is present; its user data was not inspected or opened. A fresh measurement APK has not been built or installed.

## Implemented Android paths

- `apps/mobile/src/services/performanceTrace.ts` — opt-in Android adapter for separate `android.search.local` and `android.search.online` generations. The explicit `EXPO_PUBLIC_PERF_TRACE=1` flag enables a release-capable local diagnostic bundle; normal builds omit the flag and stay disabled. In an enabled bundle, `globalThis.allegraPerformanceTrace.snapshot()`, `clear()`, and `dispose()` expose only the bounded shared trace buffer. The shared helper at `packages/shared/performanceTrace.ts` is owned by the web worker.
- `apps/mobile/src/screens/SearchScreen.tsx` — records local index lookup and online song/artist lookup independently. The online path still awaits the same `Promise.all` before publishing song and artist results together. Lookup `durationMs` is measured around each underlying promise; event `elapsedMs` remains relative to its search attempt. Existing sequence guards and 120 ms / 350 ms debounce behavior remain.
- `apps/mobile/src/contexts/PlayerContext.tsx` — observes the existing Android Media3 status callback and error callback only when opted in. A playback observation requires the selected song identity plus two qualifying native status receipts whose position advances while `isPlaying`, `playWhenReady`, non-buffering, and non-suppressed. No Kotlin/native code or additional listener/polling loop was added.
- `apps/mobile/src/services/performanceTrace.test.ts` — verifies lookup duration separation, playback status criteria and private-ID omission, and disabled trace clock behavior.

Trace output contains generated attempt IDs/generations, platform, event, elapsed/duration/count/outcome, and local/online scenario only. It does not include search text, song/artist IDs, URLs, accounts, or provider metadata. The buffer is capped by the shared helper. There is no interval logging, persistence, or network export.

## Verification completed

| Check | Command and working directory | Result | Raw output |
|---|---|---|---|
| Focused Android/player tests | `npm.cmd test -- --runInBand src/services/performanceTrace.test.ts src/contexts/PlayerContext.test.ts` from `apps/mobile` | Exit 0; 2 suites, 15 tests passed; 22.797 s | Command output was returned directly; no separate log file was written. |
| Focused Android lint | `npx.cmd eslint src/services/performanceTrace.ts src/services/performanceTrace.test.ts src/screens/SearchScreen.tsx src/contexts/PlayerContext.tsx` from `apps/mobile` | Exit 0; no diagnostics | Command output was returned directly; no separate log file was written. |
| Mobile TypeScript | `npm.cmd run typecheck` from `apps/mobile` | Initial exit 1. It reported an Android declaration-order error in `SearchScreen.tsx` and two missing concurrent LuvLink modules. The declaration-order issue was moved/fixed and no longer appears in the full gate below. | Direct command output; no separate log file. |
| Full mobile gate | `npm.cmd run mobile:check` from the repository root | Exit 1. Secret scan passed. Full mobile ESLint had 0 errors and 39 warnings. TypeScript failed on two absent LuvLink imports and three shared Convex union-narrowing errors. The chained `test:ci` stage did not run. A later file check found both LuvLink component targets now present, but the gate has not been rerun. | Direct command output; no separate log file. The run echoed the exact `apps/mobile` lint/typecheck/test commands. |

The first typecheck also emitted `SearchScreen.tsx(272,15): TS2448: Block-scoped variable 'onlineFresh' used before its declaration`. The online presentation effect was moved below the `onlineFresh` memo; the full mobile gate no longer reports it. The two absent module errors remain `NowPlayingScreen.tsx(47,26)` -> `../components/luvLink/LuvLinkPanel` and `SettingsScreen.tsx(38,29)` -> `../components/settings/LuvLinkSettings`; both target files were absent when checked. The gate also reports shared `convex/connect.ts` errors at lines 1292 and 1307: property `code` (twice) and property `error` are not narrowed from `{ ok: true } | { error?: string; ok: false; code: string }`. These files are outside Android ownership and were not edited.

## Android SDK and emulator evidence

- Android SDK: `C:\Users\nithy\AppData\Local\Android\Sdk`.
- ADB: `C:\Users\nithy\AppData\Local\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe`.
- Emulator binary: `C:\Users\nithy\AppData\Local\Android\Sdk\emulator\emulator.exe`.
- Installed AVD: `Pixel_9_Pro`, Android 37.1 Google Play x86_64 image, 4 virtual cores, 2048 MiB configured RAM, 256 MiB VM heap. SDK platforms through Android 37.0 and build-tools through 36.0.0 are installed; Gradle 8.14.3 distribution is cached.
- ADB initially listed no physical device. No phone was connected during this work.
- AVD launch command: `Start-Process -FilePath <emulator.exe> -ArgumentList @('-avd','Pixel_9_Pro','-no-snapshot-save','-no-boot-anim') -WindowStyle Hidden`.
- Verified boot output: `emulator-5554 device product:sdk_gphone16k_x86_64 model:sdk_gphone16k_x86_64 device:emu64xa16k transport_id:2`; `sys.boot_completed=1`, Android release `17`, SDK `37`.
- ADB `pm path com.lyricflow.app` returned an installed base APK. No UI, app data, account state, or private logs were opened. Because installing an update under the existing package could affect its preserved user data, the benchmark APK has not been installed.
- The emulator process was started by this task with `Start-Process`. After interruption, process inspection found `emulator-5554` still online with `emulator.exe` PID 40788 and `qemu-system-x86_64` PID 25956; QEMU working set had grown to about 4.96 GB. It was stopped with `adb -s emulator-5554 emu kill`. ADB then listed no devices and QEMU was gone. Two small `emulator.exe` wrapper processes (PIDs 23480 and 46280) self-exited before a targeted cleanup could find them. After shutdown, ADB listed no devices and no QEMU remained. A later resumed check again found ADB empty and no emulator/qemu process; verify before any future use.
- At inventory time, host free RAM was approximately 3.8 GiB and C: free space approximately 54.8 GiB. Emulator RAM use makes concurrent Gradle/test work memory-sensitive.
- `java` on PATH resolves to an Oracle Java 8 shim. JDK 21 is installed at `C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot`; Gradle builds should use a per-command `JAVA_HOME`/PATH override to JDK 21. No Android Gradle build was attempted.
- Existing ignored build artifacts predate this task: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` (55,072,748 bytes) and `.../release/app-release.apk` (32,180,316 bytes). Neither artifact contains this measurement change and neither was used as device evidence.

## Measurement boundary and baseline

No cold or warm local/online sample was collected. Counts are **n=0** for each scenario; median, IQR, range, and failure rate are unavailable. The local API health probe to `http://localhost:8080/api/health` timed out; the web worker also reported `localhost:8080` and `localhost:5173` down. No production account/provider was used and no external or paid search load was sent.

`results.presented` is a JavaScript `requestAnimationFrame` scheduling proxy after React commit, not proof of a displayed native frame. `playback.observed` is the JS receipt time for the second matching native status sample with an advancing position. Native status contains no explicit prepared/ready marker or calibrated native monotonic timestamp. JS and native clock origins must not be subtracted; status receipt does not prove first audible samples. Physical-device audio, refresh, battery, and other device acceptance remain pending. Emulator results, if collected, must be labelled emulator-only.

## Next steps

1. Inspect whether the task-started `emulator` / `qemu-system-x86_64` process remains online; stop it if still running while Android app work is blocked.
2. Coordinate with the web worker's active production build before rerunning `npm.cmd run mobile:check`. Both previously absent LuvLink files now exist, but confirm their imports resolve. Do not edit LuvLink- or Convex-owned files; the last gate still reported three errors in shared `convex/connect.ts`.
3. Once the full mobile gate passes, coordinate any later root gate with the web worker; do not overlap Convex/root gates.
4. Before any install, use only an isolated, fresh test profile/package or another safe no-account path. Do not inspect or clear the existing `com.lyricflow.app` user's private data. If isolation is impractical, report the install blocker and do not install.
5. If source bundling and safe isolation are available, set `EXPO_PUBLIC_PERF_TRACE=1` only for a local release-equivalent diagnostic build and use a per-command JDK 21 override. A normal release with no flag stays disabled. Do not alter `app.json` version or create/publish a release.
6. Collect local downloaded and online-stream runs separately. For online, use the same provider-qualified recording as web, resolve it only against the local development service, run serial requests, and capture cold/warm counts, medians, IQRs, ranges, failures, build/device/network/cache conditions. Save raw bounded trace exports locally without account or personal metadata.
7. Add an `ANDROID-OPTIMIZATION-PLAN.md` only if a measured artist-result wait is significant; describe independently publishing lanes and verification without implementing the behavior change until the later user approval.

## No-claims

This checkpoint establishes instrumentation behavior and an emulator boot only. It does not establish search latency, playback speed, audible start time, a production performance regression, or any improvement. No behavior optimization has been implemented.

## Resume checkpoint — 2026-10-06

This update replaces stale "current state" statements above where they conflict. At resume, `adb devices -l` returned no devices; `Get-Process -Name emulator,qemu-system-x86_64,java` returned no matching processes. No Android build, install, or mobile gate is running. Many Node processes are present, but ownership was not inferred from process names alone; coordinate before a resource-heavy gate. The web worker owns one sanitized local `/api/search` diagnostic now and has been told there is no Android build/gate contention.

Both previously missing LuvLink component targets are now present in the worktree (`apps/mobile/src/components/luvLink/LuvLinkPanel.tsx` and `apps/mobile/src/components/settings/LuvLinkSettings.tsx`). They are concurrent work and remain untouched by this Android slice. The last recorded `mobile:check` still failed on shared `convex/connect.ts` union-narrowing diagnostics (properties `code` and `error`) after secret scan passed and ESLint reported 0 errors / 39 warnings. That gate has not been rerun after the LuvLink files appeared. `test:ci` was skipped by that gate. The independent combined Android/player Jest run is recorded above as 15/15 passing; the earlier focused 3/3 run is superseded by that broader focused run.

The Android adapter now also exposes opt-in local `dumpToLog()` for an explicit user-triggered bounded export, with record markers `[ALLEGRA_PERF_TRACE_BEGIN]`, `[ALLEGRA_PERF_TRACE_RECORD]`, `[ALLEGRA_PERF_TRACE_END]`; SearchScreen presents Clear / Dump / Cancel actions only in the opt-in build. `clear()` closes current local/online attempts as aborted before clearing so the next sample starts clean. No timer, persistence, or network export is introduced. A local Python ADB extractor is being added at `apps/mobile/scripts/perf/capture_android_trace.py`; it is not yet verified and no device output exists. These latest changes still need focused test/lint/parser verification.

The Python extractor is intended to read only the app PID's `ReactNativeJS` logcat records, select the last complete marked snapshot, enforce the shared record-field allowlist and 250-record cap, and write only to the explicit output path. It does not clear logcat or persist full/unfiltered logs. This is a local parser/capture utility, not evidence that the app ran.

Current artifact inventory: no Android raw trace output, no Android search/play samples, and no APK produced by this slice. The emulator is stopped; the physical-device acceptance gap remains. Existing installed app data was not opened, inspected, cleared, or replaced. The stale APK artifacts listed above remain pre-existing and must not be cited as this source build.

Pending exact actions: (1) finish unit coverage/review of the bounded capture parser and opt-in dump action; (2) rerun focused Jest, changed-file ESLint, Python parser tests; (3) after web releases its one request, rerun `npm.cmd run mobile:check` and report exact new diagnostics without editing Convex/LuvLink ownership; (4) only if typecheck/build prerequisites and safe isolated Android install state exist, make a local release-equivalent opt-in build with per-command JDK 21 and capture emulator-only evidence. If safe isolation is unavailable, do not install over `com.lyricflow.app`; leave APK/runtime baseline pending. Physical-device audio/refresh/battery evidence still requires a physical phone.

No performance measurements or speedup claims are added by this checkpoint. Web worker separately reported one production browser smoke failed during app search (n=1 failure, n=0 successful journey; HTTP 200 was observed); it is not Android evidence.

### Parser utility verification (synthetic only)

- `python -B apps/mobile/scripts/perf/test_capture_android_trace.py` from `C:\dev\allegra` — exit 0; 4 tests passed in 0.001 s. Fixtures are synthetic and prove parser/allowlist behavior only; this is not an Android runtime result.
- `python -B -c "import pathlib; compile(pathlib.Path('apps/mobile/scripts/perf/capture_android_trace.py').read_text(encoding='utf-8'), 'capture_android_trace.py', 'exec'); compile(pathlib.Path('apps/mobile/scripts/perf/test_capture_android_trace.py').read_text(encoding='utf-8'), 'test_capture_android_trace.py', 'exec'); print('Python syntax passed')"` — exit 0; both scripts parsed without writing bytecode.
- The parser now rejects unknown fields, invalid event/scenario/cache/outcome values, malformed Android attempt IDs/generations, non-finite/negative times, non-integer/negative result counts, incomplete snapshots and dumps above 250 records. No ADB device was connected, so the capture command itself has not been run.

### Reverification after explicit opt-in log export

- `npm.cmd test -- --runInBand src/services/performanceTrace.test.ts src/contexts/PlayerContext.test.ts` from `apps/mobile` — exit 0; 2 suites, 16 tests passed in 25.158 s. This includes the added explicit-dump privacy and clear-active-attempt test. Output was returned directly; no standalone log file.
- `npx.cmd eslint src/services/performanceTrace.ts src/services/performanceTrace.test.ts src/screens/SearchScreen.tsx src/contexts/PlayerContext.tsx` from `apps/mobile` — exit 0, no diagnostics. Output was returned directly; no standalone log file.
- `python -B scripts/perf/test_capture_android_trace.py` from `apps/mobile` — exit 0; 4 synthetic parser tests passed. No device was connected.
- PowerShell AST parse of `apps/mobile/scripts/perf/build_android_perf.ps1` — exit 0; `PowerShell AST parse passed`. Build runner has not yet been executed.

A one-request same-origin Next `/api/search` diagnostic is currently owned by the web worker. Android gates/build remain idle until that worker confirms release.

### Full mobile gate rerun — 2026-10-06

`npm.cmd run mobile:check` from `C:\dev\allegra` — exit 2. The secret scan passed. `apps/mobile` ESLint completed with 0 errors and 69 warnings; this count includes concurrent LuvLink/connect/navigation work and the gate did not run in a clean worktree. TypeScript now resolves the two LuvLink modules but fails on one concurrent mobile Connect error and three shared Convex diagnostics:

- `apps/mobile/src/services/connect/ConnectProvider.tsx(233,45)`: `Song` missing required `source` for the connect destination input.
- `convex/connect.ts(1292,47)`: union property `code` is not narrowed.
- `convex/connect.ts(1307,47)` and `(1307,76)`: union properties `code` and `error` are not narrowed.

These files are outside Android measurement ownership and were not changed here. The chained `test:ci` stage did not run; direct Android/player Jest remains 16/16 passing as recorded above. Full command output: `C:\dev\allegra\output\performance\android\mobile-check.log`.

The failed TypeScript gate does not prevent attempting a Metro/Gradle bundle because the errors are type diagnostics, but the Android diagnostic APK will not be represented as typecheck-clean or release-ready. A local release-equivalent build is the next check, with the existing release APK backed up and restored by the owned runner.

### Interrupted diagnostic APK attempt and resume review — 2026-10-06

The first controlled invocation was `powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/mobile/scripts/perf/build_android_perf.ps1`. The user interrupted the turn while Gradle was starting. The retained `output/performance/android/release-build.log` contains only the single-use daemon startup message; Gradle produced no task diagnostics. This is an interrupted attempt, not a reported Gradle build failure. On resume, the Gradle/session processes were gone, ADB and the emulator were empty, and no diagnostic APK existed. The pre-existing release APK and its backup were both 32,180,316 bytes and had matching SHA256. No install or app launch occurred.

Review cleanup after resume keeps behavior unchanged and tightens measurement correctness: local search results keep their attempt token when only the scope chip changes, since the query and local lookup did not change; the ADB extractor now verifies an explicitly requested PID belongs to the target package, rejects ambiguous package processes without `--pid`, and fails when the latest dump is incomplete rather than falling back to stale trace data. Console output no longer prints the chosen output path. The build runner reports restore-check failure without throwing before its exit path. These resumed edits still need focused checks before another Gradle run.

Current known shared listeners on ports 8080/5173 belong to an unowned `tsx watch` / `next dev` parent chain reported by the web worker. Android did not start them. They remain untouched pending root ownership confirmation; Android measurement does not require stopping them.

### Resume cleanup checks and bounded build retry preparation — 2026-10-06

After the interrupted attempt, the original release APK and preserved copy have matching SHA256 and byte count (32,180,316); no diagnostic artifact exists. No Java, emulator or QEMU process remained. The prior Gradle command produced only daemon startup output, so it did not reach a reportable task failure.

Review changes to `SearchScreen.tsx` keep the existing local-result attempt across scope-chip changes while clearing it when the query changes. This preserves tracking for the same completed local lookup without changing search behavior. The ADB extractor now verifies a requested PID against `pidof`, refuses ambiguous processes without an explicit PID, rejects incomplete latest dumps, and prints no destination path.

Rechecks after these edits:

- `npm.cmd test -- --runInBand src/services/performanceTrace.test.ts src/contexts/PlayerContext.test.ts` from `apps/mobile` — exit 0, 16 tests across 2 suites, 22.51 s.
- `npx.cmd eslint src/services/performanceTrace.ts src/services/performanceTrace.test.ts src/screens/SearchScreen.tsx src/contexts/PlayerContext.tsx` from `apps/mobile` — exit 0, no diagnostics.
- `python -B scripts/perf/test_capture_android_trace.py` from `apps/mobile` — exit 0, 5 synthetic parser tests. No device evidence.
- PowerShell AST parse of `apps/mobile/scripts/perf/build_android_perf.ps1` — exit 0.

The only remaining build step is one controlled retry after these checks, with the stale APK hash checked before and after. If Gradle fails or the attempt is interrupted again, stop Android build work and report its exact log/limitation. Current ports 8080/5173 are occupied by services not started by Android; they are not needed for `:app:assembleRelease` and will not be stopped here.

### Diagnostic APK build result — 2026-10-06

The controlled retry used `powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/mobile/scripts/perf/build_android_perf.ps1`. Gradle exited 1 during Expo configuration at `:expo-constants:createExpoConfig`; it stopped before JS bundling or native compilation because the runner had not set the required `NODE_ENV`:

`The NODE_ENV environment variable is required but was not specified. Ensure the project is bundled with Expo CLI or NODE_ENV is set.`

This is a failed build attempt with a known task-local environment requirement, not an APK/runtime result. The JS export did not finish. Full Gradle configuration log: `C:\dev\allegra\output\performance\android\release-build.log`; the quoted error appeared on the invoking PowerShell output, not at the end of the redirected log. Gradle/Metro PIDs exited. No emulator or ADB device was running. Peak free host RAM during Metro worker startup fell to 0.44 GiB, then recovered after the worker tree exited; no emulator was launched.

The original release APK and the runner's backup still match SHA256 and size (32,180,316 bytes). No diagnostic APK exists, no install occurred, and the parent shell's trace flag is off. I updated only the local measurement build runner to set `NODE_ENV=production` for its child process and preserve Gradle's nonzero exit code/log output. I did not start another build after this failure; the Android resource slot is released to the web worker.

No Android baseline or device evidence was collected. The remaining device constraint is unchanged: physical phone absent, existing app's private data untouched, and safe isolated runtime not attempted because no diagnostic APK was built.

### Final runner review and next-build notes — 2026-10-06

After the captured `NODE_ENV` failure, the owned PowerShell runner now sets `NODE_ENV=production` and `EXPO_PUBLIC_PERF_TRACE=1` only in its child process, uses JDK 21 and x86_64, limits Gradle workers to 2, preserves/restores the stale APK, and returns Gradle's exit code. PowerShell AST syntax check passed after this change. No further build was started; the web worker owns the released build/timing slot.

The failed Metro startup spawned 13 Node worker processes. Free physical RAM reached 0.44 GiB at peak, then recovered after they exited. Do not start the emulator during the next Android bundle/build. This runner does not yet set a Metro worker cap; verify a supported task-local Expo/Metro option before adding one. Do not change product Gradle/Metro configuration to work around local memory pressure.

Next local build command after the web worker releases resources: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/mobile/scripts/perf/build_android_perf.ps1`. Expected output path is `C:\dev\allegra\output\performance\android\allegra-android-perf-release.apk`; build log path is `C:\dev\allegra\output\performance\android\release-build.log`. No APK/device baseline is currently available, and this next command has not been run after the `NODE_ENV` runner fix.
