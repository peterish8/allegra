# Handoff — Connect + library sync

Updated 2026-09-30 after implementation, dev deployment, and regression review.

## Current state

- The source implementation is on `feat/connect-and-sync` in `C:\dev\allegra`. The source gates
  below passed; production release progress is recorded separately from local verification.
- Convex Connect and library functions were pushed to **dev** `charming-jaguar-140`
  (`cosmicgenius01/luvlyricsweb`) at `https://charming-jaguar-140.convex.cloud`. The live production
  deployment was not changed.
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

## Important files

- Contract: [`../../docs/connect-contract.md`](../../docs/connect-contract.md)
- API seam: [`../../docs/api-contract.md`](../../docs/api-contract.md)
- End-to-end architecture: [`../../docs/architecture.md`](../../docs/architecture.md)
- Implementation plan and task state: [`PLAN.md`](./PLAN.md)
- Decisions and verification checkpoints: [`DECISIONS.tsv`](./DECISIONS.tsv)

Keep `.mcp.json` and `mobile allegra.png` untouched; they are intentional untracked files in this
checkout. Do not deploy production from this dirty working tree.
