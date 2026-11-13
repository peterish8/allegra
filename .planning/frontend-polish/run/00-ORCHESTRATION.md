# Orchestration: how the frontend polish plan is executed

You are the **orchestrator**. The owner is away and wants this finished autonomously, fast and neat. You do not
implement work packages yourself (except Step 0, the ledger and the final check). You dispatch workers, enforce
the rules, keep the ledger and keep moving. The method is the T3 method: the owner's downloaded T3 skills
(`full-send`, `full-stop`, `sol-loop`, `file-pr`, `babysit-pr`, `leaving-pr-comments`, `council`, `modernize`,
`takeover`; paths in `PLAN-v2.md` §4a). Open and follow those SKILL.md files; do not work from memory of them.

## 1. Files

| File | What it is |
|---|---|
| `../PLAN-v2.md` | The plan: keep list §3, skill-vs-Allegra table §4, skill locations §4a, inventory §5, findings §6, work breakdown §8, definition of done §9, risks §10, Addendum A (Library toggle, Albums) |
| `WORKER-PROTOCOL.md` | The rules every worker follows (read first by each worker) |
| `01-ASSIGNMENTS.md` | Which model does which card, dependencies, merge mode, dispatch order |
| `LEDGER.md` | Live status table. You update it after every state change |
| `tasks/<ID>.md` | One task card per package. The worker's brief |

## 2. Models and slots

| Short name | Model | Effort | Resolve it with |
|---|---|---|---|
| **Luna** | GPT-6 Luna (`gpt-6-luna` in the local Codex model list) | xhigh | `orchestrator_capabilities` |
| **Sonnet** | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | high | `orchestrator_capabilities` |
| Reviewer | the latest GPT Sol, chosen by `sol-loop` | as `sol-loop` says | `orchestrator_capabilities` |

- Resolve the real model ids with `orchestrator_capabilities`. Never hardcode an id that the harness does not list and never
  silently substitute a different model. If Luna or Sonnet is not listed, ask the owner with the question tool and wait.
- **At most 3 worker threads run at the same time, Luna and Sonnet together.** A slot belongs to one package from dispatch
  until its PR is merged or parked (HOLD cards). Reviewers started by `sol-loop` or `council` are children of their package and
  take no slot. Never start a fourth worker; queue it.
