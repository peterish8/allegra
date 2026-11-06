# V6 remaining verification and remediation plan

Date: 2026-11-06. Baseline release: LuvLyrics 1.37.1, main `473c4d8806144619a19b9bb414d1dce31ad4d48c`.
Read `HANDOFF-2026-11-06-v6-verification.md` before executing. This covers corrections and remaining verification of a published release. Preserve the approved V6
visual direction, with the owner's newer animated header-glow requirement taking precedence over the static-glow rule.

## Order and dependencies

| Order | Slice | Can start without a phone? | Completion evidence |
| --- | --- | --- | --- |
| 0 | Preserve checkout and establish a fresh baseline | Yes | Exact branch/SHA, dirty-file ledger, release/CI manifest |
| 1 | Diagnose and fix the broader player smoke failure | Yes | Reproduced failing assertion, bounded fix/test, successful broader smoke run |
| 2 | Review the shipped UI across screens and states | Emulator first | Screen/state matrix, images, findings and fixes verified at the tested widths |
| 3 | Playback, sheet/keyboard, large text and TalkBack | Partial; phone required for final evidence | Real-device checklist and recordings/logs tied to the APK |
| 4 | Measure and address demonstrated performance problems | Instrumentation/emulator first; phone for final evidence | Repeatable timing/frame/memory data and justified before/after comparison |
| 5 | Verify in-app download and installation | Preparation yes; phone required for final evidence | Old signed install -> in-app update -> 1.37.1 or successor; data retained |
| 6 | Close the ledger and publish any fixes | Yes after relevant checks | Green PR/main gates, exact release manifest/asset, honest pending list |

Slices 2 and measurement preparation can proceed while CI runs. Do not combine speculative SQL changes
with the smoke fix. Use one concrete problem per PR; runtime fixes bump the patch version from the
latest live version, never from this dated plan alone. Documentation-only updates need no app bump.

## Owner-reported frontend corrections: required implementation work

New steering, 2026-11-06: the owner supplied two screenshots, said there are many similar UI and UX errors,
and asked that the next agent correct them across the app. The owner also requested animated glow across
the top approximately 20% of Stream and Library, disappearing above the viewport while scrolling down
and returning as the user scrolls back to the header. This supersedes the previous static-glow decision for
these two screens. This documentation turn plans that work; the shipped implementation is still static.

Evidence: `owner-evidence-2026-11-06/stream-overlap.png` and `player-up-next-overlap.png`; original attachment
paths and file hashes are in that folder's README. Image pixels are not dp. Do not infer device/font/API or
exact animation timing from the still images. The findings below are a starting list, not the complete audit.

