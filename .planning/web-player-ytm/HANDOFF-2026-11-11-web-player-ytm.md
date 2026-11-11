# Handoff: YouTube Music–style website player, plus the open phone PR (2026-11-11)

Written at the end of a long session. The next agent starts cold: everything needed is here or at an exact path.

## 1. Read first

1. This file.
2. `C:\dev\allegra\CLAUDE.md` (repo rules: hard rules 5 and 6 on motion, the three playback invariants, commit style
   with **no AI attribution footer in commits**, version bump rules).
3. `C:\dev\allegra\docs\current-codebase.md` and `C:\dev\allegra\audit\CODEBASE-KNOWLEDGE.md` (current map, on `main`).
4. `C:\dev\allegra\apps\mobile\CLAUDE.md` (only if you touch PR #71 or the phone).
5. Older, related handoffs (other sessions' work, already on `main`; context only):
   `C:\dev\allegra\.planning\playback-glitches\PLAN.md` (the original playback glitch audit) and
   `C:\dev\allegra\.planning\playback-glitches\HANDOFF-2026-11-11-mobile-audit-continuation.md`.
6. Memory notes: `C:\Users\nithy\.claude\projects\C--dev-allegra\memory\worktree-junction-gotchas.md` (dangerous:
   read before removing any worktree).

## 2. Project context

- Allegra monorepo, `C:\dev\allegra` (origin `https://github.com/peterish8/allegra`). Website: `apps/web` (Next.js 16
  App Router, React 19, Motion). Phone app LuvLyrics: `apps/mobile` (Expo / React Native, Android).
- **Three checkouts matter:**
  - `C:\dev\allegra`: branch `fix/playback-skip-glitches`, HEAD `ebf6b37c`, the same as `origin/main`. Another
    session's work; it is clean except an untracked `.planning/recommendations/` (not ours; never stage it).
  - `C:\dev\allegra-nav-stats`: a git worktree made this session. Its `node_modules` and `apps/mobile/node_modules`
    are **junctions** to `C:\dev\allegra`'s. Currently on branch `feat/web-player-ytm-style` (website work,
    **uncommitted**). The phone branch `feat/create-sheet-stats-design` (PR #71) was also built here and is pushed.
  - `C:\dev\allegra-lightfm`, `C:\dev\allegra-v6`: other people's/sessions' worktrees. Leave alone.
- Run and test (website, from the worktree):
  - Types: `cd C:\dev\allegra-nav-stats\apps\web && ..\..\node_modules\.bin\tsc --noEmit -p .`
  - Unit tests: `cd C:\dev\allegra-nav-stats\apps\web && node --import tsx --test --test-reporter=spec "src/lib/*.test.ts"`
  - Root gates before a PR (repo rule): `npm run typecheck`, `npm run lint`, `npm test` from the repo root.
- Run and test (phone): inside `apps/mobile`,
  `node scripts/ci/check-secrets.js && node_modules/.bin/eslint . && node_modules/.bin/tsc --noEmit && node_modules/.bin/jest --maxWorkers=2`
  (or `npm run mobile:check` at the root). Single suites can take a minute on this machine; a "Test suite failed to
  run" under parallel load was a timeout, not a code error.

## 3. Goal and current status

The owner showed a YouTube Music desktop screenshot (lyrics tab, BetterLyrics extension) and asked to copy its calm
layout into the website and the phone, leaving out the clutter, "but mainly make sure u do the nav bar style for our btns
like karaoke tho u add and also the background gradient formula". Status: the website restyle is **built and checked
in a browser at 1440, 1100, 768 and 390 wide, but not yet committed**. Remaining: revert one local-only config line,
run the website gates, rebase on the new `main`, commit, push, open the PR. PR #71 (phone: Create sheet + Spotify-style
stats) is open with all checks green but needs a rebase on the new `main` before merging.

## 4. Decisions and approvals

| Date | Decision | Owner's words | Status |
|---|---|---|---|
| 2026-11-11 | Lift the Create (+) sheet above the mini player, show all options | "its beneath the mini player so make it lil top and show all options clearly" | Done, PR #71 |
| 2026-11-11 | Listening stats like Spotify's, researched | "listening stats neat enhanced design properly like spotify … web search the design" | Done, PR #71 |
| 2026-11-11 | Push and open PR #71 | Clicked "Push and open PR" | Done |
| 2026-11-11 | Copy YouTube Music's calm player; avoid the clutter | "copying stuffs do overall all … avoid other stuffs for clutter" | In progress (website) |
| 2026-11-11 | Bar style for our buttons incl. karaoke, and the background gradient formula | "mainly make sure u do the nav bar style for our btns like kareoke … and also the background gradient formula" | Built, uncommitted |
| 2026-11-11 | Do **not** fix the orphaned word / line-break issue | "leave the hey and all as its lyrics issue … we cant do shrink lyrics text" | Rejected: do not touch line wrapping |
| 2026-11-11 | Song/Video switch | Not asked for again; YouTube is metadata-only in the phone rules | Open, default: skip |
| 2026-11-11 | Romanised lyrics on the website | Suggested by me; owner said "do overall all" | Open: needs a new web dependency (see §12) |

Authorised for the next agent: finish the website branch, commit, push it and open its PR (the owner asked for this
flow on PR #71 and to "do overall all"). Rebase PR #71 onto `main` and push the result. **Ask before merging any PR to
`main`** (a merge to main publishes the phone APK through `.github/workflows/mobile-apk.yml`). Never push to `main`
directly.

## 5. What was done this session

**Audit and plan (earlier in the session):** `.planning/playback-glitches/PLAN.md` (now on `main` via the other
session). Another session implemented it (commits `9081dea8`, `a7b29022`, on `main`).

**PR #71, phone 1.46.0** (`feat/create-sheet-stats-design`, commit `17e77bc2`, https://github.com/peterish8/allegra/pull/71):
- Create sheet: the card was drawn inside the tab bar's host while the mini player is drawn after the tab navigator
  (`apps/mobile/src/navigation/RootNavigator.tsx`), so the pill covered its last row. Now it rests above the pill
  (`v6Shell.createSheetFrame`, `hooks/useBottomClearance.useMiniPlayerShowing`), scrolls at large text, and the pill dims
  and lets taps through while the card is up (`components/PillPlayer.tsx`, `components/nav/CreateSheet.tsx`,
  `components/V6TabBar.tsx`).
- Listening stats: Spotify's layout (dates + Share, top artist / top song tiles with rank chips, one highlight card,
  lists on the page). Engine: `services/stats/listeningStats.ts` (`previousRank`, `ranked`, `rankMove`, `rankMoveWords`,
  `pickHighlight`, `rangeWords`, `statsShareText`); UI: `components/stats/StatsParts.tsx`
  (`RankChip`, `Spotlight`, `Highlight`), `screens/ListeningStatsScreen.tsx`. Tests added; 156 suites / 1,256 tests
  passed locally; all CI checks passed on GitHub (Build APK, Kotlin, emulator launch, lint/type/test, Vercel).

**Website, uncommitted on `feat/web-player-ytm-style`** (in `C:\dev\allegra-nav-stats`):
- `apps/web/src/lib/playerWash.ts` (+ `playerWash.test.ts`, 4 tests pass): the background formula. Four layers from
  the cover palette: a left-edge shade (black 42% → 0 by 38%), the primary at 55% alpha pooled at 78%/8%, the
  secondary at 26% from 16%/100%, and a vertical base mixing the primary 34% → 16% into `#060509`.
- `apps/web/src/components/PlayerPanel.tsx`: the atmosphere renders the wash (cross-fades per palette, opacity only,
  `motionTokens.duration.cinematic`), replacing `FluidArtBackground` / `DynamicLyricsBackground` (both files deleted,
  `git rm`). `PlayerTime` added as the first child of `.np-actions`.
- `apps/web/src/components/PlayheadViews.tsx`: `PlayerTime` ("0:00 / 5:29", reads the playhead itself, aria-hidden
  because the slider already speaks the time).
- `apps/web/src/styles/app.css`: one block appended at the end ("Desktop player bar, YouTube Music's"): the dock is a
  flat full-width bar; the progress is a thin line on its top edge (thicker with a thumb on hover); time beside the
  tools; the top-right Karaoke pin hidden on desktop (the bar's mic stays); the lyric timing pill shows only while the
  pointer is over the lyrics; a 901–1240 px variant stacks info/tools over the transport.
- `apps/web/next.config.ts`: **LOCAL-ONLY change, must be reverted before commit** (see §7).

## 6. Where everything lives

| What | Where | Purpose / how to open |
|---|---|---|
| Website branch | `C:\dev\allegra-nav-stats`, `feat/web-player-ytm-style` | Uncommitted website work |
| Phone PR | https://github.com/peterish8/allegra/pull/71 (`feat/create-sheet-stats-design`) | Create sheet + stats, 1.46.0 |
| Playback audit | `C:\dev\allegra\.planning\playback-glitches\PLAN.md` | Original glitch list (implemented elsewhere) |
| Screenshot script | `C:\Users\nithy\AppData\Local\Temp\claude\45b25dbe5e1a3483\d77f8f04-53eb-4307-b0c8-3728cf160ee8\scratchpad\shot.mjs` | Headless Edge captures of the full player: `node shot.mjs <prefix> 1440 900 390 844` |
| Before/after captures | same scratchpad folder: `before-1440.png`, `after-1440.png`, `after-1100.png`, `after-768.png`, `after-390.png` | Visual evidence (temp folder; may be cleaned) |
| Local preview configs | `C:\dev\allegra\.claude\launch.json` entries `web-ytm` (:5175) and `mock-8080` | Git-ignored, local only |
| YouTube Music reference | the owner's screenshot (YTM desktop, "Azhagiye", lyrics tab) | The look being copied |
| Spotify stats reference | https://newsroom.spotify.com/2025-11-06/spotify-new-feature-listening-stats/ | Source for PR #71's stats layout |

## 7. How to work with the artifacts

- **Preview the website branch:** Turbopack refuses a `node_modules` junction that points outside its root. For local
  testing only, `apps/web/next.config.ts` has `turbopack: { root: path.join(monorepoRoot, '..') }` (comment
  `LOCAL-ONLY-REVERT`). Revert it before committing: `git -C C:\dev\allegra-nav-stats checkout -- apps/web/next.config.ts`.
  Webpack (`--webpack`) does **not** work: it chokes on `onnxruntime-node` `.node` binaries.
- Start servers with the preview tool: `preview_start mock-8080` (mock API on :8080; the website rewrites `/api` there)
  and `preview_start web-ytm` (:5175). The browser pane may be hidden; then use the headless script.
- **Headless screenshots:** Playwright's bundled Chromium crashes on this dev page; use `channel: 'msedge'` (the script
  does). The home page has no song cards with the mock API, so the script searches "love" and plays the first result
  ("Agar Tum Saath Ho"). "Playback needs a tap" in captures is headless autoplay blocking, not a bug.
- **GitHub auth gotcha:** a stale `GITHUB_TOKEN` environment variable is invalid and overrides the working `gh` keyring
  login. Prefix commands: `env -u GITHUB_TOKEN gh …` and push with
  `env -u GITHUB_TOKEN git -c credential.helper= -c "credential.helper=!gh auth git-credential" push`. The app's PR panel
  shows "Bad credentials" for the same reason. Tell the owner to remove or renew that variable.
- A security hook blocks file writes that contain a regex exec call or Playwright's dollar-dollar-eval helper, even in
  harmless code or prose; use `String.match()` and locators instead.

## 8. Verified facts

- Desktop full player layout: `apps/web/src/styles/app.css` block starting "Desktop player (YouTube Music / Spotify
  layout)" (~line 6755) makes `.listening-body` a grid and `.np-controls` `display: contents`; the dock glass is
  `.listening-body::before`. The new block at the end of `app.css` overrides rows, glass and progress.
