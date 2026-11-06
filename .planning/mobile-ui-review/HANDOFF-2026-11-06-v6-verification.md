# Detailed handoff: V6 frontend corrections, interaction polish and remaining verification

Date: 2026-11-06 (Asia/Calcutta). This is the current handoff. It supersedes stale implementation/release
status in `HANDOFF-2026-11-06-round6.md` while retaining that document as design history.
The newer owner screenshots and animated-header request take precedence over the earlier static-glow rule.

## 1. Read first

All paths below are relative to `C:\dev\allegra` unless absolute.

1. This file: `.planning/mobile-ui-review/HANDOFF-2026-11-06-v6-verification.md`.
2. `.planning/mobile-ui-review/PLAN-V6-VERIFICATION.md`: executable work order, correction IDs UI-01?UI-10,
   animated-glow contract, device/performance/update-install acceptance checks.
3. `.planning/mobile-ui-review/owner-evidence-2026-11-06/README.md` and both local screenshots it names.
4. `AGENTS.md`; follow its project orientation in order: `docs/architecture.md`, `docs/api-contract.md`,
   `.planning/ROADMAP.md`, `docs/workflows.md`, root `CLAUDE.md`.
5. `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md`, `apps/mobile/src/ui/AGENTS.md`.
6. `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md`, `REDESIGN-V6-NOTES.md`, `REDESIGN-V5-SPEC.md`.
7. Historical `.planning/mobile-ui-review/HANDOFF-2026-11-06-round6.md` and `FRONTEND-POLISH-PLAN.md`.
8. The actual source and GitHub results named below. Do not rely on an earlier conversation or assume a
   green launch check proves the broader smoke, visual correctness, device playback or update installation.

## 2. Project context

LuvLyrics is Allegra's Android music/lyrics app, in `C:\dev\allegra\apps\mobile`. Stack at this handoff:
Expo SDK 54, React Native 0.81.5, React 19.1.0, TypeScript 5.9.2, React Navigation, Reanimated/Gesture Handler,
FlashList and SQLite. Android audio is owned by Media3/native Kotlin; iOS uses expo-audio. Connect/LuvLink
have explicit playback routing and ownership. Mobile is not a root npm workspace and has its own lockfile.

Repository: https://github.com/peterish8/allegra (origin); upstream is ROSHINI-CLOUD/allegra.
Live main after `git fetch origin`: `473c4d8806144619a19b9bb414d1dce31ad4d48c`.
Primary checkout: branch `feat/mobile-frontend-polish`, HEAD `c375296589c53f966144c1c954b141a4de9c3a27`.
One worktree was registered at the check. The feature branch was squash-merged, so its SHA differs from main.
Do not cherry-pick its two old commits onto main as supposedly missing changes.

Pre-existing unrelated dirty work, preserved throughout:
- `apps/mobile/android/gradle.properties`: local memory/cache tuning.
- `apps/mobile/package.json` and `package-lock.json`: unused build-tools devDependency change.
- Untracked `.planning/ui-reviews/`: pre-existing unrelated local artifacts; do not discard or sweep into a PR.
This planning turn adds/updates documentation and local evidence; it does not change application behavior.

Exact useful commands (PowerShell):

```powershell
Set-Location C:\dev\allegra
git status --short
git remote -v
git worktree list
git fetch origin
git rev-parse HEAD origin/main
npm run mobile:check
npm run security:secrets --prefix apps/mobile
adb devices
```

For a fresh execution checkout, inspect path/branch existence, then create your own branch from fetched
origin/main without disturbing the dirty primary checkout. For example, if both are unused:

```powershell
git worktree add -b fix/mobile-v6-verification C:\dev\allegra-v6-verification origin/main
Set-Location C:\dev\allegra-v6-verification\apps\mobile
npm ci
npm start
```

Do not run the illustrative worktree command blindly if that path/branch already exists. Read the rules in
the actual worktree. The user requested GitHub Actions to create APKs, not repeated local APK builds.
Native Kotlin compile/JVM-only checks may be used when relevant; CI uses Java 17. Earlier local native
checks passed with process-local Temurin JDK 21, not a machine-wide JAVA_HOME change.

