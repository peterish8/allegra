# Mobile implementation status (checkpoint 2026-10-06 15:23 Asia/Kolkata)

This is a precise worker checkpoint for `.planning/luvlink/CHECKLIST.md`, not a completion claim.

## Implemented mobile surfaces

- LuvLink-named mobile paths and labels are partially integrated. Echo protobuf transport, AsyncStorage key `'luvlyrics-listen-together'`, and `lyricflow://together` remain for migration compatibility.
- Added first-party Convex client `apps/mobile/src/services/luvLink/client.ts` with distinct room/member/queue/playback/presence subscriptions; profile-auth user id (no role-based fallback); bounded foreground server-time samples and fresh playback query on resume; presence heartbeat and secure-store session token/disconnect; create/join/mode/speaker/controller/queue/playback calls; error and cancellation seams.
- Added first-party `apps/mobile/src/services/luvLink/sync.ts`: monotonic projection, paused resolve/load then ready report, exact canonical local-copy preference, output-only audio loading, controller-only following without audio, remote-correction mute, explicit seek/control helpers, 30-second leader checkpoint, fenced natural-end advance, speaker intent ack and pause-confirmed handoff. It uses frozen playback intents, output-applied sequence, barrier and speaker handoff fields. Service tests are being added; it is not verified yet.
- Root-mounted `LuvLinkHost.tsx` now starts/stops authenticated client+sync and registers leave before signout. `ConnectProvider.tsx` marks device `canPlay:false` when either owned LuvLink or legacy Echo session is active.
- A central `setOwnedRoomRouter` in playerStore claims active-room track picks, play/pause, next, previous, queue-row selection, widget and OS `nextInPlaylist` before solo playback. Remote anchor updates bypass the router explicitly. Stream play-next is also routed to LuvLink. PlayerContext skips its optimistic playing write on LuvLink natural end. Room tracks use one-item `luv-link` native queues; radio refill skips them and repeat mode restores on leave.
- Added `LuvLinkPanel.tsx` and `LuvLinkSettings.tsx`: first-party create/join, invite sharing, QR, mode/member controls, current track contribution, play-next, attributed queue play/reorder/remove, room exit. New QR dependency `react-native-qrcode-svg` installed in `apps/mobile/package.json` and app lockfile. Standalone `LuvLinkScreen.tsx` is now registered as a root route; Settings opens it without a current song. HTTPS `/luvlink/join/<CODE>` navigates there directly with the invite in volatile state. Screen has not been rendered/device inspected.
- Cross-review caught remote track queue replacement triggering `requestPlayback(false)` through the user-control router. All four remote queue replacements are wrapped in synchronous `withoutOwnedRoomRouting`. Regression test proves a remote track loads and reports ready without calling the playback-intent mutation.

## Current verification evidence

- `npm.cmd run typecheck --prefix apps/mobile` exited 0 after adding standalone screen and remote queue suppression test. This is scoped mobile TypeScript only, not root typecheck/lint/test.
- `npm.cmd test --prefix apps/mobile -- --runInBand src/store/playerStore.test.ts src/services/luvLink/legacy/client.test.ts src/services/luvLink/legacy/sync.test.ts` exited 0: 3 suites, 37 tests, 64.577s. It verifies legacy P0 and generic store routing.
- `npm.cmd test --prefix apps/mobile -- --runInBand src/services/luvLink/sync.test.ts` exited 0: 1 suite, 5 tests, 46.543s. Covers loaded member readiness while barrier paused; remote track load/report-ready without a pause/control echo; controller-only no audio/readiness; speaker intent ack waits for native playback status; natural-end commit is single-shot and carries server queue entry ID.
- `adb devices` shows `emulator-5554 device`; no attached physical phones. Two-device audible drift and physical screen-off/network-handoff proof remain unverified.
- User requires Codex IAB for rendered web checks. IAB is unavailable; no rendered browser flow is verified. Do not use another browser.
- Mobile LuvLink has not passed emulator or complete end-to-end acceptance. Leave/signout cancellation, stale async resolver prevention, group-picks UI and full authentication/deep-link acceptance remain pending.
- Parent reports root API/shared 142 tests, infrastructure 20 tests, Convex 78 tests, configured dev Convex `--once`, root typecheck and lint all green. This is parent-provided evidence, not independently rerun by this worker. No production deployment.

## Exact next steps

1. Add lifecycle coverage for leave/signout during unresolved catalog lookup; verify no stale player load, no control fall-through, solo queue/repeat restore and controller-only close behavior.
3. Verify cold HTTPS invite through sign-in, visible/accessibility labels and QR URL/code format; invite remains transient.
4. Bind group picks to generated `setSuggestionsConsent`, `getGroupPicks`, `refreshGroupPicks`, only while shelf is visible. Add no second mobile cache.
5. Run remaining mobile tests and `npm.cmd run mobile:check` when root heavy gates are idle; then feasible emulator checks. Use visible Codex IAB only for web proof. No physical two-device/background claim.