| ID / priority | Observation / requested change | Investigate first | Acceptance and regression coverage |
| --- | --- | --- | --- |
| UI-01 / P0 | Stream mood chips overlap the Jump back in heading | Chip/Tactile wrapper layout, MoodChips horizontal ScrollView measurement, FlashList header/section measurement, font scale, native/JS bounds | Chips and heading occupy separate measured vertical bounds at 360/393/430 and 100%/200% text, after cold/warm load, refresh and scroll. Chip targets do not cover the heading or song targets. Verify actual layout plus a regression at the responsible shared seam. |
| UI-02 / P0 | Up next All/Familiar/Discover chips overlap the first queue row | `UpNextPanel.tsx` filter container has a fixed height; compare actual Chip and wrapper target/height, list header offset and native/JS parity | First queue row begins below the complete filter row at all text scales; selected state remains clear; filters, song press and drag handle do not steal each other's gestures. Exercise native queue and JS fallback. |
| UI-03 / P1 | Large unused vertical gap between Stream shortcuts and Quick picks | Actual FlashList item bounds versus estimates/recycling, dynamic section insertion, nested grid/ScrollView sizing, style margins/minHeight, text scale | Gap follows spacing tokens and content height without a viewport-sized blank region; partial 1?6 shortcut sets and history hydration/rotation/scroll remain correct. Do not hide a measurement bug with a negative margin. |
| UI-04 / P0 | Now playing title has split/clipped fragments near fullscreen/more/heart controls | `NowPlayingControls` metadata width, `SwapMarquee`, transform origins/clip bounds, native song-action overlay and lyric/Up-next transitions | One legible title lane, no fragment beneath action hit areas; artist remains readable. At rest use stable wrapping/ellipsis as appropriate; long-title marquee only when needed, clipped to its measured lane. Reduce Motion stays static. Actions retain independent 48dp targets. Test long scripts/RTL where supported, 200% text, rapid song changes, cover/lyrics/Up next and cancellation mid-animation. |
| UI-05 / P1 | Shortcut titles are severely truncated and dense | Available text width, artwork size, line count/line height, columns at font scale | Clear two-line title layout at normal scale; single-column/growing rows when required for large text. No forced tiny type or unintended early truncation with usable space. Long localized titles remain identifiable. |
| UI-06 / P1 | Smooth, predictable dropdown/menu access, opening, selection and dismissal across app | ConnectDropdown, all sort/filter/options menus, shared Sheet/Segmented/Tactile, focus and safe-area anchors | Trigger responds once, pressed/selected/loading states are truthful, open menu stays within viewport, backdrop and Back dismiss correctly, focus returns, selection commits once and state survives appropriate navigation. No invisible overlay intercepts later taps. Test fast repeated presses, scroll while open, orientation, keyboard and TalkBack. |
| UI-07 / P1 | Fluid scrolling, sheets, button access and gesture arbitration | Nested lists/pans, handle columns, horizontal chip drags versus parent vertical scroll, keyboard/shell clearance, sheet mounting and animation interruption | Scroll intent remains scroll, a tap invokes one action, sheet drag only closes from permitted regions/list-at-top, last item and all controls remain reachable. Test diagonals, slow/fast drags, fling-stop-tap, rapid open/close, background/foreground and pending async completion after dismissal. |
| UI-08 / P1 feature | Animated artwork glow in Stream/Library header, roughly top 20%, leaving and returning with header scroll | Shared Screen/CoverGlow and AppScreen bindings, actual scroll owners, insets/short viewports, UI-thread transforms, effect budgets | See executable glow contract below. Both screens meet the same contract with reusable code and runtime evidence. |

### Executable animated-header glow contract (UI-08)

- Scope: Stream and Library header region. Keep near-black content, white controls and restrained frost;
  artwork colours are atmosphere. Do not reintroduce a screen-wide moving shader or blur scrolling content.
- Height: approximately 20% of the usable screen height at rest, with soft falloff into the base. Derive from
  actual viewport/safe-area measurements and test short/tall screens; do not reuse a hardcoded 240dp as "20%".
- Motion: gentle low-amplitude transform/opacity drift of a cached low-resolution cover-tinted layer, preferably
  on the UI thread. No React state timer or continuously animated layout/blur radius. The exact path/timing is
  an implementation choice to be judged in motion, using the existing Motion/effect budget.
- Scroll: glow follows the header/content upward and is clipped out as the header leaves. Returning to the
  header reveals it again smoothly; scrolling must not remount/restart the animation or reset list position.
  Drive opacity/translation from the same authoritative scroll offset, not independent guessed positions.
- Preserve the pinned Stream title/Connect/LuvLyrics update controls added after the launch failure. The glow
  may disappear while the update button remains accessible. Do not undo that fix or make Updates unreachable.
  In Library, preserve tabs/search/sort access and deliberately define which chrome pins while the glow scrolls.
- Artwork: follow the current song's available cover; change artwork without flashing or dropping a frame.
  Default without artwork: near-black/no decorative colour, preserving the prior no-glow-before-song behavior.
- Pause off-screen/background. Reduce Motion uses a static glow and direct or minimal fade transitions; reduced
  transparency, Battery Saver and low-end devices use existing lighter/static or opaque fallbacks. The owner
  requested animation, not exemption from accessibility or power constraints.