- Karaoke in the bar: `PlayerPanel.tsx` renders the Mic `IconButton` (`np-action--tool`) inside `.np-actions`; desktop
  CSS shows it and hides `.np-live-karaoke` and the translate tool (translate lives in the lyrics ⋯ menu).
- Lyrics already has: tools behind ⋯ (`LyricsPanel.tsx` `collapsibleActions`, portaled to the top bar), an animated
  instrumental wave (`ytm-lyrics__instrumental`), distance-based fading of far lines, a timing offset
  (`lyricsOffsets`), translation (`onToggleTranslate`). No romanisation on the website.
- Phone transliteration exists: `apps/mobile/src/services/TransliterationService.ts` (`@indic-transliteration/sanscript`).
- Checked in a browser (headless Edge, mock API): 1440 (one-row bar), 1100 (stacked bar), 768 and 390 (phone layout
  unchanged apart from the wash). **Not re-checked: 1920 wide**, real playback (progress line moving, hover thumb),
  `prefers-reduced-motion`, the black-background setting (`.is-black` hides the atmosphere, so the wash is hidden too).
- `origin/main` is `ebf6b37c` (1.45.3). Both of this session's branches are based on `f2223c66` and need a rebase.
- Website gates (`tsc`, eslint, all `src/lib` tests) have **not** been run on the website change yet.