## 3. Goal and current status

The overall goal is a consistent, reusable, maintainable V6 frontend with clean hierarchy, restrained frost,
fluid interactions and reliable playback/update access. The V6 code has shipped as **1.37.1**, but the owner
has now supplied visible UI defects and explicitly requested corrections throughout the app, interaction
polish and animated Stream/Library header glow. Those corrections are planned, not implemented. The
broader player smoke test is still red, and physical-device/accessibility/performance/install checks remain
open. Read the plan and execute the remaining work in bounded tested changes; do not restart the redesign.

## 4. Decisions and approvals

Dates refer to the session's local date, 2026-11-06. Short quotes preserve the owner's intent.

| Decision | Owner's words | Status / authority |
| --- | --- | --- |
| V6 defaults | ?Use all recommended defaults.? | Approved: Search and You tabs, Ionicons, retire three shell settings but retain Player background, compact shell below 700dp, Artists/Albums, remembered sort, Undo and membership ticks. |
| Repo design reference | ?You don't need the canvas: the same designs are in the repo.? | Approved: use local gallery and generator. Canvas republishing waived. |
| Reusable frontend | ?make the overall frontend system itself! for reuse and ai agent maintainable code? | Approved: shared tokens, components, global rules and documentation; avoid divergent buttons/rows. |
| Autonomy and release | ?just code it and test and push and merge already all!? and ?let gh cli do the building app and apk making? | Authorized: implement, test, bump version, push, PR, merge after required checks, and ship through GitHub Actions. |
| Defaults/questions | ?dont ask questions to me and just do whatever is recmended acc to plans!? | Use the established defaults and continue independent work; do not repeat optional questions. |
| Phone checks | ?Prepare the code; device checks remain pending? | Explicitly deferred when no ADB phone was available; do not fabricate device results. |
| Update entry | ?i want the luvlyrics icon in stream page top right so i could go there and update? | Approved and retained: preserve pinned logo/Updates access while fixing glow/scroll behavior. |
| New defects / wider audit | ?see these two images mistakes and like this there are many frontend ui mistakes and few ux mistakes so all these i want u to correct!? | Newly approved correction scope, beyond just the two screenshots; see UI-01?UI-07. |
| Interaction polish | ?smooth fluid dropdown showing and scrolling and accessing and clicking btns? | Newly approved: review menus, scrolling, sheets, gestures, button feedback/accessibility and their interruption states across app. |
| Animated headers | ?the top 20 percent there shld be the glow animated stuffs in header in stream and library and if scroleld it can go disappear in top but scroleld back shld come back? | Newly approved UI-08. Supersedes static glow for Stream/Library. Preserve accessibility/power fallbacks and pinned update access. |
| Mini-player density | ?the mini player bar near nav bar the height ... is too much extra in top side ... reduced smartly and give more scrolling area? | Newly approved UI-09: measure/remove excess shell space and reclaim actual list viewport, without clipping text or weakening independent targets. |
| Mini-player swipe transport | ?swiping lect and right fro the next and prev song ... it was laready there pls wire and correct the animations according to our new deisgn!? | Newly approved UI-10: reconnect existing owner callbacks to horizontal V6 mini-player gestures, with restrained interruptible animation and seek/open/button arbitration. |
| Current request | ?make a plan ... write a detailed-handoff? and ?write these corrections ... in handoff now? | This turn produces detailed executable docs. No application correction is claimed from this documentation turn. |
| Delegation limit | ?gpt 6 luna at high only ... easy stuffs? | If delegating, only easy bounded work on GPT-6 Luna/high; important fixes remain with the primary agent. Follow current T3 tool rules for user-specified settings; no unrequested model substitution. |

No alternative visual direction was approved. Exact menu easing/path is not specified; use existing motion
principles and measured runtime review. No new backend/API-contract change or production data migration is
needed by this plan; if one becomes necessary, propose that boundary before altering the contract.

