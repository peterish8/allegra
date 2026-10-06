# Navigation fix and emulator verification

2026-10-06. Base checkout `0e0c271`, branch `feat/spotify-blend-info-tours`; local changes, not committed or published.

## Outcome

Android bottom tabs now switch without a scene fade or custom transitionSpec. The old native fade could show the destination, flash the outgoing page, then show the destination again. This was recorded on the existing Pixel 9 Pro emulator build; the fixed current-code development build's recording shows one switch and no outgoing-page reappearance in the sampled frames.

The implementation is in `apps/mobile/src/navigation/TabNavigator.tsx`. iOS retains its fade. Android uses a numeric inactive activity state immediately rather than the fade's animated state. Hidden-tab freezing, lazy mounting, nested Library/Browse stack animations, tab shortcuts, and playback contracts are retained. App version is bumped to 1.1.1 in app.json. The mobile guide records why a transitionSpec must also be omitted: bottom-tabs treats it as animation even with animation none.

## Evidence

- Emulator: existing `Pixel_9_Pro`, `emulator-5554`, x86_64; display override 420 x 900.
- Original installed app reported native version 1.0.7. Its normal-motion recording `tab-baseline.mp4` / `tab-baseline-frames.png` shows Stream -> Library -> Stream briefly -> Library.
- Built this checkout's native debug app successfully using the already installed Java 17 and `:app:assembleDebug -PreactNativeArchitectures=x86_64`, installed it without clearing emulator app data, and loaded this checkout through Metro on 8081.
- About in the tested application reads 1.1.1. The committed Android Gradle project still has a pre-existing hardcoded native versionName 1.0.7; this local debug APK therefore is not identified by native versionName alone. The native build log and Metro source establish the tested checkout. CI's normal prebuild/release workflow remains the release path.
- Normal-motion settings: all three Android animation scales set to 1, app cold relaunched, actual app screen checked before recording. `tab-fixed-normal.mp4` / `tab-fixed-normal-frames.png`: Stream switches once to Library and Library stays visible. Frames sampled at 10 fps; this supports no sampled reappearance, not a millisecond latency or physical-phone performance claim.
- `.github/scripts/mobile-navigation-probe.py`: PASS with reduced system motion. Real Library/Stream tab taps; visible headings checked separately from tab selection; Stream heading moves out of view after a swipe; Settings, Search, and Playlists show their own headings; Library returns to its root after each; final Stream works. Search's keyboard is explicitly dismissed before tab taps so the probe does not hit keyboard keys instead.
- Luvs opened by an actual tab tap and Library opened by another tap to exit it (screenshots `luvs-fixed.png`, `library-from-luvs.png`).
- Classic bar selected through Settings. Library visibly opened; returning to Stream and swiping scrolled its content (`classic-library-ready.png`, `classic-stream-scroll.png`).
- Main-player music was started with its real Play control. Android MediaSession stayed PLAYING through Library -> Stream and advanced from 4103ms to 7111ms (`playback-before-nav.log`, `playback-after-nav.log`). Playback was then paused again to leave the emulator in its original listening state.
- Captured AndroidRuntime/ReactNativeJS/UiRecovery error logs remained empty during final navigation checks. Development warnings for deprecated React Native deep imports and reduced-motion mode are pre-existing and separate from navigation failures.

## Verification

- Root typecheck: PASS.
- Root lint: PASS.
- Root test workspace/API, shared, infrastructure and redirect sections: PASS. Four Convex tests initially hit their existing 5s timeouts under native compilation load. No timeouts changed. Isolated `npm.cmd run convex:test` rerun: 6 files / 69 tests PASS, plus 4 auth redirect tests PASS.
- `npm.cmd run mobile:check`: PASS: secrets scan, lint (38 warnings, 0 errors), typecheck, 92 suites / 761 tests.
- Native debug build: PASS.
- Python probe executed successfully; `git diff --check`: PASS.

## Earlier stuck-state report

After the user reinstalled, navigation worked but flickered. The permanently stuck Stream state did not reproduce on the available emulator. Animated native scene attachment remains a plausible common cause; removing that path addresses the confirmed flicker and immediate inactive-state handling. Reinstallation may reset several kinds of state, so it does not identify the original cause. Do not claim permanent-stuck causation, every physical device, iOS parity, or a shipped fix from this evidence.

## Local reproduction commands

With an installed build already launched under reduced system motion:

```powershell
python .github/scripts/mobile-navigation-probe.py --serial emulator-5554 --out .planning/navigation-audit/fixed-probe
```

The probe saves visible-screen XML and screenshots, restores the animation scales it found, and does not clear application data. Normal-animation video verification is separate because an idle-state UIAutomator dump cannot detect a transient flash.

The Pixel emulator and Metro were left running for review. No release was published, no remote push was made, and unrelated Blend planning files/logs were preserved.
