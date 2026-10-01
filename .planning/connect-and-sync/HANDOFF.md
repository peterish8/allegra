# Handoff — Connect + library sync

Updated 2026-10-01 for the reliability follow-up. Historical verification is separated
from current local slice evidence below.

## Current state

- The source implementation is on `feat/connect-and-sync` in `C:\dev\allegra`. The source gates
  below passed; production release progress is recorded separately from local verification.
- Convex Connect and library functions were pushed to **dev** `charming-jaguar-140`
  (`cosmicgenius01/luvlyricsweb`) at `https://charming-jaguar-140.convex.cloud`. The live production
  deployment was subsequently updated to `neighborly-ocelot-786` from source commit `5abdde0`;
  the Vercel deployment from that commit was Ready. These are previous shipping evidence,
  not verification of the current reliability changes. The stable APK was not replaced.
- Connect works through authenticated Convex presence/state/commands. Web and Android provide player
  adapters for remote play, pause, seek, skip, volume, shuffle, repeat, and queue changes; transfer
  carries the current song, position, queue (up to 50), and playback settings. Failed/autoplay-blocked
  commands now report failure instead of acknowledging false success.
- Likes, playlists, recent plays, and taste signals sync through the Allegra API. The phone keeps
  SQLite as its local source of truth and retries its outbox after reconnecting. Account-backed Quick
  Picks use the same listening history on web and phone. Likes remain separate from downloads, and
  provider-qualified song refs/snapshots are retained across Saavn and Gaana.
- Choosing “Use my account’s library” removes phone-only likes and both local and stream-only entries
  from shared playlists, while preserving downloaded files. Same-ID playlists now adopt the account's
  membership exactly.
- Phone playback is mirrored on the website with the phone remaining the audio source. Remote
  position drives laptop lyrics, and recent-play history is published after five heard seconds.
- Feature-branch APK builds have read-only repository permissions. A separate publish job runs only
  on `main`, preventing a feature push from replacing `apk-latest` before production is ready.

## Verification

- `npm run typecheck`, `npm run lint`, and `npm test` — passed after the final sync fix.
- `npm run mobile:check` — passed: 68 suites, 534 tests. Mobile lint reports one pre-existing warning:
  unused `esc` in `apps/mobile/src/database/scanQueueQueries.test.ts`.
- `npx tsc --noEmit -p convex` — passed.
- `npm run build` — passed (Next production build and API build).
- `npm run contract-test` against `http://127.0.0.1:8080` — passed.
- `npx convex dev --once` — pushed successfully to the dev target above; `npx convex function-spec`
  confirmed the Connect and library functions and installed presence/rate-limiter components.
- `npm run e2e` — all 14 Playwright tests pass, including search suggestion → result Play → audio
  stream, pause/resume, navigation continuity, seeking, full-player controls, API health/search, and
  byte-range handling. The search test now exercises the actual UI: choosing a suggestion opens
  results, where the user explicitly starts playback.
- The E2E suite verifies the local web/API playback flow. It does not replace authenticated,
  cross-device acceptance on a signed-in web session and physical Android device.
- A local browser check confirmed the app shell renders. The host's `adb devices` list is empty, so
  no signed-in physical web + Android transfer or background-control run was possible here.

## Remaining boundaries

- The user-facing cross-device paths have code, backend, API, SQLite, and deterministic test coverage;
  a signed-in Google account on web and a physical Android install are still needed for live two-device
  acceptance (controls and transfers both directions, offline replay, and recommendation propagation).
- A phone must be online and active/in the background to receive Connect commands. Waking a closed app
  requires the planned v2 push path.
- Cross-platform outcome counters from PLAN T10 need a mobile analytics opt-out and shared sink; the
  existing web analytics preference alone is not consent for phone telemetry.

## Reliability follow-up: local scope (2026-10-01)

- Base commit `5abdde0`, branch `feat/connect-and-sync`. The current source includes the approved
  additive V2 command contract across shared session logic, Convex, memory transport, web and
  mobile. It adds request-id deduplication, server deadlines, ownership epochs and execution
  reservations. Transfers prepare the destination paused and activate it only after the old owner
  confirms pause. Legacy endpoints remain supported; fenced controls do not silently downgrade.