- Verify: cold/warm starts, queue restore, no song, cover failure/song change, slow drag, fast fling, reverse drag,
  return-to-top, tab switch, 200% text, short screen, reduced effects and interrupted navigation. Record a clip and
  frame measurements on representative hardware. Animation quality cannot be approved from a still image.
- Tests: pure viewport/scroll-boundary math and cancellation/visibility behavior, plus integration checks that
  Stream/Library bind real scroll offsets and retain update access. Visual runtime tests must prove bounding
  boxes and return behavior; source guards alone are insufficient.

### Mini-player space and restored swipe transport (new owner steering)

| ID / priority | Request and verified starting point | Implementation work | Acceptance |
| --- | --- | --- | --- |
| UI-09 / P1 | Owner says the mini-player above navigation has excessive top space and wants more scrolling room. `v6Shell.ts` currently reserves a 24dp seek band plus 56dp mini row; `PillPlayer` also imposes its own row/info minima. | Measure actual shell, seek, row, artwork, text, safe inset and list clearance on device. Identify duplicate top padding/minHeight or excess reserved clearance before changing geometry. Derive one shared compact layout and update every consumer, including Connect and large-text paths. | A visibly slimmer resting mini-player, recorded before/after in dp, with the same measured gain in usable viewport/list clearance; no hidden last row, overlap or broken safe inset. Normal-size controls stay 48dp and text stays readable; large text may grow. |
| UI-10 / P1 | Owner explicitly wants the existing horizontal next/previous swipes wired back into the V6 mini-player with matching animations. `MiniPlayer.tsx` has old horizontal-pan handlers and passes onNext/onPrevious into PillPlayer. PillPlayer accepts onPrevious in Props but does not currently consume it; its horizontal seek gesture belongs only to the seek band. | Reuse the existing playback-owner callbacks and directional interaction/physics where correct. Wire horizontal metadata/artwork swipes, separating seek-band drag, vertical open-player pan, tap-to-open and transport buttons. Keep local/Connect behavior truthful. | Left swipe commits next and right commits previous in the existing LTR convention, once per intentional gesture; previous retains engine restart semantics. Cancelled/subthreshold/diagonal gestures settle cleanly. Seeking never skips, skipping never seeks/opens accidentally, and button presses never also swipe. |

UI-09 executable geometry requirements:
- The goal is recovered content space, not just visually moving the mini-player while keeping stale oversized
  padding in every screen. Trace `shellHeight`, `useBottomClearance`, PillPlayer, V6TabBar, ConnectMiniPlayer
  and native insets before editing. Remove double reservations and update layout/geometry tests together.
- A normal-font candidate to evaluate is a 48dp transport row with approximately 40dp artwork and the approved
  separate seek target, instead of the current 56dp row/44dp artwork. This is a recommended starting hypothesis,
  not a claimed approved final dimension or an instruction to clip text. Measure real gains and report them.
- Preserve the 24dp seek-band exception unless a different usable arrangement is explicitly validated; do not
  shrink its hit area, place an invisible seek target over scrollable songs, or overlap independent controls.
  Remove unneeded extra space above/below it. Accessibility targets and readability take priority over shaving
  every pixel; large-text/adaptive rows can remain taller than normal-font rows.
- Align the mini-player and nav as one restrained frosted shell. Safe insets are counted once; keyboard/player
  presentation hides/clearance remain correct. No generic absolute negative offsets as a layout fix.
- Check local playback, paused/loading/retry, no song, remote Connect, Luvs suppression, keyboard, large font,
  short screens and all three widths. Measure scroll viewport and final-item reachability before/after.

UI-10 executable gesture/animation requirements:
- Read the existing handlers first; do not invent another queue or call a second player. The present onNext/
  onPrevious callbacks already route to the owning local/remote controls. Reconnect them to the current V6 surface.
- Use deliberate horizontal intent, distance/velocity thresholds and cancellation, with shared Motion/physics.
  Validate thresholds relative to the actual mini-player width; a small noisy flick must not change a song.
  Horizontal drag in the seek band remains seeking. Vertical intent on metadata opens the player. Keep actual
  button targets independent and ensure a tap cannot fire both the child action and a parent open/skip action.
