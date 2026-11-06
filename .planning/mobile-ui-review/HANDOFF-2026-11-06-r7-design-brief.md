# Handoff: LuvLyrics V6 releases 1.38–1.39 and the Round 7 design brief (paused for approval)

Date: 2026-11-06. Supersedes the status parts of `HANDOFF-2026-11-06-v6-verification.md` (kept as history).
The owner stopped the session mid-task and asked for this handoff. **Nothing below is in progress now.**

## 0. Continuing in a cloud session (read this first there)

The owner will continue in a cloud session. Everything needed is committed on `main` (this handoff, the starter, the Round 7
generator and boards, the staged canvas index and all screenshots); nothing depends on the original Windows machine.
- Windows paths below (`C:\dev\allegra-v6\...`) are the same files at the repo-relative path after `C:\dev\allegra-v6\`.
- Evidence and images: `.planning/mobile-ui-review/evidence-2026-11-06/` (see its README) and
  `.planning/mobile-ui-review/owner-evidence-2026-11-06/`.
- Round 7: `design-drafts/v7_revision.py` (generator), `design-drafts/project/V7-*.dc.html` (boards, rebuilt with the latest
  rules), `design-drafts/v7_canvas_index.py` (adds page r7 to a live canvas index), `design-drafts/canvas.r7-staged.json`
  (reference snapshot only).
- A cloud session has no Android emulator and possibly no access to the claude.ai design canvas. If it cannot publish to
  the canvas, render the boards for the owner another way (for example a published artifact page or screenshots made from
  the HTML with a headless browser) and say clearly that the canvas itself was not updated. Device and emulator checks stay
  pending there; APKs still come from GitHub Actions.
- `gh` in the cloud uses the session's own auth; the stale `GITHUB_TOKEN` note in §2 applies only to the owner's PC.

## 1. Read first

1. This file.
2. `.planning/mobile-ui-review/PLAN-V6-VERIFICATION.md` (UI-01–UI-10 acceptance checks, still the verification plan).
3. `.planning/mobile-ui-review/VERIFICATION-MATRIX.md` (what was checked where; written before 1.38.0 was emulator-checked).
4. `.planning/mobile-ui-review/HANDOFF-2026-11-06-v6-verification.md` (previous handoff: history, owner quotes, smoke detail).
5. Rules: `AGENTS.md`, root `CLAUDE.md`, `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md` (section "Owner corrections"),
   `apps/mobile/src/ui/AGENTS.md`.
6. Design generator: `.planning/mobile-ui-review/design-drafts/README.md`, then `v7_revision.py` (Round 7 boards).

## 2. Project context

- LuvLyrics = Allegra's Android app in `apps/mobile` (Expo SDK 54, React Native 0.81, React 19.1, TypeScript, Reanimated 4.1,
  FlashList 2.2.2, native Kotlin views and Media3 playback). Mobile is **not** a root workspace: `npm ci` inside `apps/mobile`.
- Repo `C:\dev\allegra` is the primary checkout (branch `feat/mobile-frontend-polish`), **dirty with the owner's unrelated work: do not touch**.
  This session worked in the worktree **`C:\dev\allegra-v6`** (its own `apps/mobile/node_modules`, no junctions).
  Everything from this session is on `main` (the Round 7 files and evidence were merged as a docs-only change).
- Origin `https://github.com/peterish8/allegra`. Main = `0d1af91` (1.39.0).
- Gate (from `apps/mobile`): `npm run ci` = secret scan + eslint + `tsc --noEmit` + `jest --ci --runInBand --coverage`.
  Run Jest **in band**: parallel workers ran out of memory here. Root equivalent: `npm run mobile:check`.
- Kotlin unit tests run in GitHub `Mobile CI` (`:app:testDebugUnitTest`). APKs are built **only by GitHub Actions**
  (`mobile-apk.yml`); main publishes `apk-latest` after the build and the emulator launch pass.
- **gh auth gotcha:** the user environment has a stale `GITHUB_TOKEN`; every `gh` call needs `$env:GITHUB_TOKEN=$null` first
  (PowerShell). The app's PR monitor shows "Bad credentials" for the same reason.
- **Disk gotcha:** a local `gradlew assembleDebug` filled C: to 0 MB (native libs build into `node_modules/*/android/build`).
  Do not build locally; use the CI APK artifact. Free space was ~0.8 GB after cleanup.
- Emulator: AVD `probe` (360×720 dp, density 2). Install a CI artifact via
  `gh api repos/peterish8/allegra/actions/artifacts/<id>/zip > apk.zip` run through `cmd /c` (works while the run is still in
  progress; `gh run download` does not). Screenshots: `cmd /c "adb exec-out screencap -p > file.png"` (PowerShell `>` corrupts
  binary). `uiautomator dump` needs playback paused and `settings put global animator_duration_scale 0`.

