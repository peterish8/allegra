# Worker protocol (every worker reads this first, then its task card)

You are one worker in an autonomous run. The owner is not watching. Your task card is your brief. This file is the rules that
apply to every card. If the card and this file disagree, the card wins for that card only; if either disagrees with the repo's
`CLAUDE.md` hard rules or `PLAN-v2.md` §3 (keep list) and §10 (do-not-do), those win.

Paths: `S` = `C:/Users/nithy/.claude/skills`, `A` = `C:/Users/nithy/.agents/skills`. Repo root `C:/dev/allegra`.

## 1. Read, in this order (do not skip; this is how you avoid undoing the owner's decisions)

1. Your task card (`.planning/frontend-polish/run/tasks/<ID>.md`).
2. `C:/dev/allegra/CLAUDE.md`; for mobile also `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md`, `apps/mobile/src/ui/AGENTS.md`.
3. `.planning/frontend-polish/PLAN-v2.md`: §3 keep list, §4 skill-versus-Allegra table, §4a skill paths, the section of §8 named in your card
   (read the whole entry for your package), §9 definition of done, §10 do-not-do. Addendum A if your card is W11, M11 or M12.
4. The skill files your card lists (open each by absolute path). The T3 workflow skills are `S/full-send/SKILL.md` or
   `S/full-stop/SKILL.md` (your card says which), `S/sol-loop/SKILL.md`, `S/file-pr/SKILL.md`, `S/babysit-pr/SKILL.md`,
   `S/leaving-pr-comments/SKILL.md`.
5. The code you will change. Use the repo's code graph first (`graft ask "<task>" --source`, `graft skeleton <file>`,
   `graft grep "<literal>"` via Bash) where available; otherwise search. Verify every path the card cites.

## 2. Workspace

- Work in your own git worktree on the branch named in your card, cut from the latest `origin/main`
  (`git fetch origin` first). Never edit the owner's checkout at `C:/dev/allegra` and never touch another worker's worktree.
- **Junction rule (a past incident wiped the main checkout).** Extra worktrees get `node_modules` as junctions to the main checkout.
  Before removing or deleting anything recursively, list reparse points
  (`Get-ChildItem -LiteralPath <root> -Recurse -Force -Attributes ReparsePoint`) and remove each junction with `cmd /c rmdir "<junction>"`
  (no `/s`) first. Never run `git worktree remove --force`, `Remove-Item -Recurse`, `rd /s` or `rimraf` across a junction. Do not delete
  worktrees at all unless the orchestrator asks; just leave them. Back up untracked `.env*` files before any cleanup.
- Never install dependencies (`npm install`) unless your card says so. Never add a dependency. Never edit lockfiles.
- Use your slot's port pair for dev servers (the orchestrator tells you): slot 1 web :5173 / API :8080, slot 2 :5174 / 8081
  (`ALLEGRA_DEV_API_PORT=8081`), slot 3 :5175 / 8082. Next's Turbopack refuses a junctioned `node_modules`; to look at a web change in a worktree,
  widen Turbopack's root **locally only** in `apps/web/next.config.ts` (`turbopack: { root: <monorepo parent> }`), and revert it before you
  commit. Check `git diff --cached --name-only` before every commit.
- Test browser behaviour on the web dev server (:517x), never on an API port (strict CSP breaks media). E2E: set `E2E_CHANNEL=msedge` and
  `E2E_BASE_URL=http://localhost:<your web port>`. Headless captures use the system Chrome or Edge (`CHROME_PATH`), not bundled Chromium.
- Edit source with the Edit tool. Do not rewrite source files with scripts or sed.

## 3. Method (Theo's T3 method, from the owner's downloaded skills)

Small, modular, one job per module, end-to-end typed (TypeScript strict, no `any`), one contract per feature, ship small vertical
slices with their tests. No second stack, no new dependency. In order:

1. **Reproduce or measure first.** Record the "before": guard counts, a failing test, a capture, or the failing behaviour.
2. **Test first** where the card calls for a regression test (`A/tdd/SKILL.md`): it must fail on the old code, then pass.
3. **Make the smallest change that works** inside your file set. Fix the case that happened, not every case that could.
   Apply the skills your card names. Use tokens only; no raw colours, durations, easings or font sizes in touched files.
4. **Prove it** (`full-send` "Proof"): the exact commands and captures in your card, run by you in this session. Green mocked
   tests do not prove UI. Look at the change at the widths/font scales listed in PLAN-v2 §9.
5. **Review with `sol-loop`** (`S/sol-loop/SKILL.md`): up to 3 rounds, minimal changes, push back on scope creep. Cards marked `council`
   also run `S/council/SKILL.md` after Sol approves.
