Copy everything below the line into a new T3 Code thread (start it in `C:/dev/allegra`).

---

# Task: execute the Allegra frontend polish plan, autonomously, with parallel workers

**Full send.** I am away and will not read this thread until you are done. You are the **orchestrator** of the whole plan in `@.planning/frontend-polish/PLAN-v2.md`. You own the run from now until every card is merged or parked. Use the T3 method from my downloaded skills: `full-send`, `full-stop`, `sol-loop`, `file-pr`, `babysit-pr`, `leaving-pr-comments`, `council`, `modernize`, `takeover` (paths in PLAN-v2 §4a). Open and follow those SKILL.md files by path.

Project: **Allegra** (GitHub `peterish8/allegra`): web in `apps/web` (Next.js 16, React 19, Tailwind v4, Motion), Android app **LuvLyrics** in `apps/mobile` (Expo SDK 54, RN 0.81). Frontend only. No API, Convex, desktop or playback-engine changes.

## 1. Read first, in this order

1. `@CLAUDE.md`, `@apps/mobile/CLAUDE.md`, `@apps/mobile/src/ui/AGENTS.md` (hard rules)
2. `@.planning/frontend-polish/run/00-ORCHESTRATION.md` (your operating manual: slots, Step 0, the loop, merge policy, reviews, reporting)
3. `@.planning/frontend-polish/run/01-ASSIGNMENTS.md` (which model does which card, dependencies, merge mode, dispatch order, conflict map)
4. `@.planning/frontend-polish/run/WORKER-PROTOCOL.md` (the rules every worker follows; you enforce them)
5. `@.planning/frontend-polish/PLAN-v2.md` (the plan: keep list §3, skill-vs-Allegra table §4, **skill locations §4a**, inventory §5, findings §6, work breakdown §8, done criteria §9, risks §10, Addendum A)
6. `@.planning/frontend-polish/run/LEDGER.md` and `@.planning/frontend-polish/run/OWNER-TODO.md` (you keep these current)
7. The task cards: `@.planning/frontend-polish/run/tasks/` (one file per card, 29 files: P1, W0, W1, W2, W3, W4, W5, W6, W7, W8, W9, W11, M0, M1, M2, M3, M4, M5, M6, M7a, M7b, M8, M9, M10, M11, M12, P5, P6, FINAL). Hand each worker only its own card plus the protocol.

## 2. End result

When you finish: every AUTO card is merged to `main` with green CI; HOLD cards (W9, P6, and M12 if its evidence gate fails) are open, ready and unmerged; the web CSS guard and the five new mobile ratchets exist and their baselines only fell; and my taste is intact (clear frosted glass, subtle glow, icon-only buttons, white-only mobile accent, no clutter, no dark veils). It includes the two requests I added: **Library playlists grid/list toggle** on web (W11) and mobile (M11), and **the mobile Albums tab investigated, then removed or fixed** (M12, Addendum A.3).

## 3. Who does the work

| Worker | Model | Effort | Cards |
|---|---|---|---|
| **Luna** | GPT-6 Luna | xhigh | W0, M0, W1, W2, M1, M2, M10, M12, P5, P6 |
| **Sonnet** | Claude Sonnet 5.5 | high | P1, W3, W4, W5, W6, W7, W8, W9, W11, M3, M4, M5, M6, M7a, M7b, M8, M9, M11 |

- Resolve exact model ids with `orchestrator_capabilities`; never hardcode or substitute. If one is missing, ask me through the question tool and wait.
- **Never more than 3 workers running at once** (Luna and Sonnet together). Start the first three cards (P1, W0, M0), then refill slots in the dispatch order of `01-ASSIGNMENTS.md` as cards merge. Skip ahead when a dependency blocks.
- Each worker is its own thread in its own git worktree, branch cut from `origin/main`, and it owns its own PR: AUTO cards run `full-send` (merge at the merge gate), HOLD cards run `full-stop` (never merge). Reviews are by GPT Sol via `sol-loop` for every code PR (3 rounds max); W1 and M1 also get `council`. If your harness can only delegate, use `delegate_task` for implementation and own the PRs yourself.
- A card that fails twice moves up a model (`escalating-agent-models`), then is taken over (`takeover`). Diagnose with `recovering-agent-failures`; refresh stale PRs with `modernize`; conflicts via `resolving-merge-conflicts`.

## 4. Method (Theo's T3 stack principles on this repo)

Small narrow modules, one job each; strict TypeScript, no `any`; one contract per feature; no second stack and no new dependency; ship small vertical slices with tests; deployable at every merge. Per card: reproduce or measure first, regression test that fails on the old code, smallest change, proof you observed yourself, Sol review, `file-pr`, `babysit-pr`, merge or park. Verify worker reports against the diff yourself (`verifying-agent-work`, `cross-checking-agent-work`); never trust a report.

## 5. Skills

