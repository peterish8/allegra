# Android tab navigation and Stream scrolling audit

Date: 2026-10-06. Checkout: `0e0c271`. Scope: diagnosis and plan only; no application code changed.

**Subsequent implementation:** the user authorized emulator diagnosis and a fix. See [RESULTS.md](RESULTS.md) for current changes and verified outcomes. The following is the original pre-implementation plan.

## Reported failure

Launch opens Stream. Selecting another page updates the bottom navigation, but Stream remains visible and no longer scrolls. Selecting Stream again restores interaction.

Working assumption: this is the Android mobile app. No Android device/emulator was attached (`adb devices` returned an empty list). The installed APK's commit/version has not been established. Findings below are source evidence and ranked hypotheses, not a reproduced root cause.

## Findings

### 1. Highest priority: native tab scene transition / attachment mismatch

`apps/mobile/src/navigation/TabNavigator.tsx:165-175` combines `animation: 'fade'`, a custom native-driver `transitionSpec`, and `freezeOnBlur: true`. Android also gets inactive-screen detachment from bottom-tabs' default. Commit `71194f6` introduced the custom fade and freezing on October 3; fade itself existed before that commit. This is a regression boundary to test, not proof the commit caused the failure.

The installed `@react-navigation/bottom-tabs` is 7.12.0. In its `src/views/BottomTabView.tsx:154-161`, routes before the selected index animate to -1; the selected route animates to 0. At lines 304-318, an unfocused screen's native activity state is derived using input range `[0, 1 - EPSILON, 1]` and output `[1, 1, 0]`, with extension. A route at -1 therefore remains at state 1 (transitioning/below top), rather than state 0 (inactive). Stream is first, so every other tab is after it.

The same component passes a z-index intended to put inactive screens behind the selected one, but `react-native-screens/src/components/Screen.tsx:207-213` deliberately clears that z-index for native hierarchy management. These facts make native attachment/order a concrete investigation target. They do not prove that Stream actually paints above the selected screen on this phone; the fade also changes scene opacity, which must be observed.

### 2. Freezing is a secondary variable, not an established cause

`freezeOnBlur: true` applies to tabs and the Library/Browse stacks, except Luvs. However, bottom-tabs passes `shouldFreeze={activityState === STATE_INACTIVE && !isPreloaded}` at line 325. With a fade, activityState is an interpolation object, so this equality is false. The installed Screen implementation prioritizes explicit shouldFreeze. Thus the comments promising all faded hidden tabs freeze are not reliable evidence of actual freezing. Disabling freezing alone may not address this incident.

### 3. Lower priority: touch-blocking overlays

`apps/mobile/src/navigation/RootNavigator.tsx` mounts the mini player and several overlay hosts above the navigator. Audit their closed/dismissed states if transition experiments do not resolve the failure. Inspected MoreMenu and VoiceSearchCard code already disables pointer events when closed/noninteractive. Do not label those components broken without a failing state.

`StreamScreen.tsx:589` uses a normal ScrollView with no explicit scrollEnabled restriction; its status scrim is pointerEvents none. An inactive Stream remaining visible would explain why its image remains but scrolling stops. Its scroll view alone is a weaker first suspect.

### 4. Test coverage gap

Both tab bars emit tabPress and call navigation.navigate with tabTapParams. The bar derives selection from navigation state, so the changed highlight is consistent with state updating independently of native scene presentation.

`src/navigation/tabs.test.ts` and `libraryRoot.test.ts` cover pure tab parameters/double taps and Library stack behavior. They cannot prove native screen visibility or scrolling. A device navigation smoke test is required.

## Implementation sequence

1. **Capture the failing baseline.** Establish APK version/build commit in About, compare with this checkout, and record Android version, animation settings, bar style, and whether playback is active. On a phone/emulator capture logcat plus screenshots/UI hierarchy for launch, Stream -> Library, Stream -> Luvs, More -> Settings/Search, and return to Stream. Record the current route and focus/blur/transition events in development instrumentation only. A selected tab, continuing audio, or process liveness is not success.

2. **Isolate the tab transition.** In a diagnostic branch, use Android `animation: 'none'` and omit the custom transitionSpec entirely. Setting animation none while retaining transitionSpec is insufficient: bottom-tabs considers an explicit transitionSpec an animation. Keep other variables fixed first, including freezing, so this experiment tests the native animated activity-state path. Exercise both bars and repeat the exact baseline sequence.

3. **Isolate freezing if needed.** If the first experiment still fails, disable tab freezeOnBlur with the no-transition configuration and retest. Test nested-stack freezing separately only if Library/Browse still fail. If necessary test detachInactiveScreens false as a further diagnostic, with a memory/performance check; do not make it the default workaround without evidence.

4. **Ship the smallest proven fix.** If removing Android native tab transitions fixes the red case, retain that focused Android change. Keep navigation, Library root/double-tap behavior, screen state, scroll positions, player ownership, and iOS behavior intact. Reintroduce a fade only through a device-proven approach that cannot keep an inactive native scene attached. If no experiment fixes the red case, investigate overlay hit testing and native hierarchy before expanding scope.

5. **Add a real regression check.** Extend `.github/scripts/mobile-android-smoke.sh` or add a focused navigation probe. Assert destination-specific visible content and a working action/scroll on each page, not only selected nav labels. Verify Stream initially scrolls, returns with retained position, and scrolls immediately after every return. Cover Library -> playlist -> another tab -> Library root, Settings/Search via More, artist/collection Browse, repeated rapid switches, Android Back, background/resume, active playback, modern/classic bars, and normal/disabled system animations. Include a release APK because development behavior may differ.

6. **Validate and release.** Run root typecheck/lint/tests and mobile:check, plus relevant native checks if Kotlin changes. Bump apps/mobile/app.json expo.version for a fix APK reaching main. Verify the installed release artifact on a physical phone; identify its commit. Maintain audio/queue/playback invariants. Stop after this navigation slice passes.

## Success criteria

- A tap changes both the selected tab and the visible, interactive destination without a recovery tap.
- Stream scrolls on first launch and every return.
- Hidden pages never intercept the active page's touches.
- Rapid switches and interrupted transitions cannot strand an old scene.
- Library stack and double-tap shortcuts still behave as designed.
- Playback continues across tab changes; Luvs' separate player remains focus-managed.

## External cross-check

The official [bottom-tabs changelog](https://raw.githubusercontent.com/react-navigation/react-navigation/main/packages/bottom-tabs/CHANGELOG.md) lists a stuck animation-state fix in 8.0.0-alpha.54. That is a different release line and does not establish this app's cause or justify an alpha upgrade. Prefer the controlled configuration experiment against the installed 7.12.0 code before considering dependency changes.

## Current limitations

No device reproduction, logcat capture, full gate run, or application fix was performed during this planning audit. Preserve the existing unrelated `.planning/blend/test-results-*.log` files.
