# Archived QA log summary

Summarized and removed on 2026-11-13 at the owner's request. These are historical logs, not current acceptance evidence. Source code, screenshots, videos and test fixtures are retained. Dependency/build caches and logs outside `.planning` and `cook` were excluded.

## Findings

- The November 12 full/final logcats repeat Android UI automation registration failures (`UiAutomationService ... already registered`). A fatal-marker count alone must not classify those as an app crash.
- Those logs also record an app-process `NullPointerException` in React Native development inspector WebSocket message handling at 16:07:25. This is debug-tool evidence; release-build immunity has not been established by this log.
- The November 13 pre-fix canvas log records `AbstractMethodError: LoadControl.getAllocator(PlayerId)` on `ExoPlayer:Playback`, in `com.lyricflow.app` at 00:14:47. This is the crash addressed by PR 85's Media3 alignment.
- Later canvas verification logs contain no fatal markers. The separate `cook/verify/canvas-latest/results.txt` preserves ten unchanged-PID rounds. This proves only that exercised emulator path, not all app paths or physical-device codecs.
- Older CI launch/smoke failures and lint/test results remain historical. A later green build does not erase earlier gaps; the integration plan retains broader player, recovery, native controls and phone checks.

Removed 31 files totaling 83,539,538 bytes.

## Per-file evidence

### `.planning/mobile-ui-review/mobile-check-current.log`

286,542 bytes; SHA256 `9f53cfb845b65bda92c9ba9dd7e5c5fa36b23f0749916b10f307f1061685a71c`.

- ✖ 86 problems (0 errors, 86 warnings)
- Test Suites: 124 passed, 124 total
- Tests:       1019 passed, 1019 total
- No fatal exception markers found.

### `.planning/mobile-ui-review/mobile-check-v6-foundation.log`

286,880 bytes; SHA256 `ba628b6a5c6ebde109e288b22b774020332a6b85c070fb8627ed40c4fa4982e7`.

- ✖ 87 problems (0 errors, 87 warnings)
- Test Suites: 125 passed, 125 total
- Tests:       1026 passed, 1026 total
- No fatal exception markers found.

### `.planning/mobile-ui-review/mobile-check-v6-launch-fix.log`

297,194 bytes; SHA256 `97e47afea7aa66c68c92e682c8265b3fec25cfd0619f415ace4535dfe14dcffb`.

- ✖ 90 problems (0 errors, 90 warnings)
- Test Suites: 130 passed, 130 total
- Tests:       1041 passed, 1041 total
- No fatal exception markers found.

### `.planning/mobile-ui-review/mobile-check-v6-release.log`

381,802 bytes; SHA256 `45c7b41abcef4e1c18daa9adb7b96161dd0e051636f2a7dde9e2857296687b51`.

- ✖ 92 problems (0 errors, 92 warnings)
- Test Suites: 129 passed, 129 total
- Tests:       1039 passed, 1039 total
- No fatal exception markers found.

### `.planning/mobile-ui-review/mobile-check-v6-screens.log`

384,652 bytes; SHA256 `8ea526ec921726ed57104571da3b56fbd89ecc2c3c848ef6150fbafd60f3bb20`.

- ✖ 92 problems (0 errors, 92 warnings)
- Test Suites: 1 failed, 127 passed, 128 total
- Tests:       1 failed, 1034 passed, 1035 total
- No fatal exception markers found.

### `.planning/mobile-ui-review/v6-ci-launch-failed.log`

155,792 bytes; SHA256 `1cfa11cc588ea89ee0ad6de8b964d578afee3bfc4dc35463b70ea8e77b7d1af4`.

- FAIL: second: no About button on Stream
- Opens on an emulator	Open the app	2026-11-05T22:06:16.8015181Z == 1 failed checks
- No fatal exception markers found.

### `.planning/mobile-ui-review/v6-design-audit.log`