## 3. Goal and current status

The owner wants the app to look and feel like the V6 design **canvas** (not the local gallery HTML, which renders without covers
and fonts), with consistent, compact, accessible UI. Shipped this session: **1.38.0** (owner's V6 fixes, animated header glow,
slimmer shell, mini-player swipes), **1.38.1** (board-matching follow-ups), **1.39.0** (Display size setting). Then the owner
sent a **Round 7 design-revision brief (items 1–9)** that is **design-preview only until the owner approves**. The boards were
generated locally but **not yet published to the canvas**, and nothing from Round 7 is implemented.

## 4. Decisions and approvals (owner's words, 2026-11-06)

| Decision | Owner's words (short) | Status |
| --- | --- | --- |
| Merge without waiting | "no directly merge and if some problem is there then do correct and merge as problem like bug fix later now merge to main!" | Applied to #59–#61 |
| Target look | "according to the html screens u built like that feel i want!" / "u open in design board only there we saw real good one" | Approved: the V6 **canvas** is the target |
| Shell height | "nav bar and the mini player both together reduce heights ... mini player especially" | Done in 1.38.0 (120dp above the inset, was 144) |
| Display size | "customisable in settings like overall size of the everything in app" | Done in 1.39.0 |
| Round 7 brief scope | "Do not implement, commit, merge, or release these design revisions until I approve the revised preview." | **Open: awaiting approval** |
| R7 items 1–7 | Consolidated brief: chips, menus, nav, Play/Shuffle, Library background, voice search, consistency | Boards generated, not published |
| R7 item 8 | "unified frosted mini-player and bottom-navigation surface" | Boards generated, not published |
| R7 item 9 | "compact Stream song rows with proper full-row interaction"; **keep Download and ⋮ as separate controls** | Boards generated; conflicts with 1.38.1 (see §9) |
| Lists everywhere | "all list same width and height one liner name and artist total two lines ... keep (....) ... consistent throughout" | Added to the R7 spec (CSS + text); boards need a rebuild |
| List covers | "lil curved edges in cover art in all areas of lists!" | Added to `v7_revision.py` CSS (6dp); **boards not rebuilt** |
| Playlists background bug | "only in playlist the bg is not showing in that box! it got cut off abruptly" (screenshot) | Cause found (§8); fix **not applied** (R7 approval boundary) |
| Delegation | (earlier) only easy bounded tasks, and only to GPT-6 Luna on high | Still applies |

Authorised: coding, tests, version bumps, push, PRs, merge and GitHub Actions APK publishing **for approved work**.
Needs the owner: approval of the Round 7 preview before any Round 7 implementation. That includes the Playlists fix, unless the
owner says to ship it as a standalone bug fix.

## 5. What was done this session

**1.38.0, PR #59 → main `b4d1fca`:**
- Header glow: `src/ui/HeaderGlow.tsx`, `src/ui/headerGlowMath.ts` (+test), `src/hooks/useHeaderGlow.ts`,
  `src/hooks/useReduceTransparency.ts`. Stream and Library use `AppScreen staticGlow={false}`.
- Shell: `src/navigation/v6Shell.ts` (16 seek + 48 row + 56 nav; 40dp cover), `NativeTabBarView.kt` `V6_BAR_DP = 56`, `V6TabBar.tsx`.
- Mini player: `src/components/PillPlayer.tsx`. Sideways skip via `src/playback/miniSwipe.ts` (+test). The label lives in
  `src/playback/miniPlayerLabel.ts`, with a test pinned to `.github/scripts/player-assertions.sh`.
- Stream: chips moved from `ListHeaderComponent` into the feed data; no `RiseIn` in FlashList cells; shortcut tiles get
  definite widths (`src/components/stream/shortcutGrid.ts` + test).
- Up next: `Segmented` filter, and `NativeQueueListView.kt` clips to its frame.
- Player title: one line that shrinks to fit (from 1.38.1). Chips are 36dp visible with a 48dp target. Section headings are tighter.
- Smoke: run 42126270194 failed because the V6 mini-player label stopped matching the probe; the label is restored.

**1.38.1, PR #60 → `bfa22f9`:** single ⋮ on Stream/Search rows (Download icon removed), plain play glyph in the mini player,
darker glow tint (`shadePalette` 0.72), title shrink-to-fit (`Marquee` `still`).

