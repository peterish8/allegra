# LuvLink backend and web status

Updated 2026-10-06. Backend/web checkpoint for continuation. The project checklist and mobile status live in the sibling worker's files.

## Shared contract

- Product name is LuvLink. Types live in `packages/shared/luvLink.ts`; current public API details are in `docs/luvlink-contract.md`.
- First-party transport is `convex-v1`; Echo remains `echo-legacy` compatibility.
- Listen mode lets each member use local audio. Speaker mode has one elected output (`leaderUserId`); approved controllers can submit intents. `leaderEpoch` and playback sequence fence stale writes. Transfer waits for old-output pause acknowledgement.
- Playback anchors carry intent, author, applied sequence, track epoch, queue entry, barrier state and server timestamps. Queue consumption is atomic with playback commit. New-track readiness uses a scheduled four-second deadline. Presence is separate from room/playback subscriptions.
- Group-pick APIs: `setSuggestionsConsent({ roomId, enabled })`, `getGroupPicks({ roomId })`, `refreshGroupPicks({ roomId })`; member snapshots include `canSuggest`. Web binds the shelf; mobile can ignore the optional field.
- Web routes: `/luvlink`, `/luvlink/join/:code`, `/luvlink/room/:id`. Link origin uses `NEXT_PUBLIC_WEB_ORIGIN` or the current HTTPS origin; plain HTTP is allowed only for localhost.

## Implemented by backend/web

- `convex/schema.ts`, `convex/luvLink.ts`: 8 core room tables plus a bounded recommendation cache; auth and active-membership checks, room/member/queue caps, hashed expiring/revocable invites, idempotent ordered queue commands, fenced playback, scheduled ready deadline, speaker handoff ACK, separate Presence, server clock mutation, cleanup, consent-gated recommendations.
- `convex/luvLink.test.ts`, `convex/account.test.ts`, `convex/account.ts`, `apps/api/src/db/convex.ts`, `apps/api/src/user/store.ts`, `apps/api/src/routes/account.ts`: room tests plus account export and erasure integration.
- `packages/shared/luvLink.ts` and `packages/shared/luvLink.test.ts`: package-free protocol, clock estimation and projection helpers; existing Blend scorer is reused.
- `apps/web/src/components/luvLink/LuvLinkPage.tsx`, `apps/web/src/components/luvLink/playerEcho.ts`, `apps/web/src/lib/luvLinkPlayerEcho.test.ts`, `apps/web/src/lib/routes.ts`, `apps/web/src/lib/routes.test.ts`, `apps/web/.env.example`: create/join/invite/room route, separate subscriptions, auth/sign-in return path, existing player integration, queue/host controls, autoplay Tap to Listen, invite sharing, consent and cached group-pick shelf. Applied playback is keyed by room, leader epoch and sequence so the elected output does not republish its own incoming anchor when the local song changes.
- `apps/web/src/App.tsx` and `apps/web/src/styles/app.css` contain LuvLink hunks mixed with unrelated existing performance work. Keep unrelated changes out of any feature-only review/commit. `apps/web/src/CommandPalette.tsx` is unrelated.
- `docs/luvlink-contract.md` documents implemented behavior, privacy checks, caps and physical-sync limits.
- `convex/connect.ts` has two explicit `outcome.ok === false` checks to repair baseline discriminant narrowing (no behavior change).
- `package.json` changes `convex:test` to `vitest run --maxWorkers=1`. Default parallel runs repeatedly timed out unrelated Connect/account/taste tests at the existing five-second limit; the same full Convex set passes serially in about 11 seconds. No timeout was increased and no tests were omitted.

## Validation evidence