2,948 bytes; SHA256 `aef9b7de1d18ee96489a6f338acf0192f20c388b5c90a699a349bf215e48b4c5`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/v6-final-lint.log`

20,574 bytes; SHA256 `c98d8248f60b9649baa1711db4f151cd0c8d001d8f1ab73ea9f9afd213b217f6`.

- ✖ 92 problems (0 errors, 92 warnings)
- No fatal exception markers found.

### `.planning/mobile-ui-review/v6-guard-ratchet.log`

2,648 bytes; SHA256 `f38904447237de195e6cf30429d81cff2ec64c1e38212dcb6e94e3f7e48107fb`.

- Test Suites: 1 passed, 1 total
- Tests:       9 passed, 9 total
- No fatal exception markers found.

### `.planning/mobile-ui-review/v6-main-smoke-failed.log`

1,799,806 bytes; SHA256 `67b85072b8dbd6c8d00e2d8f550686508282a680f9a37b691f03750b8526b55d`.

- FAIL: E nothing was restored: no song after a kill and a relaunch
- FAIL: E after the restore: controls missing: Previous Next (app nodes on screen: 1)
- Launch on emulator	UNKNOWN STEP	2026-11-05T23:29:07.3248415Z == 23:29:07 done: 15 failed checks
- Launch on emulator	UNKNOWN STEP	2026-11-05T23:29:28.5894534Z == player probe: 15 failed checks (see player-controls.txt)
- BUILD SUCCESSFUL in 22s
- No fatal exception markers found.

### `.planning/mobile-ui-review/v6-native-check.log`

105,988 bytes; SHA256 `8052d3bf8f8aa02013fc23e81fc931ba25e3c4d98b9d36422cf6455d6bc20cfc`.

- BUILD SUCCESSFUL in 2m 58s
- No fatal exception markers found.

### `.planning/mobile-ui-review/ci-launch-42116277462/logcat-first.txt`

4,303,184 bytes; SHA256 `4954f8a957ed3a54e265b5bc038ed064bc346524342e0ab9e27846b6c6817641`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/ci-launch-42116277462/logcat-player.txt`

361,716 bytes; SHA256 `c4e34cb42202fcbffeadb670132c863e2e54191df24e52d194fe3cecdccea051`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/ci-launch-42116277462/logcat-second.txt`

286,894 bytes; SHA256 `308641d4e3cda4b11b7a1252254fc77fc4195fe8082c3cb706de9287fc3adbd2`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/ci-smoke-42126270194/logcat-live.txt`

9,630,228 bytes; SHA256 `5521528b003104b23c412262f47149055737eabc37b6e26fb77f89f2ed551b6d`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/ci-smoke-42126270194/logcat.txt`

3,052,161 bytes; SHA256 `8b602016b963d9ead517210a1f9f90e4fc94389d219ce0c2935c162970fbbc5b`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/ci-smoke-42126270194/pass2-logcat-live.txt`

6,056,597 bytes; SHA256 `08014952e9e37cafd37b86e7c481c0cee80240f6ad213854dd7a8a1ce24ed360`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/ci-smoke-42126270194/pass2-logcat.txt`

6,056,597 bytes; SHA256 `08014952e9e37cafd37b86e7c481c0cee80240f6ad213854dd7a8a1ce24ed360`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/ci-smoke-42126270194/pass2/logcat-live.txt`

6,056,597 bytes; SHA256 `08014952e9e37cafd37b86e7c481c0cee80240f6ad213854dd7a8a1ce24ed360`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/ci-smoke-42126270194/pass2/logcat.txt`

6,056,597 bytes; SHA256 `08014952e9e37cafd37b86e7c481c0cee80240f6ad213854dd7a8a1ce24ed360`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/ci-smoke-42126270194/probe/logcat-live.txt`

2,969,836 bytes; SHA256 `6dc817c202e4e9e7127bf18f8a05b3221f7b403360afc9ca8dd0b8e17fd3cd9d`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/ci-smoke-42126270194/probe/logcat.txt`

2,969,836 bytes; SHA256 `6dc817c202e4e9e7127bf18f8a05b3221f7b403360afc9ca8dd0b8e17fd3cd9d`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/design-drafts/audit-v6-console.log`

2,870 bytes; SHA256 `15a669b16b4d207e727fa5e32280c6e8bcd48799487d2a4cd1aef917b5fa1741`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `.planning/mobile-ui-review/evidence-2026-11-12/logcat-final.txt`

3,282,741 bytes; SHA256 `2c13a05c30d06e7a771eca20c66de17d70d7cee4d98d0fe8708640e0577b85fa`.