- Animate cover/text as a contained V6 transition (subtle translation/crossfade and a controlled settle), leaving
  nav and play/next controls stable. Never display the next title with the old cover as if committed, flash an
  empty frame, animate huge travel, or bounce the whole navigation shell. Commit visuals in sync with actual
  song identity/native feedback; loading/error/rejected/edge cases settle back to truthful content.
- Reduced Motion uses immediate state change or a minimal crossfade without a spatial carousel. Cancel active
  animation/gesture on song replacement, player/keyboard opening, lost focus, backgrounding or remote ownership
  change. No stale animation callback may skip another song or restore an obsolete cover.
- Preserve previous behavior when the current track is past its restart threshold and when the queue has one
  item/no valid next. Use existing queue rules, not unconditional index arithmetic. Test RTL explicitly if supported
  and retain clear accessible Previous/Next buttons; gestures must not be the only transport access.
- Tests: threshold/direction/diagonal/cancel cases, one commit per gesture, no cross-trigger with seek/open/button,
  late callback/song-id change, rapid repeated swipes, previous restart and queue edges, Connect routing and motion
  interruption. Runtime clips must show slow drag, flick, cancelled drag, repeated skip, buffering and reduced motion.

### Suggested correction PRs

After baseline and smoke diagnosis, implement UI-01/UI-02 together only if one shared chip measurement
cause is demonstrated. Otherwise split them. Then UI-03/UI-05 Stream hierarchy, UI-04 player metadata,
UI-08 shared animated header, and UI-09 compact shell, UI-10 restored mini-player swipe transport, then UI-06/UI-07 interaction findings in bounded groups with shared causes.
Audit the remaining screens while validating these slices; add discovered defects to the matrix with stable
IDs, reproduction, severity, expected behavior, cause, fix, tests and retest evidence. Do not limit scope to the
four visible overlaps merely because the owner supplied two images. Keep working until no known actionable
P0/P1 issue remains; explicitly track device-blocked checks without inventing a pass.

## 0. Establish the baseline

1. Inspect status, branch, remotes, worktrees, current main and PR/release state; preserve all unrelated work.
2. The primary checkout remains on the pre-squash feature head `c375296`; origin/main is the squash commit
   `473c4d8`. Do not treat the old feature commits as missing work and cherry-pick them onto main.
3. Work from a fresh branch based on fetched origin/main. A separate agent-owned worktree is appropriate;
   inspect whether its path/branch already exists before creating it. Do not move/delete the dirty checkout.
4. Record OS, Android/API, device model, logical width/height, font scale, refresh rate, APK version, build
   commit, build timestamp and signing source. Save raw evidence locally; commit a compact evidence index.
5. Confirm release 1.37.1 and its changelog commit; download the existing CI artifacts before they expire.

Acceptance: the chosen APK and source SHA agree, and pre-existing dirty files have not changed.

## 1. Broader smoke failure: first corrective PR

The release's launch gate passes, but `Mobile smoke test` run 42126270194 fails. Its failed step is
`Launch on emulator`, step 10; the log ends the player probe with 15 failed checks. There is a
`[diag:player-back] no focused handler` diagnostic and separate ADB failures. Neither observation alone
proves the cause. The previous main smoke run 41306254650 also failed; compare assertions and artifacts,
not just red/green labels, before calling this a new regression or an infrastructure flake.

- Read `.github/scripts/mobile-player-probe.sh`, `player-assertions.sh`, `mobile-android-smoke.sh` and the
  workflow. Read `player-controls.txt` in the artifact before changing application code or test assumptions.
- Reconstruct the sequence: open player, controls, background/foreground, media keys, close/reopen via
  mini player, restored queue, Back, cover/lyrics. Map each failure to an expected screen and owning handler.
- Separate app process/React-layer death, wrong route/sheet state, stale test labels, absent Back registration,
  media command failure and ADB/UIAutomator errors. Preserve the first failure and its preceding diagnostics.