- `npm.cmd run typecheck`: exit 0 (latest root run before the test-runner-only script edit).
- `npm.cmd run lint`: exit 0 (latest root run before the test-runner-only script edit).
- Focused Convex `npx.cmd vitest run convex/luvLink.test.ts convex/account.test.ts`: exit 0, 2 files / 23 tests.
- `npx.cmd tsc --noEmit -p convex/tsconfig.json`: exit 0 after group-pick changes.
- `npx.cmd tsc --noEmit -p apps/web/tsconfig.json`: exit 0 after generated API and group-pick changes.
- Required `npm.cmd test`: latest run exits 0 after serializing Convex Vitest. API, web, Connect, shared, infra, and Convex all passed; shared 142/142, infra 20/20, Convex 7 files / 78 tests plus 4 auth-redirect tests. Full output: `.planning/luvlink/validation/root-test-serialized.log`.
- Prior parallel Convex gate failures were timeouts only; serial rerun passed 7 files / 78 tests. Logs: `.planning/luvlink/validation/root-test.log`, `root-test-rerun.log`, and `convex-serial.log`.
- `npx.cmd convex dev --once`: exit 0, “Convex functions ready!” in 12.61 seconds on the configured development deployment, project `luvlyricsweb`, alias `dev/cosmic-genius`, deployment `charming-jaguar-140`. It printed an AI-files-out-of-date notice. No production deployment.
- After the web self-echo guard: `npm.cmd test --prefix apps/web` exits 0, 127/127 tests including the 3 new playback-echo checks; `npm.cmd run typecheck --prefix apps/web` exits 0; `npm.cmd run lint --prefix apps/web` exits 0. Root `npm.cmd test` had passed immediately before this web-only patch; the patch is covered by the web workspace test/typecheck/lint.
- Mobile's current owner reports `npm.cmd run typecheck --prefix apps/mobile` green, 37 routing tests, and the first-party sync Jest suite green (1 suite / 4 tests, 180.508 seconds). The sibling is still implementing standalone LuvLink screen/settings/deep-link behavior; do not claim full mobile completion from those focused checks.
- In-app browser only: CUA returned “Browser is not available: iab” after a clean reset and an IAB tab request. Earlier Opera viewing was explicitly excluded and is not proof. No alternate browser was used after the restriction. No signed-in browser, physical device or cross-device audible-sync proof.

## Review findings and open work

- Read-only mobile review found remote anchor track loads call `setPlaylistQueue('luv-link', ..., false)` at `apps/mobile/src/services/luvLink/sync.ts` lines 138, 145, 157 and 200 without `withoutOwnedRoomRouting`. `playerStore.setPlaylistQueue` then calls `requestPlayback(false)`, which is routed as a shared control intent. This can publish a pause while applying a remote track. The finding was sent to mobile/root with a request for routing suppression and a no-self-commit readiness test; no mobile-owned file was edited here. Re-review the fix and resulting test before final.
- Web review found and fixed the elected-output self-echo: an incoming controller anchor could change the leader's `currentSongKey` and trigger a second control mutation. The player effect now matches the remote application marker by room, epoch, sequence and song ref. Tests prove that the same applied anchor is suppressed, a later different song remains publishable, and epoch/sequence changes fence the marker. These are logic tests, not a rendered browser test.
- Clock helper keeps up to the three least-queued samples and rejects invalid RTT/time samples; this is an offset estimate, not measured physical drift correction.
- Recommendation builder uses at most 25 learned-song rows per opted-in member, 8 members and 12 cached picks. It reads no taste rows on playback queries. Cache is removed on consent withdrawal, queue/member changes, room close/expiry and account erasure; query suppresses members who later opt out globally. One-minute refresh throttling may delay rebuilding after invalidation but cached privacy-sensitive rows are deleted immediately.
- Speaker handoff fails closed if the former output never confirms pause. The first-party web/mobile sync still needs rendered/live and device evidence beyond unit tests.

## Skill cleanup and scope review

- Ponytail pass: kept existing Convex, Presence, rate limiter, player and Blend scorer; added no package, audio relay, wrapper factory or extra framework. Preserved required auth, bounds, idempotency, readiness and epoch fencing.
- Unslop pass: docs describe concrete behavior and limitations; no speculative efficiency claims.
- Caveman applies to progress messages only; product copy remains in normal product voice.
- Feature manifest includes the owned backend/web/shared/API/docs files listed above plus `convex/crons.ts`, `convex/_generated/api.d.ts`, `package.json`, and focused validation artifacts. `apps/web/src/App.tsx` and `apps/web/src/styles/app.css` are mixed-hunk files; preserve unrelated existing performance edits. Do not stage broad `git add .`.
- No new `any` in the implementation. No production deploy, push or PR publish.

## Next exact steps

1. Recheck the mobile remote-load routing fix and its focused test after the sibling replies; do not edit its files.
2. Re-run root `npm.cmd test` only if the integrated source changes beyond the current web-only patch; its previous full pass is recorded above, and the affected web workspace gates are green after this patch.
3. Review fresh mobile UI/deep-link changes read-only and send any actionable issues to the sibling/root.
4. Keep IAB/device evidence explicitly unavailable unless the Codex in-app browser becomes available. Do not substitute another browser.
5. Refresh this file and `.planning/luvlink/PR-DRAFT.md` before handing back; mobile worker maintains `.planning/luvlink/CHECKLIST.md`.
