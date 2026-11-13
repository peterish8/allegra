# Cook ledger: LuvLyrics player transition and Create sheet

Started: 2026-11-12 23:40 IST
Time: floor none | cap 3h (ends 2026-11-13 02:40 IST)
Bar: composition 9 | light 9 | color 9 | materials 9 | detail 9 | motion 9 (out of 10)
Calibration offset: none yet
Usage: 5h window, about 20% per hour, never 100%
Gate: stills approved no | final: PR not opened
Best so far: none yet

## Decisions

- 23:40 References are four stills captured with headless Edge from the approved prototype (R01–R04), because the owner approved that prototype's motion ("ok i like the animation do same now for our app!") and no other references were given.
- 23:40 Create sheet has no reference; its first approved still becomes R05 (cook "no references" rule).
- 23:40 Base is PR #84's branch (`feat/mobile-player-transition`); cook work goes on `feat/mobile-player-cook` on top of it.
- 23:40 APK comes from CI (local CMake build is broken per the 2026-11-12 handoff); the arm64 APK runs on the x86_64 emulator through translation. A rebuild for each round therefore needs a push and a CI build (~15 min), so rounds batch several fixes.
- 23:40 Critics are Sonnet subagents (Codex at usage limit), at least two per round.

## User feedback inbox

- (none yet)

---

## Round 1 (00:13-00:35 IST) - baseline 1.51.0 as installed
Stills: cook/stills/r01/  Side by side: cook/compare/r01/all.jpg
Critics (2 sonnet, fresh): median S01 comp 6 light 5 color 5.5 glass 4.5 detail 5 motion 6; S02 4/3.5/3.5/3.5/4/5; S03 5/4/5/4/3.5/5; S04 7/5/5.5/4.5/6/7. Weakest: rising surface (flat teal slab, hard edge, no glow) and cover growing too slowly at 35%/70%.
Not mine/unverified: title marquee clipped at left in S04 (marquee caught mid-scroll in NowPlayingControls); S01/S05 rest-state differences (Stream content) are not part of the transition.
Fix batch for round 2: cover ease-out (coverFrame), player contents fade in 34-72% instead of 52-88%, surface sheen + hairline rim on the rising sheet.

## Round 2 (00:50-01:08 IST) - build of commit 1 (cover ease-out, earlier contents fade, sheen)
Stills: cook/stills/r02/  Side by side: cook/compare/r02/all.jpg
Critics median: S01 5.5/5/5.5/4/4.5/5; S02 3/3/3.5/3/2.5/3; S03 4/3.5/4/3.5/3.5/4; S04 6/4.5/5/4.5/5/5.5. Worse than r01 at S02/S03: the quadratic ease-out put the cover above the rising surface's top edge (cover escapes the sheet). Title clipped at left at every stage.
Best so far: r01 for S02/S03 (by critics), r02 for contents timing. Not a clean win.
Fix for round 3: cover clamped inside the surface top (CoverGhost), gentler ease (power 1.5), title shift keyed on a shared value (NowPlayingControls dockedSV; stale -titleShift transform clipped the title).
