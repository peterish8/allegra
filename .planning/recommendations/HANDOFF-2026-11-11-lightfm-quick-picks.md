# Allegra Quick Picks and LightFM handoff

## 1. Read first

1. This handoff and [the starter prompt](STARTER-PROMPT-lightfm-quick-picks.md).
2. [Repository instructions](../../AGENTS.md) and [project rules](../../CLAUDE.md).
3. [Recommendation plan](PLAN.md) and [benchmark instructions and results](../../tools/recommendations/README.md).
4. [Current codebase map](../../docs/current-codebase.md) and [API contract](../../docs/api-contract.md#get-apirecommendations) for the relevant surfaces. Confirm the contract against the actual route and service before editing.
5. Read the [Convex guidelines](../../convex/_generated/ai/guidelines.md) before changing Convex. Read [Android rules](../../apps/mobile/CLAUDE.md) and the relevant design guide before touching Android.

This is the first recommendations handoff. The main checkout also contains a separate playback handoff.

## 2. Project context

Allegra provides a Next.js web app, an Express and TypeScript API, and the Expo Android app LuvLyrics. The API is served by a Vercel function. Convex holds authenticated listener profiles and durable listening data. The benchmark uses Linux Python 3.11, LightFM 1.17 with WARP, NumPy 1.26, SciPy 1.13 and scikit-learn 1.5.2. Librosa 0.11 and FFmpeg analyze audio excerpts.

Use `C:/dev/allegra-lightfm` on `codex/lightfm-benchmark`. The two local implementation commits are `e9be653e` and `26a63ecb`, based on `f2223c66`. The branch was two commits ahead of local `origin/main` before the handoff edits. The checkout at `C:/dev/allegra` has unrelated work on `fix/playback-skip-glitches`. Keep its files and index intact.

From the benchmark worktree, install root dependencies with `npm.cmd ci` when needed. Run `npm.cmd run dev` for web on port 5173 and API on port 8080. Use `http://localhost:5173` for browser and playback verification and `http://localhost:8080/api/health` for API health. The repo checks are `npm.cmd run typecheck`, `npm.cmd run lint` and `npm.cmd test`. Use `npm.cmd run mobile:check` when Android changes.

## 3. Goal and current status

Improve Quick Picks for Allegra listeners. A batch-trained LightFM model should learn long-term preferences and a live reranker should use recent acknowledged plays, skips, likes and saves. The offline JioSaavn benchmark and the playlist model artifact are complete. The model's profiles represent public playlists. An Allegra account cannot use one as its learned taste vector. The immediate pending deliverable is a local side-by-side preview using the real recommendation path. API integration, the feedback path, the opt-in listener pilot and production training or activation are pending.

## 4. Decisions and approvals

| Date | User wording or decision | Status and scope |
| --- | --- | --- |
| 2026-11-11 | “ok keep lightfm and add live re rnking!” | Approved the LightFM and live reranking direction. Release remains subject to the later pilot decision. |
| 2026-11-11 | “use real data and geenrous amount of data and do” and “check quick pick old and this lightfm picks” | Approved public JioSaavn catalog and playlist collection, training and comparison with the existing ranker. |
| 2026-11-11 | “enhance with many more input candidates for teh song” and “attach and train lightfm propelry” | Approved researching and using audio feature APIs with the expanded benchmark. ReccoBeats lookups resumed at a slower pace after HTTP 429 and completed on the same client. |
| 2026-11-11 | “shld we host this model or what is the next step” | Side-by-side local preview was presented as the next step. Hosting, enabling an experiment for users and shipping remain open. |
| 2026-11-11 | “all those left things still yet pemding ... detailed handoff ... and stop” | Write the handoff and starter, then stop. Continue implementation after the user starts or directs the next session. |
| 2026-11-11 | “also copy that skill to ur codex also! for future use” | Copied the standalone Claude `detail-handoff` skill to `C:/Users/nithy/.codex/skills/detail-handoff/SKILL.md`. Source and destination SHA-256 hashes matched. |

The user previously said “dont use subagenst from now on”. Work directly. The earlier authorization to push documentation to `main` was for the separate docs refresh and was already used for `f2223c66`. Treat the recommendations preview, pilot data access, rollout and release as separate decisions. The proposed 5% ranking lift and 50 ms added p95 budget are review defaults.

## 5. What was done

- `e9be653e` added the JioSaavn playlist collector, the baseline using Allegra's real recommendation service, audio tempo analysis, LightFM training, the TypeScript score checker and the implementation plan.
- `26a63ecb` added catalog expansion, a rate-limited ReccoBeats lookup, strict recording matching and tests, local audio descriptors, weighted item features and four model comparisons. The benchmark reuses the original 48 evaluation cases and fits continuous feature bins on training recordings.
- The expanded snapshot contains 4,461 recordings and 122 playlists. Training used 3,208 playlist memberships across 2,968 recordings. Local analysis produced descriptors for 3,199 excerpts. ReccoBeats returned features for 85 of 180 searched recordings, including 41 unique Quick Picks candidates.
- BPM coverage rose from 34 to 1,109 of 1,539 candidate appearances. The expanded candidate pool could reach 191 of 372 held-out tracks, up from 66. Its top-ten ranking scored lower.
- Across three seeds, mean nDCG@10 was 0.115 for current Quick Picks, 0.116 for the catalog feature ranker, 0.097 for metadata-only LightFM, 0.106 with BPM, 0.099 with combined audio and 0.117 for the blend. The primary seed's paired interval for the blend's gain was −0.017 to +0.022.

## 6. Where everything lives

The paths below are relative to `C:/dev/allegra-lightfm` unless absolute. Generated files are local and ignored by Git. Keep this worktree to retain the captured evidence.

| Artifact | Purpose and how to use it |
| --- | --- |
| [PLAN.md](PLAN.md) | Architecture, development preview, live reranking, training, pilot and rollback plan. |
| [Benchmark README](../../tools/recommendations/README.md) | Full collection, enrichment, training and verification commands. |
| `tools/recommendations/collect.ts`, `baseline.ts`, `expand-catalog.ts` | Collect playlist recordings, capture current Quick Picks and freeze the evaluation split, then add distinct playlists and retrieve audio sources for real candidates. |
| `tools/recommendations/reccobeats.ts`, `reccobeats.test.ts`, `tempo.py` | API feature lookup and matching, and local excerpt analysis. |
| `tools/recommendations/item_features.py`, `benchmark.py`, `verify-export.ts` | Fit item features, train and score models, and verify exported factors. |
| `output/recommendations/catalog.json`, `baseline.json`, `benchmark.json` | Original snapshot, frozen baseline cases and first report. Each filename in this row is under `output/recommendations/`. |
| `output/recommendations/enriched/catalog.json`, `baseline.json` | Expanded catalog and preserved cases. The baseline includes observed and hidden recording keys, old ranks and candidate metadata. Both live under `output/recommendations/enriched/`. |
| `output/recommendations/enriched/tempo.json`, `reccobeats.json`, `audio-sources.json` | Audio feature values and provenance, API matches and temporary source pointers. Audio excerpts were processed in memory. |
| `output/recommendations/enriched/benchmark.json` | Primary report with metrics, paired intervals, per-language results, coverage, actual pick examples and snapshot digest. |
| `output/recommendations/enriched/benchmark-seed-2027.json`, `benchmark-seed-2028.json` | Repeat runs under the same directory. |
| `output/recommendations/enriched/playlist-model.json` | Seed 2026 model with schema version 1, 32-factor playlist and recording vectors, biases and parity examples. About 3.5 MB. |
| `output/recommendations/enriched/repo-tests.log` | Saved output from the repository test run after enrichment. |

There is no recommendation PR, preview deployment or hosted model from this work. The artifact stores playlist profiles and canonical recording identities. A pilot export will need authenticated account profiles and a verified mapping from provider-qualified `SongRef` to the artifact's recording key.

## 7. How to verify and regenerate the artifacts

Start with the existing files. On this machine the tested Linux environment is in WSL Ubuntu at `/home/pratscodes8/.local/share/allegra-lightfm/mamba/envs/benchmark/bin/python`. The current directory must be the benchmark worktree.

```powershell
git status --short --branch
git log -3 --oneline
node --import tsx --test tools/recommendations/reccobeats.test.ts
node --import tsx tools/recommendations/verify-export.ts output/recommendations/enriched/playlist-model.json
wsl.exe -d Ubuntu --exec env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 /home/pratscodes8/.local/share/allegra-lightfm/mamba/envs/benchmark/bin/python -B tools/recommendations/benchmark.py --output output/recommendations/enriched
```

The final command rewrites the primary report and model from cached inputs. Run with `--seed 2027 --report-only` or `--seed 2028 --report-only` for additional reports. For rebuilding on another machine, follow the Linux environment and collection commands in the benchmark README. Use a separate output directory for a new provider snapshot. Rerunning a live collection can change playlist contents, track availability and provider candidates.

Native Windows source installation failed during LightFM setup. A prebuilt Windows package imported and then hit an access violation during WARP training. The Linux conda-forge build completed real training and matched 16 sampled TypeScript scores. ReccoBeats returned HTTP 429 after 46 initial searches. The lookup now checkpoints, waits at least 1.55 seconds between requests and resumes existing matches. The resumed run completed the 180-search sample. Use the documented lookup and batch endpoints. [ReccoBeats track search](https://reccobeats.com/docs/apis/search-tracks) · [Batch features](https://reccobeats.com/docs/apis/get-audio-features) · [Rate limits](https://reccobeats.com/docs/documentation/rate-limiting)

## 8. Verified code seams

Paths and line numbers below were checked on `26a63ecb`. Recheck after any rebase.

| Path | What exists |
| --- | --- |
| `apps/api/src/services/recommendationContext.ts:24` | `buildRecommendationInput` builds seeds, language preferences and exclusions from current track, recent history and likes. |
| `apps/api/src/services/recommendations.ts:72` | `RecommendationService.recommend` reads the `catalog-v1` pool and applies per-request exclusions and diversity. The pool is built with a bound of `limit * 3` at line 96. |
| `apps/api/src/routes/discovery.ts:55` and `:68` | The HTTP handler calls the shared service. Both recommendation paths are registered. |
| `apps/api/src/mcp/tools.ts:146` | `get_recommendations` calls the same service. |
| `apps/web/src/App.tsx:888` and `apps/web/src/hooks/useAccount.ts:159` | Web's fetch depends on a taste fingerprint. Successful listen writes trigger an account refresh. |
| `apps/mobile/src/screens/StreamScreen.tsx:258` and `apps/mobile/src/services/sync/LibrarySync.ts:210` | Android refreshes account picks on focus, pull to refresh and acknowledged play reporting. |
| `packages/shared/listenSignal.ts:60`, `:88` and `apps/api/src/user/actions.ts:350` | Shared listen classification and radio weights exist. The API handles a reported listen, but the recommendation-specific recent feedback window is pending. |
| `convex/taste.ts:147` and `convex/account.ts:290` | Existing tally recording and account erasure entry points to inspect before designing pilot storage. |
| `tools/recommendations/benchmark.py:22`, `:160` and `tools/recommendations/verify-export.ts:19` | WARP training, factor export and TypeScript verification. The scorer uses both biases in its parity check. |

Typecheck, lint, the root suite and the three recording-match tests passed after enrichment. The final model trained on Linux across seeds 2026, 2027 and 2028. Development route integration, browser comparison, Android behavior, Convex writes and Vercel serving have yet to be tested for LightFM.

## 9. Known problems and findings

- The playlist benchmark measures playlist continuation. Its profiles and holdouts give no direct evidence of actual listeners finishing or saving the recommended songs.
- The later run preserved the 48 cases and enriched the catalog. Compare model variants within each run. The earlier and later feature scores used different metadata coverage and weighting.
- More candidate coverage helped retrieval, while expanded ranking scored worse in the top ten. Start the preview with the current candidate pool and treat wider retrieval as a separate experiment.
- BPM helped the standalone LightFM variants across all three seeds. Combined audio fell below BPM alone. Of 54 recordings with BPM from both sources, 38 agreed within 7%, rising to 44 after accounting for half and double tempo. Keep source provenance visible in evaluation.
- Convex history and aggregate tallies are bounded. Check whether events can be reconstructed as of a training cutoff. When they cannot, freeze a model and measure later outcomes prospectively.
- No opt-in export, listener factors, model registry, recommendation feedback storage, mode switches or daily job has been built. The JSON model alone cannot serve account recommendations.

## 10. Remaining work in priority order

1. **Local side-by-side web preview.** Show the current Quick Picks and a clearly labelled LightFM comparison for the same catalog candidates and language selection. Use a fixture or an explicitly selected public playlist profile. The preview must return playable catalog rows and handle missing factors.
2. **Live feedback in development.** Hold the model version and candidate pool fixed. A confirmed like, save or finish changes a later shelf where a similar candidate exists. Verify replay, expiry, early skips, pauses, device handoffs and account switches. Keep live reranking independently controllable.
3. **Eligible-account training and evaluation.** Establish consent, the profile mapping, the export cutoff and feature availability. Train one model with per-account factors and compare its rankings against the current shelf and catalog feature ranker using later outcomes.
4. **Serving and rollback.** Stage a validated model version, run shadow comparison and exercise rollback. Confirm withdrawal and erasure handling before eligible accounts enter the pilot.
5. **Hosting decision.** Review pilot outcomes and then decide on daily scheduling, Convex storage and rollout. The intended architecture uses a Linux training job and the existing TypeScript API for scores.

## 11. Plan for the next agent

1. **Preview slice.** Confirm the worktree and use the saved artifacts. Implement a small injected scorer in the existing API, with a deterministic fixture and a preview-only way to select a playlist profile. Preserve the documented HTTP response for existing consumers. Check invalid schema, nonfinite factors, no vectors, recording duplicates, language and artist limits, and account isolation. Add an API test through `createApp` and run the real development route. Open the web preview at port 5173 and verify both lists and playback. Show the user the comparison before advancing to shared training data.
2. **Feedback slice.** Attach acknowledged listen, like and save events to an account-scoped window. Use play IDs and operation identities, event time and idempotent writes. Start with the proposed 10 events and 30 minutes. Apply reranking after the candidate cache. Add a deterministic clock test and verify stale and duplicate sync events. Wire the preview refresh on web, then verify Android on a test account if that client changes.
3. **Pilot slice.** Use a test or approved opt-in cohort. Add server-side consent and eligibility checks, timestamped exports, feature provenance and a model-version lifecycle. Compare current picks, feature ranker, static LightFM and live LightFM with matched pools. Use later substantial listens and saves. Measure early skips, diversity, empty shelves and latency. Exercise expiry, account withdrawal, erasure and rollback.
4. **Operations slice.** After the user reviews the pilot, prove the Linux job manually before scheduling. Activate only a validated version. Retain the last usable artifact and verify the off and live-reranking switches. Refresh the plan and relevant contract as each behavior becomes available. Apply the repository's mobile version rule if a later approved change reaching `main` rebuilds the APK.

## 12. Open questions and defaults

| Question | Default for the next local slice |
| --- | --- |
| What profile should the web preview show? | A public playlist with documented observed tracks or a deterministic fixture. Label it so the comparison is understood as a demo. |
| Which model variant should be shown first? | Compare current Quick Picks with the enriched blend and surface the fixed candidate pool. Keep BPM-only LightFM and the catalog feature ranker as offline controls. |
| Is the user ready for a real listener pilot? | Prepare the test path locally. Use real account history only with an eligible cohort and participant opt-in. |
| What quality threshold should justify rollout? | Start review with the proposed 5% relative nDCG@10 improvement over the stronger control, a credible lift in later listens or saves and 50 ms added API p95. Confirm the thresholds before evaluating a pilot. |
| Where should the model live? | Use the local fixture for preview. Evaluate a server-only model registry with Convex and a separate Linux job after the pilot design is reviewed. |

## 13. Rules and guardrails

- Follow `AGENTS.md` and `CLAUDE.md`. Work in one vertical slice. Check the current code and use the documented API contract for shape changes.
- Preserve existing bearer auth, language settings, playback and queue behavior. Keep provider secrets and private factors server-side. Vercel request serving is serverless. Use durable state for cross-request correctness.
- Respect the shared package sync workflow. Run `npm.cmd run sync:shared` if editing a copied shared module and verify the generated API copies. Use root typecheck, lint and tests. Check browser-visible behavior in the browser.
- Convex Auth owns `users`. Listener state belongs to `profiles`. Follow the Convex guidelines for mutations, indexes and generated files. Scope any dev deployment to the appropriate test project.
- Keep raw exports, audio source pointers and model artifacts under ignored local output during development. Treat pilot account factors as private. Follow provider pacing and resume from cached results if rate-limited.
- Use local commits and a focused branch when resuming. Keep the unrelated checkout intact. Obtain the user's direction before a recommendations push, PR merge, production rollout, scheduled job or use of production listener data.

## 14. Continuation instruction

Once the user asks to resume, open `C:/dev/allegra-lightfm`, verify `codex/lightfm-benchmark` and run the score check on the saved model. Build the smallest local side-by-side Quick Picks preview through the existing API and stop at a browser-verified comparison the user can review.