- Use Graft callers before changing ownership/navigation. Keep the three playback invariants intact.
- Add a regression test at the actual seam; a source-pattern assertion alone cannot prove native focus or
  audible playback. If a harness label is obsolete, prove the corresponding control still works before updating it.
- Build through GitHub Actions. Run the broader smoke workflow on the fix branch using workflow_dispatch,
  because its automatic push trigger is main. Also require the existing PR APK launch gate.

Acceptance: all applicable player-probe assertions pass, no app crash or React-layer recovery is hidden,
and the exact branch run/artifact proves the repaired sequence. Do not weaken assertions or rerun until green
without a documented cause. Use the next patch version (1.37.2 only if 1.37.1 is still latest).

## 2. Implement screenshot corrections and complete the wider UI/UX review

Start with UI-01 through UI-10 above, then create `VERIFICATION-MATRIX.md` with a row per screen/state and columns for source SHA/APK, width,
font scale, normal/reduced effects, observed result, artifact, finding and retest. Mark unexecuted rows pending.

Cover Stream (first use, loading, populated, offline/cached, mood, long press, scroll, restored queue),
Library (four tabs, scope search, empty/no matches, sort retained after restart), playlist (empty/local/online/
mixed, sort/edit/reorder/remove/Undo, cover change), artist/album/mix, Search, You, Settings, About/Updates,
Luvs, DJ, Blends, LuvLink, downloads/import, lyrics editing and all sheets reached from those flows.

For Now playing cover lyrics closed/open, Up next populated/empty, loading, pause, retry/details,
seek success/failure/cancel, unknown duration, remote Connect and a joined LuvLink room. Use real supported
feature data/accounts; mark unavailable fixtures rather than pretending a static screen exercises the flow.

- Compare at logical widths 360, 393 and 430, plus a short viewport below 700dp. Include 200% text.
- Verify near-black/white hierarchy, one compact primary action, shared spacing/radius/type, square collections,
  round artists, song rows, legible metadata and separate action targets. Keep the Stream logo pinned and usable.
- Verify at least 48dp targets except the approved 24dp seek band. Check actual layout, not just token constants.
- Exercise opening/closing, interrupting and reversing animations; fast taps, track changes, background/foreground,
  reduced motion, reduced transparency, Battery Saver and low-end fallback. Watch for layout jumps, blank frames,
  gesture conflicts, dead controls and lingering overlays. Do not infer smoothness from static screenshots.
- Fix shared patterns in `src/ui`; keep application state and I/O outside primitives. Re-run design guards and
  focused behavior tests plus the full mobile gate for code changes. Rebuild the gallery only if a durable design
  rule changed. Update DESIGN.md with the same change.

Acceptance: every applicable matrix cell has evidence or an explicit blocker; failures have a fix and retest.
Emulator screenshots remain emulator evidence. A static gallery audit never becomes runtime/device evidence.

## 3. Real-device functional and accessibility checks

No phone was connected at the handoff's `adb devices` check. User deferred these checks; do not ask the same
question again. Complete independent work and retain pending rows until a device is available.

On a connected authorized device, record original font/display/accessibility settings before changing them,
and restore them after checks. Test a release APK, not only a dev client.

- Playback: pause stays paused during loading, lyrics changes, navigation and seeking; play resumes correctly;
  failed seeks restore the right position; track-change cancellation never seeks another recording; media keys,
  notifications/background playback, queue next/previous/repeat/shuffle and cold restoration remain coherent.
- Connect/LuvLink: only the selected playback owner produces audio; local actions do not steal remote playback.
  Note audible behavior separately from advancing timestamps or intent flags.
- Sheets/keyboard: fields stay reachable, list-at-top drag closes while scrolled lists scroll, Back closes the
  highest layer first, rapid reopen/close works, and keyboard dismissal restores shell/content clearance.
- 200% text: no clipped labels, hidden primary actions or overlapping row actions; tabs scroll, grids adapt,
  body text remains readable and content can reach its end. Test all three reference widths where feasible.