- No terminal test/build result in this log.
- Fatal marker: 11-12 15:49:09.750: java.lang.IllegalStateException: UiAutomationService android.accessibilityservice.IAccessibilityServiceClient$Stub$Proxy@950433balready registered! (Process not identified in excerpt)
- Fatal marker: 11-12 15:55:56.922: java.lang.IllegalStateException: UiAutomationService android.accessibilityservice.IAccessibilityServiceClient$Stub$Proxy@950433balready registered! (Process not identified in excerpt)
- Fatal marker: 11-12 15:56:56.309: java.lang.IllegalStateException: UiAutomationService android.accessibilityservice.IAccessibilityServiceClient$Stub$Proxy@950433balready registered! (Process not identified in excerpt)
- Fatal marker: 11-12 16:02:14.605: java.lang.IllegalStateException: UiAutomationService android.accessibilityservice.IAccessibilityServiceClient$Stub$Proxy@950433balready registered! (Process not identified in excerpt)
- Fatal marker: 11-12 16:07:25.220: java.lang.NullPointerException: java.lang.NullPointerException (Process: com.lyricflow.app, PID: 10893)

### `.planning/mobile-ui-review/evidence-2026-11-12/logcat-full.txt`

14,461,991 bytes; SHA256 `6ee820e73df7a72b1081c61f8608b4b6fee198809ec605ecd707c5c4f48c1157`.

- No terminal test/build result in this log.
- Fatal marker: 11-12 15:49:09.750: java.lang.IllegalStateException: UiAutomationService android.accessibilityservice.IAccessibilityServiceClient$Stub$Proxy@950433balready registered! (Process not identified in excerpt)
- Fatal marker: 11-12 15:55:56.922: java.lang.IllegalStateException: UiAutomationService android.accessibilityservice.IAccessibilityServiceClient$Stub$Proxy@950433balready registered! (Process not identified in excerpt)
- Fatal marker: 11-12 15:56:56.309: java.lang.IllegalStateException: UiAutomationService android.accessibilityservice.IAccessibilityServiceClient$Stub$Proxy@950433balready registered! (Process not identified in excerpt)
- Fatal marker: 11-12 16:02:14.605: java.lang.IllegalStateException: UiAutomationService android.accessibilityservice.IAccessibilityServiceClient$Stub$Proxy@950433balready registered! (Process not identified in excerpt)
- Fatal marker: 11-12 16:07:25.220: java.lang.NullPointerException: java.lang.NullPointerException (Process: com.lyricflow.app, PID: 10893)

### `.planning/mobile-ui-review/evidence-2026-11-12/logcat-since-play.txt`

127,272 bytes; SHA256 `84585db43e2f29691feae5e86591e5ad8810621305f34be4e92c87392da4fcc7`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `cook/crash/logcat-85.txt`

4,487,337 bytes; SHA256 `c4bdcca4992878a01a546d460b5d44c5454425de78d5e43f1e4b81894d5c6558`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `cook/crash/logcat.txt`

7,374,542 bytes; SHA256 `52662777d5b5c215004cc7c762e1c8743435620f8fa25737633bd12e7e1b3181`.

- No terminal test/build result in this log.
- Fatal marker: 11-13 00:14:47.549: java.lang.AbstractMethodError: abstract method "androidx.media3.exoplayer.upstream.Allocator androidx.media3.exoplayer.LoadControl.getAllocator(androidx.media3.exoplayer.analytics.PlayerId)" on receiver java.lang.Class<tb.o> (Process: com.lyricflow.app, PID: 2051)

### `cook/verify/menu-logcat.txt`

949,168 bytes; SHA256 `c81cb0f88855b745c42c0f68ce7a6d1698cee13be17dbf11ab73ee9b8f1d1c6c`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `cook/verify/canvas-latest/logcat.txt`

581,538 bytes; SHA256 `dff5a6de4944a871bba24fa405c05baa7d8930c772b74d4323d7de45c85cfe3e`.

- No terminal test/build result in this log.
- No fatal exception markers found.

### `cook/verify/no-canvas/logcat-live.txt`

747,010 bytes; SHA256 `9d8c7d65ac105624875c302a25b9a6c1497d3df7dc92c05d91a03281660508cd`.

- No terminal test/build result in this log.
- No fatal exception markers found.