- Explicitly opted-in development traces remain local, bounded and payload-free. They are not
  production telemetry. Callback counts and JSON byte estimates do not measure backend query
  executions, transport framing, billed usage or battery.
- Latest local gates passed: `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`,
  `npm.cmd run mobile:check` (68 suites, 536 tests), `npx.cmd tsc --noEmit -p convex`,
  `npm.cmd run build`, focused mobile ESLint and `git diff --check`. The mobile lint reports one
  existing warning in `src/database/scanQueueQueries.test.ts`; the two warnings in edited files
  were removed. `npm.cmd run e2e` was not rerun for this slice.
- Local API health and `/discover` returned HTTP 200. The in-app browser still held a stale
  connection-error document, and browser policy blocked reopening it; this is not visual UI proof.
  No Android device is attached, and signed-in web-to-phone acceptance, transfer testing, and
  physical/background timing remain open. The synthetic sender-delay fixtures are not latency
  measurements. Do not mark all P0 or the full plan complete.
- No production deployment, merge, APK release or live backend mutation was performed. The
  unrelated `.mcp.json`, `mobile allegra.png`, Android crash logs and `output/` directory remain
  excluded from this feature change.

## Production incident and fixes (2026-10-01, evening)

- Vercel production ran `a8577af` while production Convex (`neighborly-ocelot-786`) still ran
  `5abdde0`. `connect:register` rejected `protocolVersion` (ArgumentValidationError, shown to
  listeners as a raw "Server Error"), so no device registered and the picker stayed empty; clients
  retried every second. Fixed by deploying Convex; `scripts/vercel-build.mjs` now deploys Convex
  first in production builds and needs `CONVEX_DEPLOY_KEY` in Vercel's Production environment.
- Every transfer then expired: the server's `take_over` state had no `ownershipEpoch`, the shared
  decoder required one and silently dropped the command, so the target never called `beginV2`.
  The server now sends the epoch (fixes installed `a8577af` APKs) and the decoder no longer
  requires it. `MemoryTransport` hid this by sending the full live state; it now sends the server's shape.
- The sender gave up 4 s after a transfer or load even while the target was still loading.
  `outcomesFor` now marks a reserved command `began`, and the sender then waits to the deadline.
- Session errors without a coded payload show fallback copy, never a raw Convex message;
  registration retries back off from 1 s to 30 s.
- Deployed to production Convex: the epoch and `began` changes. Not yet shipped: the web picker
  redesign (`ConnectPicker.tsx`, also opened from the mini player), the phone's round Connect
  button, and the client-side decoder/session fixes — they need a Vercel deploy and a new APK.
- First live two-device run (17:46–18:02 IST): controls and a web → phone transfer worked. Two
  phone "play here" pulls expired because Chrome, the owner, had left Connect: the web's leader
  lock was requested with `ifAvailable`, so an effect re-run (token refresh) lost the lock to its
  own previous run and the tab demoted itself to "another tab" for good while its audio played.
  The lock request now waits in line (aborted on cleanup). Production logs show it as one
  `connect:state` execution where two subscribers were expected.
- A phone → web transfer then failed `not_found` after 16 s. The web's Connect load checked the
  audio element before the render switched its source, so it could seek the previous track; it
  now waits for the new source (`loadstart`) and restarts a failed element. Exact cause of that
  run not reproduced.
- A destination now waits at most 15 s for the owner's release, then fails `owner_unreachable`
  and the phone names the device that did not answer.
- The in-app updater compares `apk-latest` with the build commit/time CI stamps into each APK and
  never offers an older build (all builds are versionCode 1).

## Queue editing, leaving, and dead owners (2026-10-01, night)

Branch `feat/connect-queue-and-takeover`, from `main` at `d8253ed`. Not committed, not deployed.
It closes the gaps a checklist review of Connect against Spotify Connect's behaviour found.