- TalkBack: sensible order, names/roles/states, independent song/action targets, announcements for errors/loading,
  seek increment/decrement, sheet focus/return, no duplicate decorative nodes and usable navigation.

Acceptance: device checklist includes reproducible steps, actual audible observations where applicable,
TalkBack behavior and artifact references. Only emulator-tested cells remain explicitly emulator-only.

## 4. Performance: establish numbers before optimizing

Use `services/performanceTrace.ts` with `EXPO_PUBLIC_PERF_TRACE=1` for an explicit diagnostic build, plus
Android frame/memory tools and existing diagnostics. Use the same device, APK build type, fixture/data size,
network condition and power mode for comparisons. Do not ship diagnostic flags accidentally.

Measure cold/warm app launch, player/lyrics/Up next transitions, continuous list scroll, Search local/catalog,
playlist open/header/first rows for small and large local/online/mixed playlists, and queue restore. Record
raw samples, repeat count, median/p95, frame distribution/jank, memory and relevant SQL counts/durations.
Separate provider latency, JS work, database work, image decode and drawing. Prefer at least three repeated
runs for an initial baseline; collect more when variance prevents a decision.

Unmeasured playlist suspects remain: per-song lookup after IDs (N+1), `getAllPlaylists` to read one header,
focus plus onlineVersion loads on mount, and sequential local/online fetches. Inline retry now exists;
old design notes that say all errors are silently swallowed need to be read as historical findings.

Only optimize the measured dominant cause, one slice at a time. Preserve ordering, membership/counts,
local/online merging, refresh correctness, stale-response protection and queue ownership. Add data-seam tests.
For list/SQL changes, compare identical fixtures and include cancellation/sync-arrival cases.

Acceptance: raw before/after data supports the claimed improvement and no functional regression appears.
Use explicit repository budgets where applicable. A 60fps visual cap is not a measured 60fps guarantee;
a 16.7ms 60Hz frame interval is context, not a newly approved universal SLO. If no approved latency threshold
exists, report the numbers and remaining uncertainty rather than inventing a pass threshold.

## 5. Published in-app update installation

Prepare a known older release signed by the same supported key and a disposable/authorized test library.
Never uninstall or clear the user's real app data to force a pass. Keep a recovery APK available.

1. Verify current `apk-latest` version/commit and asset, then install/retain the older signed build.
2. Enter Stream -> pinned LuvLyrics mark -> Updates. Check installed/new version and changelog readability.
3. Download; background/foreground and restart the UI while WorkManager owns the transfer. Test an interrupted
   network and retry. Confirm progress, error, ready/install and cancel/retry states are truthful.
4. Exercise Android's unknown-app-source permission round trip and installer confirmation; cancellation permits
   another install attempt. The updater stays in the app/Android installer and does not open a browser.
5. After installation, confirm the new version/build, retained songs/playlists/settings/queue and successful
   playback. Recheck: the same/older build is not offered as a newer update.
6. Validate wrong-package/signature rejection only with controlled fixtures or existing tests; never replace a
   public release with an intentionally invalid APK.

Acceptance: an actual old-to-new install, retained data and post-install check have device evidence.
Manifest publication, download success and installer launch are separate milestones, not installation proof.

## 6. Release and closure

Each code PR: patch bump for fixes, minor bump for the new animated header feature (derive from latest main), regression test per fix, mobile:check, relevant JVM tests, affected runtime/device
checks, updated docs, push/PR, linked PR and all required CI including APK launch. Only main publishes
apk-latest. Verify the main release's version/commit/assets after merge, plus the broader smoke result.

Finish by updating IMPLEMENTATION-STATUS.md, this plan and the evidence index. List remaining blockers
explicitly. Do not call validation complete with failed broader smoke, unfixed owner-reported UI/UX defects, missing device/accessibility evidence,
unmeasured performance claims or an untested install path. No backend/production data migration is needed
by this plan; if findings require an API contract change, propose that boundary separately.