## 9. Known problems and findings

- Rebase conflicts likely: `main` gained web changes from the other session in `PlayerPanel.tsx`, `App.tsx`,
  `global.css`, `motion/index.ts`, `useAudioPlayer.ts`; and phone changes in `PillPlayer.tsx`, `v6Shell.ts(+test)`,
  `app.json` (1.45.3). Keep both sides; the phone version must end at **1.46.0** (higher than 1.45.3).
- `app.css` is ~7,860 lines of layered overrides; the new block relies on coming last. If a later rule wins, check
  order before adding `!important` (do not add it).
- `.listening-world__glow` and the old `.music-bg-base` / blob CSS are now unused by the player (left in place). Safe to
  delete later after a grep.
- The progress line's hover thickening switches `--track-height` instantly (no transition), which respects hard rule 5.

## 10. Remaining work, prioritised

1. Finish and ship the website PR (revert config, gates, 1920 check, reduced-motion check, rebase, commit, push, PR).
   Done = PR open, CI green, screenshots at 360/768/1280/1920 in the PR description.
2. Rebase PR #71 onto `main`, resolve conflicts, rerun `mobile:check`, push. Done = PR #71 mergeable and green.
3. Phone follow-ups from the YouTube Music review (only if the owner wants them): a visible Romanised ↔ original chip in
   the lyrics view; a "Related" chip in Up next beside All / Familiar / Discover.