## 5. What was done leading to this handoff

### Shipped source

- `src/constants/allegraTheme.ts` and `src/ui/`: semantic colour/type/spacing/shape/motion and shared controls,
  screen/rows/cards/sheets/transport. `src/ui/AGENTS.md` explains reuse and application-binding boundaries.
- `components/AppScreen.tsx`, `ui/Screen.tsx`: current source uses static cover glow. The newer animated
  scroll-linked header request is pending, not an existing behavior to report as complete.
- `components/V6TabBar.tsx`, `ShellMaterial.tsx`, `navigation/v6Shell.ts`, Kotlin `NativeTabBarView.kt`:
  five tabs, flush shell, bitmap frost/fallbacks and compact geometry.
- `PillPlayer.tsx`, `playback/playbackStatus.ts`, `seekTarget.ts`, player store/context reporting and shared
  `PlaybackButton`: seek/loading/error feedback while preserving existing audio owners.
- Library scope tabs, playlist mosaic/compact pages/Undo/membership ticks, Stream typed hierarchy and
  real MixScreen, compact artist/album pages, You and utility screen token changes.
- `about/AboutSheet.tsx` and `UpdatePanel.tsx`: Updates first, clearer creator/feedback/privacy layout,
  existing WorkManager download and Android installer path retained.
- Initial PR emulator failure: restored feed hid its header on second cold start. `StreamScreen` now pins
  title/Connect/LuvLyrics above FlashList and disables automatic visible-item anchoring. Two structural
  regressions were added. Do not undo update accessibility while adding animated glow.
- Explicit React imports restored in four presentation files for the classic-JSX Jest coverage transform;
  runtime typechecking uses automatic JSX. A zero test exit alone had not exposed failed coverage collection.
- `.github/workflows/mobile-apk.yml`: PR APK build plus emulator launch; only main publishes apk-latest.
- Pending Metro Windows resolver and listenTracker reentrancy fixes were included with regression tests;
  queue-next helpers are consumed by shared song actions. Unrelated Gradle/devDependency edits were excluded.

### This documentation turn

- Rechecked local Git provenance, current main, PR merge, release/manifest and failing smoke workflow.
- Downloaded the broader smoke artifact and inspected its player-controls failure sequence.
- Visually inspected both owner screenshots, preserved local copies and recorded original paths/hashes.
- Wrote `PLAN-V6-VERIFICATION.md`, this handoff and its starter prompt. Updated surrounding status/rules
  to separate shipped behavior, planned corrections and pending evidence. No runtime code was edited.

## 6. Where everything lives

