Copy everything below the line.
---
Continue Allegra in C:/dev/allegra only when the user has resumed the stopped work. Shared checkout is fix/web-auth-dialog-focus at 8a084c07 and DIRTY; never pull/reset/stash/checkout it. Goal: finish existing PR integration and unfinished polish/backend work, implement the Stream logo updates dropdown, publish verified release updates and safely clean completed worktrees.

Read in order:
1. C:/dev/allegra/.planning/frontend-polish/run/HANDOFF-2026-11-14-credit-stop.md
2. C:/dev/allegra/.planning/frontend-polish/run/pause-2026-11-14/worktrees.json, pull-requests.json, apk-release.json, agent-reports.json
3. docs/current-codebase.md, CLAUDE.md, AGENTS.md, apps/mobile/CLAUDE.md, apps/mobile/DESIGN.md, apps/mobile/src/ui/AGENTS.md
4. .planning/frontend-polish/PLAN-v2.md, run/WORKER-PROTOCOL.md, LEDGER.md, OWNER-TODO.md, relevant tasks
5. .planning/echo-backend-port/README.md and applicable individual plans.
Do not rely on earlier conversation or stale ledger rows.

Owner authorized pushes, regular merges after green checks, version bumps and safe cleanup. Latest instruction stopped every agent for credits. Do not restart agents or watches merely from this prompt; begin work after explicit resume. No local Gradle/emulator. Use saved threads for context, not fresh agents to repeat reports.

Work order after resume:
1. Refresh main, PR and release snapshots. Last verified main 6a7873a5/source 1.64.5; published APK 1.64.3.
2. Finish #123 at 88c69ef3/version 1.64.6 if main hasn't moved; checks fresh on exact head. Then #126/#127/#128/#130/#131 serially; feature minor/fix patch bumps after final rebase.
3. Finish committed M1 c6b9f1fe and dirty grouped M2/M3/one Devices sheet; reconcile older dirty mobile-lane ConnectDropdown before any discard.
4. Implement Stream request in preserved t3/stream-updates-dropdown worktree: remove Stream explanation; Devices LEFT, rounded LuvLyrics logo RIGHT; updates-only token-styled dropdown with real latest release notes always visible even after update, proper safe installer/status and accessible dismissal/scrolling.
5. Audit discovery old branch for genuine unique patches; clean merged #129 worktree safely; keep M12/W9/P6 HOLD and #84 open.
6. Finish remaining frontend AUTO cards, backend plan slices and FINAL/end review per handoff. Do not redo already merged slices.
7. Record release publication separately and preserve all untracked planning files.

Per code slice run required root typecheck/lint/tests, sync:shared where needed, mobile:check after Convex tests, and final-head CI APK/emulator gates. No baselines may increase. Never claim phone/TalkBack/audio/browser-cut/frame-rate proof from tests or CI. Link after every create/push; watch only for authorized active PR waits, never poll.
Ask once only if an unresolved choice lacks a handoff default; otherwise follow defaults and continue within approved scope. Keep updates concise and report exact head, checks, source/release version and remaining gaps. Preserve unrelated dirty files. No AI attribution footers.