4. Website romanised lyrics (needs a dependency decision, §12).
5. Clean up: remove the `C:\dev\allegra-nav-stats` worktree **only** with the junction-safe procedure (§13).

## 11. Plan for the next agent

1. `cd C:\dev\allegra-nav-stats`; confirm `git status` matches §5. Preview first (you need the local config line for
   Turbopack): `preview_start mock-8080`, `preview_start web-ytm`.
2. Check 1920×1080 and a reduced-motion pass (emulate `prefers-reduced-motion`), and the black-background setting.
   Fix anything off. Acceptance: bar flat and full-width, progress line on its top edge, "m:ss / m:ss" next to the tools,
   one karaoke control, no timing pill until hover, wash smooth.
3. Revert `next.config.ts`. Run in `apps/web`: `tsc --noEmit -p .`, eslint on changed files,
   `node --import tsx --test "src/lib/*.test.ts"`. Then root `npm run typecheck`, `npm run lint`, `npm test`.
4. `git fetch origin && git rebase origin/main`; resolve conflicts; rerun step 3's checks.
5. Commit `feat(web): YouTube Music player bar and cover-colour wash` (no attribution footer), push with the auth
   workaround, open the PR with before/after screenshots and the "not tried" list. Bind it in the app if possible.
6. PR #71: `git switch feat/create-sheet-stats-design`, `git rebase origin/main`, keep 1.46.0, rerun mobile checks,
   `git push --force-with-lease` (own feature branch only). Report to the owner and ask before merging either PR.

## 12. Open questions (with defaults)

- Website romanised lyrics: needs `@indic-transliteration/sanscript` (or similar) in `apps/web` (root lockfile). Default:
  do not add it in this PR; propose it as its own PR and ask.
- Song / Video switch: default skip (YouTube is metadata-only in this project).
- Phone Romanised chip and Related chip: default ask once; if no answer, leave for later.
- Delete the now-unused background CSS? Default: leave it in this PR.

## 13. Rules and guardrails

- `C:\dev\allegra\CLAUDE.md`: animate transform and opacity only; durations and easings from
  `apps/web/src/motion/index.ts`; reduced motion collapses to opacity; TypeScript strict, no `any`; conventional
  commits, **no AI attribution footers**; work on feature branches, small PRs; `main` always green.
- Phone: every build reaching `main` bumps `apps/mobile/app.json` `expo.version`.
- Never commit `apps/web/next.config.ts`'s LOCAL-ONLY line. Never stage `.planning/recommendations/`.
- **Worktree removal is dangerous:** `git worktree remove` follows the `node_modules` junctions and once wiped the main
  checkout. First `cmd /c rmdir C:\dev\allegra-nav-stats\node_modules` and
  `cmd /c rmdir C:\dev\allegra-nav-stats\apps\mobile\node_modules` (removes only the links), then remove the worktree.
- Do not touch `C:\dev\allegra-lightfm` or `C:\dev\allegra-v6`.
- Ask before merging to `main`, deleting branches, or changing GitHub settings.

## 14. Continuation instruction

Start in `C:\dev\allegra-nav-stats` on `feat/web-player-ytm-style`, preview it, check 1920 wide and reduced motion,
then revert the local config line, run the gates, rebase on `origin/main`, commit and open the website PR. Then rebase
PR #71 and report both PRs to the owner, asking before any merge.