- **Protocol 3 (additive).** New commands `queue_remove`, `queue_move`, `queue_clear`; `queue_add`
  takes `next` (play next) and `more` (the rest of an album in one command); `play_song` takes
  `positionSec`. A protocol 2 device is never sent the three new kinds (`update_required`), and
  reads the extended `queue_add` as a plain add. `ConnectView.queueEditable` tells a UI when to
  hide the edit controls.
- **Leaving.** New `connect:disconnect`. A session calls it when it stops listening, on a closing
  web tab (`pagehide`) and before sign-out on both clients (`signOutHooks`), so a device is offline
  at once instead of 150 s later; a playing owner that leaves is stored as paused where it was.
- **Dead owner (contract change, see `docs/connect-contract.md`).** `prepareV2` no longer waits for
  a playing owner that Presence counts offline: the destination takes over where the song would
  have reached. The remaining wait is the 150 s Presence needs to notice a device that died
  without saying goodbye; inside that window "play here" still fails `owner_unreachable` after
  15 s. Taking over from an owner that is online but silent was left as it was.
- **One queue path on both clients.** `packages/connect/src/queueStager.ts` hands a player its
  queue: known songs move at once, new ones join when their lookup lands, and songs past the 50
  other devices are shown are kept. The web reported every other song in the list as "queued"
  (songs before the current one included); it now reports what plays after it, as the phone does.
  The phone keeps the ref a song was matched for (`aliases`), so a download with no recorded
  origin no longer drops out of the shared state.
- **Phone.** `StreamService.playNext` and `append` go to the device that is playing (they used to
  replace its song, or edit the phone's own queue silently). The remote player's queue sheet has
  play-next, remove and clear. The device sheet can rename the phone and says when the device
  that was playing has gone offline.
- **Web.** The song sheet has Play next and Add to queue; the Playing Next panel has play-next,
  remove and Clear; they work signed out too. The bar's seek slider acts on release (one seek per
  drag) and a remote volume is sent on release. The picker can rename the browser. The first tap
  in a tab with no song loaded plays half a second of silence so Safari will later start a
  transferred song without a tap.
- **Verified here:** `npm run typecheck`, `npm run lint`, `npm test` (shared 65, Convex 14, web
  61, API 190), `npx tsc --noEmit -p convex`, and the phone's `tsc`, `eslint` and `jest` (69
  suites, 545 tests). In a browser on :5173, signed out: play next, add to queue, remove, move,
  clear, and one `seeking` event per slider drag with playback carrying on.
- **Not verified:** nothing signed-in. No two-device run, no Android device, no Safari (the audio
  unlock is untested where it matters), no `npm run e2e`, no `convex dev` push. The web adapter's
  Connect path (`load`, `setQueue`, the goodbye on `pagehide`) is covered only through the shared
  unit tests.
- **Deploy order:** Convex first (`scripts/vercel-build.mjs` already does this for production).
  A new client against the old backend cannot send the new kinds: the validator rejects them and
  the client retries for a minute. An old client against the new backend is unaffected.
- **Still open from the checklist:** per-action restrictions beyond `canPlay` and `queueEditable`,
  a stored album/playlist context, push to wake a closed phone app, and drag-to-reorder in the
  remote queue (move-to-next is the only reorder).

## Important files

- Contract: [`../../docs/connect-contract.md`](../../docs/connect-contract.md)
- API seam: [`../../docs/api-contract.md`](../../docs/api-contract.md)
- End-to-end architecture: [`../../docs/architecture.md`](../../docs/architecture.md)
- Implementation plan and task state: [`PLAN.md`](./PLAN.md)
- Proposed reliability/performance follow-up: [`IMPROVEMENT-PLAN.md`](./IMPROVEMENT-PLAN.md)
- Decisions and verification checkpoints: [`DECISIONS.tsv`](./DECISIONS.tsv)

Keep `.mcp.json` and `mobile allegra.png` untouched; they are intentional untracked files in this
checkout. Do not deploy production from this dirty working tree.