**1.39.0, PR #61 → `0d1af91`:** Display size (Compact 85% / Small 92% / Default / Large 108%):
- Native: `android/.../startup/DisplayScale.kt` (+`DisplayScaleTest.kt`) and `MainApplication.kt`.
- `MainActivity.kt` now counts only cold starts towards the rescue screen.
- `StartupModule.kt` adds `getDisplayScale`/`setDisplayScale`; setting recreates the activity.
- JS: `src/utils/displaySize.ts` (+test) and `src/services/displaySizeNative.ts`, with the choice under Settings → Player.

**Round 7 design (committed for the cloud handover, not approved):** `design-drafts/v7_revision.py` builds 9 boards,
`design-drafts/project/V7-*.dc.html`. The Ionicons font was uploaded to the canvas (§6), but **no board was published to the
canvas**. The owner asked for everything to be committed and pushed so a cloud session can continue; that does not approve
the Round 7 design, which still needs the owner's approval before any app implementation.

## 6. Where everything lives

| Artifact | Location / purpose |
| --- | --- |
| Design canvas (the target) | https://claude.ai/artifact/UGiYJ1UaRjWA66qTFjsmHT (the owner's; pages r5, r5all…; the Stream board is on "Round 5: every screen and state") |
| Ionicons font on the canvas | asset `/_blob/a251de911c30c28097a2303b876fbe7a` (uploaded; `IONICONS_URL` in `v7_revision.py`) |
| Round 7 generator | `.planning/mobile-ui-review/design-drafts/v7_revision.py` (committed) |
| Round 7 boards | `.planning/mobile-ui-review/design-drafts/project/V7-*.dc.html` (committed; rebuilt with the rounded-cover and two-line-list rules) |
| Canvas index script | `.planning/mobile-ui-review/design-drafts/v7_canvas_index.py`: inserts page `{"id":"r7"}`, places boards at x=0 with a y step of 1170, appends them to `order`, adds note `r7title`. Run it on a freshly read live index |
| Staged index snapshot | `.planning/mobile-ui-review/design-drafts/canvas.r7-staged.json` (reference only; never publish over a newer live index) |
| PRs | #59, #60 and #61 merged: https://github.com/peterish8/allegra/pulls |
| Release | https://github.com/peterish8/allegra/releases/tag/apk-latest (showed 1.38.0 at handoff; the main APK and smoke runs for `0d1af91` were still in progress) |
| Emulator and canvas evidence | `.planning/mobile-ui-review/evidence-2026-11-06/` (README lists every image and UI dump) |
| Owner evidence | `.planning/mobile-ui-review/owner-evidence-2026-11-06/` |

## 7. How to work with the artifacts

```powershell
# Rebuild Round 7 boards (required: the current files predate the last two owner requests)
cd C:\dev\allegra-v6\.planning\mobile-ui-review\design-drafts
$env:PYTHONIOENCODING='utf-8'; python v7_revision.py
```

Publishing to the canvas (Artifact tool, Design type rules):
1. `read` `project/canvas.json` immediately before publishing (a stale index is refused).
2. Put `canvas.json` (with page `r7` and 9 board entries; `v7_revision.py` prints the widths) and the `V7-*.dc.html`
   files under one folder as `project/...`.
3. One publish: `url` = the canvas, `root` = that folder, `file_path` = the absolute path of `project/canvas.json`, `files` =
   `{"project/V7-1-Chips.dc.html": "project/V7-1-Chips.dc.html", ...}`.
4. Do not overwrite other pages or the owner's edits; keep every other index key as read.
5. Icon names in the generator must be semantic keys from `v6_icons.NAMES` (it fails on unknown names). The extra names
   are registered at the top of `v7_revision.py`.
6. A security hook blocks writing any file that contains the regex-exec method call text; in JS tests use `String.match`.
   PowerShell `>` writes UTF-16, so write files with `git diff --output` or `cmd /c` redirects.

## 8. Verified facts

- Playlists background (owner screenshot): `apps/mobile/src/screens/PlaylistsScreen.tsx:132` wraps in `AppScreen`, and `:221`
  sets `container: { backgroundColor: Signal.bgDeep }`. That gives an opaque box plus a second glow when embedded in Library
  (`LibraryScreen.tsx` renders `<PlaylistsScreen embedded />`). Fix: when `embedded`, render a transparent `View` instead.
- Voice search supports **both** hold and tap (`src/components/VoiceMicButton.tsx:162–176`), but the card always says
  "Let go when you're done" (`src/components/VoiceSearchCard.tsx:164`).
- 1.38.0 on the emulator (360dp):
  - chips at 110–146dp, heading from 176dp (no overlap);
  - seek 16, row 48, nav 56;
  - Up next rows start below the segmented filter;
  - the glow leaves on scroll;
  - the mini-player label is `Now playing: <title>. Open player`.