Design and motion skills are listed with absolute paths and the sections to read in PLAN-v2 §4a and in each card (`charles-unslop`, `charles-polish`, `charles-ux-animation`, `charles-unreasonable-craft` as craft-lite, `unslop-ui`, `cinematic-ui-motion`, `motion-animate-ux-stack`, `micro-interactions`, `web-animation-design`, `frontend-design-fidelity`, `accessibility-tester`, `expo-react-native-expert`, `building-native-ui`, `vercel-react-native-skills`, `vercel-react-best-practices`, `tailwindcss-mobile-first`, `web-design-guidelines`, `tdd`, `systematic-debugging`). Workers must open the files named in their card. Not used: `charles-accent-heroes`, `charles-store-screenshots`, `charles-arcade-motion`, `charles-claude-editing`. Use the code graph (`graft`) before grep.

## 6. Constraints (do not break; they apply to every worker)

- **Owner decisions beat every skill default.** PLAN-v2 §3 (keep list) and §10 (do-not-do) are law. Never delete or flatten glass, glow, shader, cover wash, DJ mascot or Blend orbs; never change lyric line wrapping. Unslop only produces a list for me; nothing visual is removed without my yes.
- **Motion:** animate `transform` and `opacity` only; every duration, easing, colour and font size from tokens; reduced motion collapses to opacity and never removes a feature.
- **Playback invariants:** all play/pause through `requestPlayback`; load effects never depend on `isPlaying`; a seek pauses then resumes; the single `<audio>` stays in the layout. No polish PR touches `useAudioPlayer`, queue code, lyric glide maths or sheet physics.
- **Guards:** a baseline may only fall. Never run an `UPDATE_*_BASELINE` command to make room.
- **Mobile:** use `apps/mobile/src/ui` primitives, 48 dp targets, white-only accent, no new glass buttons, sentence case, no emoji. Every PR that rebuilds the APK bumps `expo.version` (patch for fixes, minor for features) after the final rebase, right before its merge; one mobile merge at a time. A mobile merge publishes the APK from `main`, so it needs green CI, the launch gate and the player probe.
- **Commits:** conventional, no AI attribution footers (repo rule). PR descriptions follow `file-pr` and end with `Created with <model> in T3 Code.`. Every PR comment follows `leaving-pr-comments`.
- **Edit code with the Edit tool**, never script rewrites. Do not add dependencies; do not edit lockfiles; the only install allowed is the one in card P1 (`npm install --prefix C:/Users/nithy/.claude/skills/charles-unreasonable-craft/scripts`).
- **Windows safety:** extra worktrees use junctioned `node_modules`. Before removing anything recursively list reparse points and `cmd /c rmdir` each junction first; never `git worktree remove --force`; never delete worktrees or branches without asking me. Back up untracked `.env*` first. `C:` was at 99% (about 19 GB free): do not create a real `node_modules` per worktree; if free space drops under 10 GB, stop and tell me.
- **Ports and devices:** slot 1 web :5173 / API :8080, slot 2 :5174 / `ALLEGRA_DEV_API_PORT=8081`, slot 3 :5175 / 8082. One Android emulator and one Gradle build at a time; local Android builds are unreliable, so mobile proof is the CI APK plus the emulator. Test browser behaviour on the web dev server, never an API port.
- **Evidence:** never claim device, TalkBack, performance or HEVC results from CI or an emulator; add them to `OWNER-TODO.md` as pending. Do not claim something works unless you ran it.

## 7. Defaults for the plan's open questions (apply them; tell me what you chose)

Q1 keep and fix `YtMiniPlayer`. Q2 keep the orbit loops and DJ tour notes (tokenise timings only). Q3 no copy changes (states only). Q4 web may transition `color`, `background-color`, `border-color` at 100-160 ms, never `box-shadow` or `filter`; mobile animates no colour. Q5 craft-lite (the real `interface-craft` skill is not installed). Q6 batch my phone checks in `OWNER-TODO.md`. Q7 assume other mobile work exists and re-check `git log origin/main -- <files>` before every mobile card. Library toggle: default grid, remember the choice. Albums: investigate first; default is to remove the tab, with a saved `Albums` start tab loading as `Songs`.

## 8. Step 0, then go

Do Step 0 from `00-ORCHESTRATION.md` §3 yourself: branch `docs/frontend-polish-run` from `origin/main`, commit only `.planning/frontend-polish/` (the plan and this run kit are currently uncommitted files in `C:/dev/allegra`), `file-pr`, `babysit-pr`, merge; add the captures `.gitignore`; record tool checks and the defaults at the top of `LEDGER.md`. Then dispatch P1, W0 and M0 and run the loop. Keep `LEDGER.md` current after every state change.

## 9. Asking me

Only through the harness question tool, only for the cases in `full-send` "Asking the user", and batched. Everything else: pick the plan's default and record it. If a question tool gives no answer, take the safe path: leave the PR open and unmerged.

## 10. Reporting

After each merge, one ledger line. When every card is merged, parked or dropped, run the `FINAL` card and finish with one message: PR links and versions of everything merged, the guard numbers before and after, what is parked for me (W9, P6, any HOLD) and why, decisions you made on my behalf, what remains unproved, and my phone checklist from `OWNER-TODO.md`. Then stop. Do not start new scope.