| Artifact | Exact location / purpose |
| --- | --- |
| Current plan | `.planning/mobile-ui-review/PLAN-V6-VERIFICATION.md` |
| This handoff | `.planning/mobile-ui-review/HANDOFF-2026-11-06-v6-verification.md` |
| Starter | `.planning/mobile-ui-review/STARTER-PROMPT-v6-verification.md` |
| Owner screenshots + provenance | `.planning/mobile-ui-review/owner-evidence-2026-11-06/README.md`, `stream-overlap.png`, `player-up-next-overlap.png` |
| First original image | `C:\Users\nithy\.t3\userdata\attachments\066d1c9a-cdf0-4e2a-8839-21b783228379-3f1c2397-6df0-4ba4-ba5a-7bcf1c2ba29c.png` |
| Second original image | `C:\Users\nithy\.t3\userdata\attachments\066d1c9a-cdf0-4e2a-8839-21b783228379-b41eda7e-c8a2-4268-9c05-3ed0ffc60dc6.png` |
| Gallery | `.planning/mobile-ui-review/design-gallery/index.html`, adjacent `V5-*.html` boards |
| Design source | `.planning/mobile-ui-review/design-drafts/`: v5_kit.py, v5_round6.py, v6_finish.py, v5_build.py, v5_audit.py, project/*.dc.html |
| Current runtime contract | `apps/mobile/DESIGN.md`, theme tokens, `src/ui/` and its AGENTS.md |
| Release ledger | `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md` |
| Merged PR | https://github.com/peterish8/allegra/pull/58 |
| Passing PR APK/launch | https://github.com/peterish8/allegra/actions/runs/42121774797 |
| Passing main APK/publication | https://github.com/peterish8/allegra/actions/runs/42126270090 |
| Main CI / Mobile CI | runs 42126270353 / 42126270342 on the same main commit |
| Failing broader smoke | https://github.com/peterish8/allegra/actions/runs/42126270194 |
| Broader smoke local evidence | `.planning/mobile-ui-review/ci-smoke-42126270194/player-controls.txt`, `probe/controls.txt`, screenshots/logs in that folder |
| Failed main smoke raw log | `.planning/mobile-ui-review/v6-main-smoke-failed.log` (local PowerShell redirect is UTF-16) |
| Initial PR failure evidence | `ci-launch-42116277462/second-no-about.png`, ui.xml and logs, locally under the same planning folder |
| Local passing test log | `.planning/mobile-ui-review/mobile-check-v6-launch-fix.log`: 130 suites / 1,041 tests |
| Public release | https://github.com/peterish8/allegra/releases/tag/apk-latest |
| Public APK | https://github.com/peterish8/allegra/releases/download/apk-latest/LuvLyrics.apk |
| Public manifest | https://github.com/peterish8/allegra/releases/download/apk-latest/changelog.json |
| Historical canvas | https://claude.ai/artifact/UGiYJ1UaRjWA66qTFjsmHT#page-599f7f1e5928 (not required, republishing waived) |

PNG/log/XML evidence and CI artifact folders are ignored locally. Markdown provenance is portable, but those
binary/raw files are not automatically carried by Git. Transfer them explicitly for another machine, or
re-download the CI artifacts. The owner's two screenshots have no APK/device/font-scale metadata attached.

## 7. How to work with the artifacts

Run from the named working directories; preserve literal newlines when writing PR bodies. Prefer body files.

```powershell
# Repository root: recheck current host truth before acting
gh pr view 58 --repo peterish8/allegra --json state,mergeCommit,mergedAt
gh run list --repo peterish8/allegra --branch main --limit 8 --json databaseId,name,status,conclusion,headSha
gh release view apk-latest --repo peterish8/allegra --json name,publishedAt,assets,url
gh run view 42126270194 --repo peterish8/allegra --log-failed
gh run download 42126270194 --repo peterish8/allegra --name mobile-smoke --dir .planning/mobile-ui-review/ci-smoke-42126270194

# From .planning/mobile-ui-review/design-drafts
python v5_build.py ../design-gallery
python v5_audit.py
```

The generator produces 21 boards; this count/static audit passed earlier, not re-executed in this planning
turn. Never hand-edit generated gallery HTML and expect regeneration to preserve it. Change source then
regenerate. User screenshots are bug evidence, not mockups to copy literally, and do not need image generation.

For a bounded correction branch, use `gh workflow run mobile-smoke.yml --repo peterish8/allegra --ref <branch>`
to run the broader smoke before merging; automatic smoke triggers are main pushes. Get the actual run ID
from `gh run list`, do not assume it. Mobile APK PR checks already build and launch-test.

T3 PR monitoring repeatedly stopped after eight host-read errors even though gh CLI worked. Recheck with gh;
when waiting on an open PR, restore watch_pull_request after the latest push and end the turn as its tool
requires. Do not merge on stale green checks, ignore a failed emulator gate, or claim a watch is running when
it stopped. No current PR watch is needed for merged #58; it was explicitly unwatched.

## 8. Verified facts and evidence boundaries

Checked in this planning turn unless marked historical:

| Fact | Evidence |
| --- | --- |
| PR 58 merged | gh pr view: main squash SHA `473c4d8`, merged 2026-11-05 23:01:02 UTC (Nov 6 IST) |
| Published release | gh release view: LuvLyrics 1.37.1, published 2026-11-05 23:20:20 UTC |
| Manifest version/commit | gh asset API 715184014: 1.37.1 and full `473c4d8...` SHA |
| Source version | `apps/mobile/app.json:5`, 1.37.1 |
| Pinned update label / feed anchoring | `src/screens/StreamScreen.tsx:641` and `:652`; ListHeaderComponent at :664 no longer owns logo |
| Static current glow | `src/ui/Screen.tsx:7` onward; animation and scroll-linking requested now are pending |
| Shared chip | `src/ui/Chip.tsx:25-58`; inspect wrapper and parent sizing when reproducing overlap |
| Up next panel/list | `components/player/UpNextPanel.tsx:341-366`; fixed filter style near :423 and nativeList at :432 |
| Player title/marquee | `components/NowPlayingControls.tsx:483-486`, metadata styles :671-683 |
| Public APK URL | `services/appUpdate.ts:16`; installed-build metadata :58, standingOf :71 |
| Native updater | AppUpdaterModule.kt:15-69; WorkManager status and Android install-permission/installer path |
| Performance trace opt-in | `services/performanceTrace.ts:153`, EXPO_PUBLIC_PERF_TRACE=1; export/log markers near :139-143 |
| No connected phone | `adb devices` returned an empty attached-device list |
| Broader smoke is red | gh run view 42126270194, failed Launch on emulator step 10; artifact player-controls.txt has 15 failed checks |
| Historical local gate | mobile-check-v6-launch-fix.log: 130 suites / 1,041 tests, no lint/type errors or coverage collection failures; not rerun for docs only |
| Historical native check | compileDebugKotlin/testDebugUnitTest exit 0; separate from runtime/device evidence |

Source line numbers can drift after fixes. Graft is the primary code exploration tool; absent graph edges
are not proof of no callers. User images prove the visible defect on that capture, not its code cause, timing,
APK commit, logical width, font scale, device model or all other screen states.

## 9. Known problems and findings

### Owner screenshots: real correction backlog

- UI-01: Stream mood chips overlap Jump back in heading. UI-03: a large unexplained gap precedes Quick picks.
- UI-02: Up next All/Familiar/Discover filter region overlaps the first queue row.
- UI-04: Now playing title fragments are clipped/split across the title/action lane. Do not assume duplicated
  song data; inspect marquee clipping and action layout in motion.
- UI-05: shortcut song labels are dense/tightly truncated. Review correct wrapping and adaptive columns.
- UI-06/UI-07: user reports wider UX issues and requests fluid dropdowns, scrolling, access and button actions.
  Perform the full audit, not just a cosmetic fix of those two captures.
- UI-09: excess mini-player top space wastes usable content viewport; measure actual row/seek/inset and
  reserved list clearance before shrinking. Candidate compact row geometry and validation are in the plan.
- UI-10: existing horizontal skip handlers remain in MiniPlayer's older path, and onNext/onPrevious are passed
  to PillPlayer, but current PillPlayer does not consume onPrevious or wire a horizontal song-skip gesture.
  Restore the feature through those owner callbacks, not a new audio/queue implementation.
- UI-08: current static 240dp CoverGlow does not implement the new approximately-20%-viewport animated,
  scroll-away/return header behavior for Stream/Library.

The plan gives candidates to measure, exact acceptance checks and a correction PR order. Chip/parent
height mismatch and recycled section measurement are hypotheses, not confirmed root causes. Do not mask
layout problems with negative margins, oversize overlays, smaller fonts or hardcoded spacer patches.

### Broader smoke: exact observed sequence

Artifact `player-controls.txt`: A cover controls and Pause checks pass; B lyrics/return-to-cover controls and
Pause checks pass. C round 1 after Next passes. From C round 2 reopening onward, Previous/Next/Play-Pause
are missing (app nodes 0), through rounds 3?5. D screen-off media Next/Previous do not change the reported
song; controls remain missing on return. E reports no song on return/restore and missing controls after a
kill/relaunch. The app-running assertions pass. Log also contains player-back no-focused-handler and ADB
errors. A live process alone is not evidence of working UI or correct audio. Diagnose the first divergence;
later failures may cascade. Compare the previous-main failed smoke rather than assigning regression blame.

### Unverified and remaining

Actual phone playback, sheet/keyboard behavior, 200% text/TalkBack, smoothness/frame timing, database
latency and old-to-new in-app installation have no final device evidence. Playlist N+1/header-wide-read/
duplicate-load/sequential-fetch suspects remain unmeasured. The latest inline retry already exists; do not
repeat the old claim that the current screen can only swallow errors.

## 10. Remaining work, prioritised

1. Preserve baseline/provenance and reproduce the smoke's first failing transition; fix it with native/runtime
   proof. Done means applicable broader probe assertions pass, not only unit or launch success.
2. Correct P0 visual overlap and title-lane defects UI-01/UI-02/UI-04; then Stream gap/shortcut UI-03/UI-05.
   Done means measured non-overlap and verified gestures/text/targets across the stated matrix.
3. Implement UI-08 animated Stream/Library header glow, retaining update entry access and effect fallbacks.
   Done means scrolling, return, interruption and motion/performance evidence, not a screenshot.
4. Correct mini-player height/actual content clearance (UI-09) and restore horizontal next/previous transport
   with V6 motion and gesture arbitration (UI-10). Then complete UI-06/UI-07 and every-screen interaction/state review. Add findings and fix shared causes in small PRs.
5. Complete device accessibility/playback/sheet checks when a phone exists; retain pending status otherwise.
6. Establish performance baselines; fix demonstrated causes only and verify data/queue invariants.
7. Prove old signed build -> in-app download/permission/install -> new version and retained data on a phone.
8. Verify main release(s) and close the evidence ledger, keeping any unavailable checks explicit.

## 11. Plan for the next agent

Execute `PLAN-V6-VERIFICATION.md`; the following is the reviewable slice structure, not permission to ship
untested changes in one giant PR:

| Slice | Work | Required acceptance before claiming complete |
| --- | --- | --- |
| A | Baseline/evidence, smoke diagnosis and smallest correct fix | First divergence reproduced; behavior regression; full mobile gate; relevant Kotlin tests; broader branch smoke and PR launch pass |
| B | Chip measurement/flow repair on Stream and Up next | Shared cause demonstrated if grouping; separate if not; no overlaps at 360/393/430, 100%/200%; filters/scroll/drag/targets work |
| C | Stream blank-gap and shortcut hierarchy | Actual section bounds/height measured; 1?6 items and asynchronous history/refresh/return-to-tab cases tested; no negative spacer workaround |
| D | Player title/action/marquee correction | Long/localized titles and large text readable; native/JS action paths; cover/lyrics/Up next/interruption/reduced motion; no action overlap |
| E | Reusable animated header and scroll binding | UI-08 full contract; static/opaque accessibility/power fallbacks; current artwork changes; update logo stays reachable; clips and frame traces |
| E2 | Compact mini-player/shell UI-09 | Actual normal-font height and viewport gain recorded; shared clearance/insets and Connect/large-text/hidden states agree; targets and seek remain usable |
| E3 | Reconnect horizontal mini-player skip UI-10 | Existing callbacks/ownership; LTR left-next/right-previous with engine previous semantics; cancellation/one-commit/seek-open-button separation; rapid/remote/reduced-motion runtime proof |
| F | Dropdown/menu/button/sheet/scroll findings | Interaction matrix across app; one action per tap; safe anchors; focus/Back/keyboard; no intercepted stale overlay; interruptible motion |
| G | Device, accessibility, measured performance | Raw reproducible evidence; fix measured dominant bottleneck and retest; unavailable phone remains a blocker, not a request to invent results |
| H | In-app installation and release closure | Actual signed upgrade and data retained; correct post-install state; main manifest/build/launch/probe evidence and updated docs |

Fix PRs bump patch versions from live main; new animated-header capability merits a minor bump under the
project rule. Do not reserve numbers now or downgrade a newer release. Update DESIGN/CLAUDE/plan/ledger
where behavior changes. GitHub builds APKs; link each PR immediately after create/push via the host tool,
watch pending checks, merge only when required gates pass, then verify main publication. No local APK is
needed merely to check these docs. Do not fabricate provider/account, accessibility or audible results.

## 12. Open questions and recommended defaults

No blocking design question remains; do not ask the owner to repeat accepted choices.

- Exact root causes of screenshots/smoke: reproduce and measure; do not assume. If evidence is insufficient,
  record a pending investigation with the smallest next measurement.
- Header animation shape/timing: gentle transform/opacity drift using shared motion/effect budgets; no
  continuous expensive blur/layout updates. Scroll the glow away, keep update access pinned.
- Header with no artwork: near-black/no glow, retaining the previous no-song behavior unless later directed.
- Library pinning details: keep tabs/search/sort usable, while the glow tracks the content/header scroll.
- Missing phone/account fixtures: continue independent code/emulator/instrumentation work and mark specific
  checks pending. The owner already deferred device checks; do not stop unrelated work for another question.
- Unstated performance SLO: use repository budgets and measured before/after data; do not invent an approval.
- Gallery/runtime disagreement: the newer user correction wins. Update source and generator for a durable
  approved design change; do not treat the old static gallery as reason to reject the animated header.

## 13. Rules and guardrails

- Root AGENTS/CLAUDE and mobile CLAUDE apply. Read architecture/workflows and the FE/BE contract boundary.
- Use Graft first, callers before refactors; fall back for unindexed docs/new source. Preserve unrelated dirt.
- Native Android owns playback state. All UI commands use owner callbacks/requestPlayback; raw setIsPlaying
  is native synchronization. Audio-loading effects never depend on isPlaying. Keep iOS guard behavior distinct.
- No second audio owner, screen load helper or primitive with persistence/player I/O. Connect/LuvLink routing
  must not be bypassed by retry, queue, voice, menu or device-transfer actions.
- Shared theme/UI controls; 48dp targets, approved 24dp seek-band exception, 400/600/700 text, no arbitrary
  tracking. Actual measured bounds matter. White action accent, artwork atmosphere, restrained frost.
- No paired Reanimated layout/exiting crash pattern. No performance claim from a static artifact or compile.
- Use small feat/ or fix/ branches and conventional commits, no AI attribution footers. Current create-pr skill
  lives at `C:\Users\nithy\.agents\skills\create-pr\SKILL.md`; adapt master/main naming to live repo.
- Full mobile checks before a code PR; one regression per fix and affected runtime proof. Do not relax the
  launch or broader player-probe assertions to get a release through. Document infrastructure vs app failure.
- User authorizes coding/test/version/push/merge/release. Future PRs must still meet checks; no extra optional
  confirmation is required. Physical constraints and real Android installer permission cannot be fabricated.
- Keep secrets out of source, logs and frontend config. Existing CI keystore secret is bound to a signing file;
  the external config audit comment is not evidence that a secret was printed. Never print its contents.
- Only easy delegation on GPT-6 Luna/high if needed; follow current native/delegate tool restrictions.
- Memory was consulted only for the live-verification principle. Do not update global memory without a direct
  user request. This handoff is in the repository planning area, not a memory update.

## 14. Continuation instruction

Start by reading the plan and both owner screenshots, preserving the dirty primary checkout and selecting a
fresh branch from current origin/main. Reproduce the player smoke's first failure and the screenshot layout
bounds, then take the first bounded corrective slice through tests and runtime evidence. Continue through
UI-01?UI-10 and the wider interaction/device/performance/install plan; report exactly what is fixed, shipped,
verified on which surface, and still pending without asking the owner to repeat established decisions.

## Update, 2026-11-06 (later)

1.38.0, 1.38.1 and 1.39.0 shipped (PRs 59-61). The Round 7 design brief is paused for owner approval. Continue from [HANDOFF-2026-11-06-r7-design-brief.md](HANDOFF-2026-11-06-r7-design-brief.md).