- Broader smoke: pre-V6 main (41306254650) already failed C round 2 and D. The branch run 42177973408 and the main run for
  `0d1af91` were **not read** before the stop.
- 1.39.0 Display size: **not checked on a device or emulator** (the recreate path, each size, 200% text with Compact).

## 9. Known problems and findings

1. **Conflict:** 1.38.1 removed the Download button from Stream/Search rows, but R7 item 9 says to keep Download and ⋮ as
   separate controls. The preview restores Download; the app needs it back after approval.
2. Playlists opaque box (§8), confirmed by the owner's screenshot.
3. Voice copy mismatch (§8).
4. Sheet close: while a modal `Sheet` animates closed, its native Modal swallows taps (F-6a in the matrix). Not measured.
5. Smoke D (screen-off media keys) has been red since before V6; its state after the label fix is unknown.
6. Physical device, TalkBack, 200% text, frame timing and the in-app update install are all pending (no phone attached).

## 10. Remaining work, prioritised

1. The R7 boards already include the latest rules (rounded 6dp covers, identical two-line rows everywhere); rebuild only if
   you change `v7_revision.py`. Publish page `r7` to the canvas (or show the boards another way if the canvas is unreachable)
   and screenshot each board. Then give the owner the completion table (item | status | change | where | issue) and
   **ask for approval**. Done = the owner sees all 9 boards on the canvas.
2. After approval, implement R7 in small PRs (see §11), each with tests, the gate, a version bump, a merge and a CI APK check
   on the emulator.
3. Read the main smoke and APK results for `0d1af91`; verify that `apk-latest` = 1.39.0 and check its manifest commit.
4. Emulator-check Display size: all four sizes, playback survives the recreate, and the rescue counter does not go up.
5. Device checks when a phone is available.

## 11. Plan for the next agent

1. Rebuild and publish the R7 boards (no app code). Report and wait for approval.
2. Playlists embedded background: transparent container, a regression test on the `PlaylistsScreen` source, and a patch bump.
   Do this after approval, or earlier if the owner allows a standalone bug fix.
3. Rows everywhere (item 9 + the lists rule):
   - one shared `SongRow` size: 56 tall, 44 cover with radius 6, title and artist one line each with an ellipsis;
   - a full-row `TactileRow` main target, with Download and ⋮ as separate 48dp targets;
   - restore Download on Stream/Search.
4. Bottom surface (item 8) and foreground-only nav (item 3):
   - `ShellMaterial` translucency with an opaque fallback;
   - remove the selected rectangle in `NativeTabBarView.drawV6` and the JS fallback indicator;
   - add a keyboard-focus ring.
5. Capsule chips (item 1) in `src/ui/Chip.tsx`; Play/Shuffle capsules (item 4) in `src/ui/Button.tsx` and the artist and
   playlist pages.
6. Action menus (item 2): an identity-first sheet in `Sheet` and the song-action hooks.
7. Voice search (item 6): listening inside the search field, copy per gesture, cancel/stop, reduced motion.

For each step: `npm run ci`, the relevant JVM tests (Mobile CI), a version bump from live main (patch for fixes, minor for
features), push, PR and merge. Then install the CI APK on the emulator and screenshot the result.

## 12. Open questions (defaults if no answer)

- Ship the Playlists fix before full approval? Default: ask once; if there is no answer, wait for approval.
- Menu pattern: default bottom sheet (rationale on board 2).
- Voice: default listening panel attached under the search field.
- Display size default: stays 100%.

## 13. Rules and guardrails

- Root `CLAUDE.md`: conventional commits, and no AI attribution footers in this repo's commits. This session's harness added a
  Co-Authored-By line; follow the repo rule from now on. Any mobile build needs an `expo.version` bump, and GitHub Actions
  builds the APKs.
- `apps/mobile/src/ui/AGENTS.md`: shared primitives and tokens, 48dp targets, no I/O in primitives.
- Playback invariants (root `CLAUDE.md`): one `requestPlayback` funnel; load effects never depend on `isPlaying`; a seek resumes
  playback if it was playing.
- FlashList feeds: no `ListHeaderComponent` for size-changing content, no percentage widths in cells, and no Reanimated
  `entering` in recycled cells (`apps/mobile/CLAUDE.md`).
- Never edit the primary checkout `C:\dev\allegra` or its dirty files. Never commit design boards or R7 code before approval.
- Do not delete files to free disk space without telling the owner first.

## 14. Continuation instruction

Start in `C:\dev\allegra-v6`. Rebuild the Round 7 boards, publish them as page `r7` on the canvas and present the completion
table for approval. Implement no Round 7 item until the owner approves; then work through §11 one PR at a time.
