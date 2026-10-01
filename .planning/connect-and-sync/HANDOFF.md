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

## Important files

- Contract: [`../../docs/connect-contract.md`](../../docs/connect-contract.md)
- API seam: [`../../docs/api-contract.md`](../../docs/api-contract.md)
- End-to-end architecture: [`../../docs/architecture.md`](../../docs/architecture.md)
- Implementation plan and task state: [`PLAN.md`](./PLAN.md)
- Proposed reliability/performance follow-up: [`IMPROVEMENT-PLAN.md`](./IMPROVEMENT-PLAN.md)
- Decisions and verification checkpoints: [`DECISIONS.tsv`](./DECISIONS.tsv)

Keep `.mcp.json` and `mobile allegra.png` untouched; they are intentional untracked files in this
checkout. Do not deploy production from this dirty working tree.
