# Allegra audit remediation and integration plan

Status: active. Findings below are audit leads unless a test or deployment is explicitly identified. Do not claim release readiness from source review alone.

## Baseline and ownership

- Before integration fetch remotes; record exact main, migration branch, agent commit SHAs, worktree status, and PR checks. Current checkout has pre-existing edits in `convex/authRedirect.ts` and `tests/convex/authRedirect.test.ts`; preserve and review them separately. Do not reset or overwrite unrelated work.
- The main checkout also contains an uncommitted LuvLink queue-control patch and regression test in `convex/luvLink.ts` and `convex/luvLink.test.ts`. A focused regression first failed with `queue_item_missing`, then all 11 LuvLink tests and Convex typecheck passed after the patch. Opus must review and incorporate or improve it, not assume it is in its isolated checkout.
- Web LuvLink is assigned to Sonnet 5.5 in a separate checkout. Backend audit remediation is assigned to Opus 5.5. Documentation/index work has a separate agent commit. A previous Spotify agent was stopped during reassignment; preserve its checkout and inspect its work before reuse. Avoid overlapping ownership or concurrent edits to the same files.
- Read `AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`, `docs/api-contract.md`, `docs/luvlink-contract.md`, `.planning/ROADMAP.md`, `apps/mobile/CLAUDE.md` when relevant, and `convex/_generated/ai/guidelines.md` before Convex work. Use Graft for code discovery. Contract changes require proposal and coordinated clients.

## 1. LuvLink end-to-end

Backend: inspect `convex/luvLink.ts`, `convex/luvLink.test.ts`, `convex/schema.ts`, and `packages/shared/luvLink.ts`. Correct current-track controls after a queue entry is consumed; reject stale or unauthorized queue reuse. Resolve speaker handoff/mode-transition deadlock without allowing duplicate active output, and cover offline old speakers and member departure. Maintain permission checks, leader and sequence fencing, idempotency, barrier semantics and bounded resource usage. Review read invalidations and write cadence; benchmark before claiming savings.

Web: move session lifecycle, presence, playback watches and routing to app scope while preserving the single layout-owned audio element. Apply authorized controller anchors at the leader; calculate current position at command time; handle source loading, readiness, drift and retry. Test navigation, permissions, queue, play/pause, seek, reconnect and two simultaneous controllers.

Mobile: verify automatic queue advance, asynchronous song-resolution echo guards, failed-resolution retry, background presence, reconnect and player routing. Preserve native and React Native fallback behavior. Validate on real participants across web/mobile in listen and speaker modes; autoplay, offline handoff and audible sync require runtime proof.

## 2. Spotify transfer

Backend: inspect `convex/spotify.ts`, `convex/spotifyCron.ts`, `apps/api/src/services/spotifyTransfer.ts`, `apps/api/src/db/spotifyStore.ts`, `apps/api/src/providers/spotify.ts`, relevant tests and `docs/api-contract.md`. Remove starvation beyond first 100 accounts and first five playlists using bounded durable pagination and fair continuation. Preserve retryable failures and provider retry hints. Fence multi-batch disconnect cleanup from reconnect/new credentials and in-flight jobs. Test limits, continuation, retry, idempotency, concurrent reconnect and schedule failures. Confirm deployment/schema migration compatibility.

Clients: verify pause/partial completion refresh and distinguish unknown counts from empty playlists. Validate against an authenticated Spotify account where available.

## 3. Blend and listening history

Backend: review `apps/api/src/services/blendBuild.ts`, `convex/blends.ts`, and tests. Propagate cancellation to supported provider calls, fence late results, retain privacy and safe stale fallback, and measure work before/after. Verify history timestamp, replay and idempotency behavior in `apps/api/src/user/actions.ts` and routes.

Frontend: verify Blend source-qualified identity, likes, sign-in/retry/refresh and stale-member filters. Trace recently played across manual selection, auto advance, DJ, LuvLink and Connect; define heard threshold and idempotency with product-consistent history semantics. Test mobile and web behavior.

## 4. DJ and performance

Profile web DJ idle/active rendering before optimizing; review animation lifecycle and offscreen activity on mobile. Fix demonstrated UI and accessibility issues while retaining reduced-motion behavior. Record baseline and after measurements on comparable hardware; static evidence is not a performance claim.

## 5. Branches, migration and delivery

Inventory all local/remote branches and worktrees with exact refs and patch equivalence. Integrate only reviewed unique work; never assume stale branches are merged because histories differ. Examine `origin/perf/mobile-player-responsiveness` and its latest handoff, CI, mobile version and Kotlin changes. Reconcile conflicts deliberately; retain fallback UI and complete device/gesture/accessibility checks. Preserve unrelated dirty files and do not delete branches or worktrees without verifying their contents and ownership.

Integrate each tested slice in dependency order onto a fresh, current integration base. Resolve real conflicts and rerun affected tests; nobody can guarantee zero future conflicts. Incorporate the documentation agent's commit only after review, and refresh Graft on the final integrated code using supported commands. Resolve or safely preserve original dirty auth changes separately; a clean integration tree is not proof that every existing checkout is clean.

## 6. Acceptance

- Scoped regression tests plus root typecheck, lint, tests, Convex checks and mobile checks; sync generated shared files when applicable, obey Convex generation/deploy rules and bump mobile version when required.
- Browser checks for user-visible web changes; real or explicitly reported unavailable two-device/audio, Android, Spotify OAuth and performance checks.
- Review final diff, contract/schema and security implications; all intended commits recorded and clean relevant worktrees. Run appropriate CI and non-author review per repo rules.
- User requested eventual push to main. Only deliver after required work and checks are complete; verify exact remote base and push without force, then verify CI/deployment and report actual SHA, test results and limitations. No claim of merged, deployed or device-validated work without evidence.