6. **File the PR with `file-pr`** after rebasing on the latest `origin/main`. Title in the repo's conventional style
   (`fix(web):`, `feat(mobile):`, `test(web):`, `refactor(web):`, `chore(...)`). Body: the problem in plain words, the solution, one line on how you proved it, the before/after
   numbers, captures listed by local path, and what is **not** proved. End with the model and harness line.
7. **Babysit with `babysit-pr`** (`S/babysit-pr/SKILL.md`) using `watch_pull_request` (you own this PR, so you may watch it; unwatch before you stop).
   Fix real findings; decline false ones with a written reason via `leaving-pr-comments`. Never write your own polling loop.
8. **Merge or park**, per your card: **AUTO** = follow `S/full-send/SKILL.md`: merge only when its merge gate passes; **HOLD** = follow
   `S/full-stop/SKILL.md`: leave the PR ready and unmerged, unwatch, and report.
9. **Report** (see section 6) as your final message.

## 4. Hard constraints (from the repo; do not break)

- Motion: animate `transform` and `opacity` only. Every duration and easing from tokens (`apps/web/src/motion/index.ts`, `styles/tokens.css`; mobile `Motion` in
  `apps/mobile/src/constants/allegraTheme.ts`). `prefers-reduced-motion` / Reduce Motion collapses to opacity and never removes a feature.
- Playback invariants: all play/pause through `requestPlayback`; load effects never depend on `isPlaying`; a seek pauses and resumes. The single `<audio>`
  element stays in the layout. Do not touch `useAudioPlayer`, queue code, lyric glide maths or sheet physics in a polish PR.
- Mobile UI: build from `apps/mobile/src/ui` primitives (`Tactile`/`TactileRow`, `Button`, `Sheet`, `ConfirmSheet`, `ListRow`), 48 dp targets, white-only accent,
  no new glass buttons, no emoji/mono/uppercase-tracked labels, sentence case.
- Owner taste: clear frosted glass, subtle glow, icon-only buttons where obvious, no dark veils, no clutter. Do not delete or flatten glass, glow, shaders,
  cover wash, the DJ mascot or Blend orbs. Do not change lyric line wrapping.
- API/Convex/desktop/shared contracts are out of scope. No `console.log` in production paths. No session-replay SDKs.
- `packages/shared` edits need `npm run sync:shared` (only if your card touches it; most do not).
- A guard baseline may only fall. Never run an `UPDATE_*_BASELINE` command to make room for new violations; update a baseline only to record a real reduction.
- Do not claim something works unless you ran it. Do not claim device, TalkBack, performance or HEVC results from CI or an emulator.

## 5. Gates before you file (run from your worktree; never overlap `mobile:check` with `convex:test`)

- Always: `npm run typecheck`, `npm run lint`, and the tests for what you touched.
- Web: `npm test --workspace apps/web`; for UI changes the e2e specs your card names; captures at 360 / 768 / 1280 / 1920 and one with reduced motion.
- Mobile: from `apps/mobile`, `node_modules/.bin/tsc.cmd --noEmit`, then at the repo root `npm run mobile:check`; screenshots on the emulator at font scale 1.0 and 2.0 when the card says so.
  Mobile PRs that change what the APK builds bump `expo.version` in `apps/mobile/app.json` (patch for fixes, minor for features):
  after your final rebase, look at the number on `origin/main`, take the next free one, commit it, then merge without delay. Check `.github/workflows/mobile-apk.yml`
  paths: a test-only change may not rebuild the APK.
- Playback-adjacent files: grep your own diff for `setIsPlaying`, `.play(`, `requestPlayback` and effect dependency arrays containing `isPlaying`. The player e2e
  (web) or the CI player probe (mobile) must pass.

## 6. Final report (your last message; the orchestrator reads only this)

```
ID: <card id>   Result: merged | parked-ready | blocked | failed
PR: <url>   Head: <sha>   Merge commit: <sha or none>   Version: <expo.version or n/a>
Files changed: <count>, outside my file set: <none | list and why>
Before -> after: <guard counts / measurements / captures>
Proof I observed: <commands and results; captures by local path>
Sol-loop: <rounds, verdict>   Council: <n/a | result>
Decisions I made for the owner: <list>
Not proved / needs a phone: <list>
Follow-ups I declined to do: <list>
```

## 7. Asking the owner

Never ask in a normal message (it goes unseen). Use the harness question tool (`request_user_input` or `AskUserQuestion`) only for what `full-send` "Asking the user"
lists: you cannot prove the change, the merge gate cannot pass, the next step is outside your grant, the goal is ambiguous in a way that changes the result,
or another PR makes yours obsolete. Everything else: pick the plan's default and list it in the report. If no question tool answers, take the safe path:
leave the PR open and unmerged and start your report with the question.
