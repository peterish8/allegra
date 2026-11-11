# Allegra integration, 2026-11-11

## Combined source

The integration branch combines the dirty website player work, LightFM benchmark and development comparison, mobile display sizing, Create sheet and listening stats, and the Round 7 design handoff. Mobile version is 1.46.0. The current playback and security fixes from main remain intact. Large text now moves the mini player, native tab touch bounds and fallback tab layout together; native labels no longer cap system scaling at 130%.

The older frontend-polish, V6 followup and verification branches were reconciled with an ancestry-only merge: their designs were superseded by the V6 and Round 7 releases already on main. Their historical source is retained in Git. The old stash is retained, not applied over current source: it contains older documentation, a development build-tools dependency and local Gradle tuning. Original refs, stash and worktree files are backed up at `C:/dev/allegra-integration-backup-20261111`. Benchmark output was copied there and into the primary checkout's ignored `output/recommendations` directory.

## Verification

| Check | Result |
| --- | --- |
| Root typecheck | Passed |
| Root lint | Passed |
| Root tests, infra and Convex | Passed, including 106 Convex tests |
| Mobile check | Passed: 164 suites, 1308 tests; lint has existing warnings |
| Final modified mobile component lint | Passed |
| Android compile and JVM tests | Passed using 64-bit JDK 21; 35 test report files |
| LightFM recording matches | Three tests passed |
| LightFM export parity | 16 Python scores matched |
| Development preview | Populated public playlist comparison at 360/768/1280/1920; no page errors or document overflow |
| Physical device | No ADB device attached |

The browser harness routed preview requests to the configured local preview API on port 8082. This proves development rendering, not production activation, signed-in recommendations or audible playback. The initial Java on PATH was 32-bit Java 8; use `C:/Program Files/Eclipse Adoptium/jdk-21.0.9.10-hotspot` for Gradle here.

## Remaining acceptance and implementation

This integration does not close the entire earlier audit. Keep the following explicit until independently completed.

| Area | State |
| --- | --- |
| P1 parser, OAuth, logging and account outbox | Existing main implementation retained; automated gates pass |
| P1 signing continuity | Owner configuration and installed signer continuity unverified |
| Playback and playlist reorder | Automated coverage passes; physical drag, audio and accessibility acceptance pending |
| P2 updater identity/digest and atomic release promotion | Open implementation; current updater still uses the mutable release channel |
| P2 controller policy | Explicit policy audit remains; Media3 1.11.1 is installed |
| P2 network recovery and serialized empty queue writes | Existing main implementation retained; JVM tests pass |
| P2 native queue performance | Cache/measurement work remains |
| P3 large text | Source geometry completed; physical 100/130/200% verification pending |
| P3 navigation flash and busy-JS gesture acceptance | Runtime diagnosis and acceptance remain |
| P4 journeys and P5 baselines | Physical device unavailable; no runtime performance claims |
| Recommendations | Development comparison only; live feedback, eligible-account training, privacy lifecycle and pilot rollout remain separate unfinished work |

Media3 policy reference: https://developer.android.com/jetpack/androidx/releases/media3 and https://developer.android.com/reference/androidx/media3/session/MediaSession.Callback . Current upstream APIs must be checked before changing controller permissions.

## Merge and cleanup

Merge only after integration CI. Remove the three extra worktrees only after their source commits are preserved in the merged result, their ignored evidence is archived and their junctions have been detached. Retain the primary checkout. Never recursively delete a dependency junction or its target. Keep the stash and backup bundle until the owner no longer needs the historical copies.
