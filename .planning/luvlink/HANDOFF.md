# LuvLink handoff

Last updated: 2026-10-06 15:14 Asia/Kolkata. Continue from `PLAN.md`, `CHECKLIST.md`, `MOBILE-STATUS.md`, this handoff, and `BACKEND-WEB-STATUS.md`. User authorized implementation. Do not deploy, publish, push, merge or target production. User requires rendered web checks to use Codex in-app browser only. Open with CUA `createBrowserTab('iab', url, {visible:true})`; never use Opera, Chrome, Edge or another browser. If IAB is unavailable, record the limitation.

## Workspace facts

- Repo `C:\dev\allegra`, branch `feat/spotify-blend-info-tours`, HEAD `0e0c271` at checkpoint. Shared worktree is dirty with feature and unrelated navigation/performance/Blend edits. Preserve each owner’s files and never reset broad paths. Do not stage unrelated `SearchScreen.tsx`, performance tracing, navigation probe/audit, Blend or web performance edits with LuvLink.
- Mobile worker owns `apps/mobile/`, `.planning/luvlink/{PLAN,CHECKLIST,HANDOFF,MOBILE-STATUS}.md`, and historical research pointer. Backend/web worker owns `convex/`, `packages/shared/`, `apps/web/`, account API changes, `docs/luvlink-contract.md`, `BACKEND-WEB-STATUS.md`.
- Last known unrelated dirty blockers included `apps/mobile/src/screens/SearchScreen.tsx` and `packages/shared/performanceTrace.ts`; verify owners/current output before touching. Backend prior typecheck reported `convex/connect.ts:1292,1307` union error. Do not assume current.

## Resume actions

1. Inspect current status and read `CLAUDE.md`, `apps/mobile/CLAUDE.md`, required architecture/API/workflow docs, `docs/luvlink-contract.md`, and both status files.
2. Coordinate with backend worker on their generated API completion. Frozen contract requires playback `intent` (`control`, `natural_end`, `checkpoint`), adds anchor `intent`, `intentByUserId`, `outputAppliedSequence`, `barrierPending`, room `handoffFromUserId`, and APIs `acknowledgeSpeakerHandoff` and `acknowledgePlaybackIntent`. Queue next is `getQueue.entries[0]`; passing its entry ID to publish consumes atomically. See worker status for exact function args.
3. Legacy/store run: `npm.cmd test --prefix apps/mobile -- --runInBand src/store/playerStore.test.ts src/services/luvLink/legacy/client.test.ts src/services/luvLink/legacy/sync.test.ts` exited 0, 3 suites and 37 tests passed in 64.577s. First-party sync run: `npm.cmd test --prefix apps/mobile -- --runInBand src/services/luvLink/sync.test.ts` exited 0, 1 suite and 4 tests passed in 180.508s. It covers barrier readiness while paused, controller-only no audio/readiness, native-confirmed speaker ack, and one natural-end advance. Full mobile gates remain pending.
4. Latest mobile TypeScript run: `npm.cmd run typecheck --prefix apps/mobile` exited 0 after mobile helper imports and backend-owned Convex union narrowing. Rerun after edits.
5. First-party central player router claims room track selection, play/pause, next, previous and queue-row selection before local playback. Remote playback bypasses routing explicitly. Stream loads use one-item `luv-link` queues, repeat mode restores, radio refill skips this queue, and PlayerContext does not set optimistic playing before a LuvLink end command. The dedicated sync tests listed above pass; leave/signout cancellation and old resolver side-effect behavior still need direct lifecycle proof.
6. Verify lifecycle: stale async actions stop after leave/signout; old catalog resolution cannot load; solo queue/repeat restores; controller-only close does not pause local audio. Speaker handoff waits for real native pause; applied intent ack follows real player state.
7. A standalone `LuvLink` route/screen now exists; Settings opens it without a current song, and HTTPS `/luvlink/join/<CODE>` deep links navigate directly there with the invite held in volatile state. Verify typecheck and deep-link tests. Finish group-picks consent/shelf against generated backend API, auth return/accessibility audit, lifecycle cancellation tests, then run mobile full gates and emulator check. Web rendered checks must use visible Codex IAB only. No physical two-device/background proof.

## Compatibility/security/product contract

- `docs/luvlink-contract.md`, `packages/shared/luvLink.ts`, generated `api.luvLink` are source of truth. First-party `convex-v1` never overlaps a room with legacy `echo-legacy`.
- Preserve old key `'luvlyrics-listen-together'`, protobuf and `lyricflow://together?code=...`. New HTTPS invite is `/luvlink/join/<CODE>`; pending invite code is transient in memory; new presence credential uses secure store; room queries never contain invite code.
- `listen` members with output enabled follow all committed anchors; `speaker` controller participants follow controls/timeline but never resolve/load audio/report buffer ready. Output identity/leader epoch differs from who may submit control intents.
- Only explicit user actions publish seeks. Network corrections never echo. Playback project uses calibrated server clock + monotonic client time; no per-second Convex writes.
- Exact canonical ref first, with version/title/artist and duration evidence; <=2.5-second duration variance is necessary but not sufficient. Timeouts stay paused and clear pending state; no false ready or autoplay.

## Verification limits

- Android device list: `emulator-5554 device`; no physical phones attached. Physical two-device sync, audible drift, screen-off reliability, network handoff and Bluetooth latency remain unverified.
- IAB status: unavailable in this session, so no rendered web check confirmed. User requires Codex IAB only. Do not use another browser if its debugger fails.
- Latest mobile typecheck (before standalone screen route) exited 0. Focused three-suite legacy/store passed 37/37 and first-party sync passed 4/4. Rerun typecheck after screen changes; full mobile gates remain pending.
- Parent reported root test gates green: API/shared 142 tests, infrastructure 20 tests, Convex 78 tests; configured development Convex `--once` succeeded. Parent reports root typecheck/lint green. This is parent-provided evidence, not independently rerun by mobile worker. No production deployment.
- `react-native-qrcode-svg` was added; install output reported 101 audit advisories in resolved existing dependency tree (1 low, 62 moderate, 35 high, 3 critical). No `npm audit fix` ran. Review/attribute if necessary; don't mass-upgrade during feature work.
- Backend status separately records completed codegen/focused Convex suite/dev validation and remaining web/backend tasks. No browser or production test is claimed.

## No secret values

Do not include tokens, invite codes, presence session tokens, or `.env` contents in plans or logs. DEV validation is authorized by repository workflow; production deployment is not.
