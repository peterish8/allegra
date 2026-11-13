# Task card FINAL: Final verification and report (orchestrator)

| Field | Value |
|---|---|
| Model | orchestrator |
| Branch | `n/a` |
| Merge mode | n/a |
| Depends on | everything merged or parked |
| Size | S |

Read `../WORKER-PROTOCOL.md` first, then this card. The authoritative spec is `../../PLAN-v2.md`; read the whole entry named below before you start.

## Spec
PLAN-v2 §9 (success criteria per phase, definition of done), §10 risks.

## Do
1. `git fetch`; on a clean worktree of `origin/main` run `npm run typecheck`, `npm run lint`, `npm test` (then, separately, `npm run mobile:check`), and `E2E_CHANNEL=msedge npm run e2e`.
2. Re-run the guard counts (Appendix B commands) and fill the "After" column in `LEDGER.md` next to the "Before" numbers.
3. Confirm no worker left a Turbopack-root edit, stray `.env` change, junction damage, or raised baseline on `main`. Grep `main`'s new commits for playback tokens in polish PRs.
4. Update `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md` with the mobile items now merged and the phone items still pending.
5. Final message: what merged (PR links, versions), before/after numbers, parked PRs (W9, P6, any HOLD), decisions made on the owner's behalf, what remains unproved, the owner phone checklist from `OWNER-TODO.md`. Then stop.