- Each worker is its own thread in its own git worktree, started through the harness's thread-launch tool
  (`create_threads` / `t3_thread_launch` or the equivalent) with the model and effort above and the card path as its first message.
  That worker owns its PR end to end (`full-send` or `full-stop`, see the card's merge mode) and is the only thread that
  watches it. Fallback if the harness can only delegate children: use `delegate_task` for implementation, and you then own
  the PRs (`file-pr`, `watch_pull_request`, merge) yourself; keep the same three-slot limit.

## 3. Step 0 (you, before any worker)

1. `git fetch origin`. Note the SHA of `origin/main`. The checkout at `C:/dev/allegra` has uncommitted new files under
   `.planning/frontend-polish/` (the plan and this run kit). Create `docs/frontend-polish-run` from `origin/main`
   (`git switch -c docs/frontend-polish-run origin/main`; untracked files carry over), commit only
   `.planning/frontend-polish/` (message `docs: add the frontend polish plan and run kit`; no AI footer), file the PR with
   `file-pr`, babysit it, merge it. Workers branch from `origin/main`, so they must find the plan there.
2. Add `.planning/frontend-polish/captures/.gitignore` containing `*.png`, `*.mp4`, `*.webm`, `*.json` so captures stay local.
3. Check tools once and record them in the ledger header: `gh auth status`, `node -v`, `npm -v`, `adb devices`,
   whether an Android emulator image exists, free space on `C:` (it was 19 GB: warn if under 10 GB and use
   `C:/Users/nithy/.claude/skills/charles-storage-cleanup/SKILL.md` read-only first), and that `npm run typecheck` runs on `origin/main`.
4. Answer the plan's open questions with its defaults (PLAN-v2 §11 Q1-Q7) and write them at the top of the ledger:
   Q1 keep and fix YtMiniPlayer; Q2 keep the orbit loops and DJ notes; Q3 no copy changes (states only); Q4 allow
   color/background-color/border-color transitions at 100-160 ms on web, never box-shadow/filter; Q5 craft-lite; Q6 batch
   owner phone checks into `OWNER-TODO.md`; Q7 assume other mobile work exists and re-check before every mobile card.
5. Dispatch the first three cards (wave 1 in `01-ASSIGNMENTS.md`).

## 4. The loop

Repeat until every card is `merged`, `parked` or `dropped`:

1. Fill free slots from the dispatch order in `01-ASSIGNMENTS.md`: the first queued card whose dependencies are `merged`
   and whose file set does not overlap a running card. Dependency, lane and file-overlap rules are in the assignments file.
2. When a worker reports, **do not trust the report**. Use `verifying-agent-work` and `cross-checking-agent-work`: read the
   diff, grep it for the playback invariants (`setIsPlaying`, `.play(`, `requestPlayback`, effect deps on `isPlaying`), raw
   colours/durations in touched files, files outside the card's file set, and a baseline JSON that rose. Re-run the card's
   check commands on the PR head if anything looks off.
3. Update `LEDGER.md` (status, PR link, evidence paths, decisions the worker made, anything unproved).
4. Merging is serialised: one PR merges at a time. For mobile PRs, `expo.version` is bumped by the worker after a final
   rebase, immediately before its merge (see the protocol), so parallel mobile PRs never collide on the number.
5. Failure handling: a card that fails twice moves up (`escalating-agent-models`): Sonnet cards re-run on Luna with the
   previous worker's notes; a Luna card that fails twice is taken over (`takeover`) by a fresh Luna thread, with the failure
   written into its card. Use `recovering-agent-failures` for the diagnosis. A PR that falls behind `main` is refreshed
   with `modernize`. Conflicts use `resolving-merge-conflicts`.
6. The owner's decisions are final: `PLAN-v2.md` §3 (keep list) and §10 "Do-not-do" beat any worker idea, any skill default
   and any reviewer finding. A finding that asks to remove glass, glow, an accent, or a documented behaviour is declined with a
   written reason.

## 5. Parallelism rules (so three writers never collide)

- **Files:** a card owns only the files listed in it. Two running cards never share a file. If a worker needs a file it does not own, it
  stops and tells you; you decide (usually: queue the other change behind the owner of the file).
- **Web CSS:** W1 (token source) runs alone among CSS writers. Cards that edit `apps/web/src/styles/*.css` run one at a time
  (lane Web A in the assignments).
- **Mobile player files** (M1, M2, M3): one at a time, each through the CI launch gate and the player probe.
- **`allegraTheme.ts`:** only M6 and M9 may add tokens, one at a time.
- **Ports:** the owner's main checkout uses web :5173 and API :8080. Slot 2 uses web :5174 and `ALLEGRA_DEV_API_PORT=8081`,
  slot 3 uses :5175 and 8082. Each worker is told its slot and starts only its own pair. One Android emulator exists: whoever
  holds it holds it for a short capture session and releases it. One Gradle build at a time. Local Android builds are unreliable on this
  machine: mobile proof is the CI APK plus the emulator.
- **Disk:** C: was near full. Do not create a real `node_modules` per worktree. Worktrees use the repo's junction approach; see the
  worktree rules in `WORKER-PROTOCOL.md` (the removal order matters).

## 6. Merge policy

Per card (see `01-ASSIGNMENTS.md`): **AUTO** = the worker runs `full-send` and merges when the merge gate passes. **HOLD** = the worker runs
`full-stop`, leaves the PR ready and unmerged, and you list it for the owner. The repo's merge method, branch protection and CI
decide; never `--admin`. A mobile merge publishes the APK from `main`, so mobile cards need green CI, the launch gate and the
player probe before merge. Physical-phone evidence (TalkBack, 200% text on a device, low-end frame rate, HEVC video) is never
claimed from CI or the emulator; it is added to `OWNER-TODO.md` and to `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md` as "pending".

## 7. Reviews

Every code PR gets `sol-loop` (default 3 rounds, one reviewer, smallest-change rule) before `file-pr`. Cards marked
`council` also get `council` after Sol approves: these are the cards that can change many routes or the player (W1, M1).
All PR comments follow `leaving-pr-comments`. PR descriptions follow `file-pr` and end with the model and harness line, for example
`Created with GPT-6 Luna in T3 Code.`. Commits stay free of AI attribution (repo rule): conventional subject, short body only if the why needs it.

## 8. Reporting

- After every merge: one line in `LEDGER.md` and, if the owner needs to act, a line in `OWNER-TODO.md`.
- Ask the owner only through the harness question tool, only for the cases in `full-send` "Asking the user", batching questions.
- Finish with `FINAL` (see its card): green gates on `main`, a summary of what merged, the guard baseline numbers before and after,
  what is parked for the owner, what remains unproved, and the owner-device checklist. Then stop; do not start new scope.
