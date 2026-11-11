# LightFM for Allegra Quick Picks

**Status:** Proposed for review, including live reranking · **Date:** 2026-11-11

## What you’ll get

Quick Picks will combine **your usual taste** with **what you’re enjoying right now**. One shared LightFM model learns from eligible listeners and gives each fitted account its own taste vector. Allegra’s API uses that vector to rank tracks, then adjusts the order with recent likes, saves, finished plays and early skips. For example, someone who usually listens to mellow Tamil indie can finish two faster tracks and see more upbeat Tamil suggestions on the next refresh. Their selected languages still control what can appear.

1. **Train and benchmark on real JioSaavn tracks.** Use original song titles, artist credits, language, release year and duration from the provider. Use public playlist membership as the first training signal and hold back some tracks to compare against today’s Quick Picks. Estimate BPM from short excerpts where the signal is reliable. Keep a tiny synthetic fixture for deterministic smoke tests.
2. **Make the next refresh react to listening.** Reuse the feedback web and Android already send. Verify that the same account and model version can return a different order after a fresh like, finish or pattern of early skips.
3. **Add track features and compare rankings.** Start with artist, language and available genre tags. Add reliable BPM for tracks we can match or are permitted to analyze. Measure the feature ranker, LightFM alone and LightFM with live reranking against today’s Quick Picks.
4. **Try it with a small pilot.** Use the same API for web and Android. Train once daily on a separate Linux job and use recent feedback on each eligible recommendation request. Start with accounts that agree to take part and expand if the results support it.

## What Allegra already has

| Signal | How we’ll use it |
| --- | --- |
| Artist, language, track duration and popularity | Use existing catalog fields. Keep the explicit language setting as a filter. Use popularity sparingly so new artists can appear. |
| Genre picks | Read the listener’s existing genre selections for the feature ranker. Map reliable track genre tags to Allegra’s shared genre IDs. Leave unmapped tags unknown. |
| Likes, playlist saves and listening time | Use saves and substantial listens as stronger training signals than pressing play. Give a fresh like, save or finished play a short-lived boost for similar tracks. Cap repeats in both stages. |
| Skips and playback endings | Use the shared listen verdict and existing playback metadata. Remove recent recordings through the normal exclusion rules. Use a pattern of reliable early skips to gently lower similar tracks for the current session. |
| BPM | Add optional BPM bands to LightFM and use tempo proximity in the feature ranker. A track can still rank when its BPM is unknown. |

The API already shares recommendation input between `GET /api/recommendations`, its compatibility alias, and MCP `get_recommendations`. Android Stream refreshes account picks on focus and after a successful listen sync. Web fetches when its taste fingerprint changes. The API learns from a listen’s outcome and marks the matching history row as processed. Quick Picks needs a short, account-scoped view of those outcomes for live ranking. Android Listening Stats keeps its limited BPM cache on the phone. Shared track features will come from the pilot’s catalog enrichment. [Recommendation context](../../apps/api/src/services/recommendationContext.ts) · [API route](../../apps/api/src/routes/discovery.ts) · [Android Stream](../../apps/mobile/src/screens/StreamScreen.tsx) · [Android listen sync](../../apps/mobile/src/services/sync/LibrarySync.ts) · [Web recommendation fetch](../../apps/web/src/App.tsx) · [Listening signals](../../apps/api/src/user/actions.ts) · [Android tempo](../../apps/mobile/src/services/stats/tempo.ts)

## Implementation

### 1. Train a small model and connect it to the API

- Add a small Python trainer under `tools/recommendations/` with pinned dependencies, a repeatable command, and a synthetic fixture. Use a Linux training runner with the prebuilt LightFM 1.17 package for Python 3.11 from conda-forge. Lock the environment after its synthetic training and score export pass. [LightFM package](https://anaconda.org/conda-forge/lightfm)
- Fit **LightFM with WARP** using a sparse listener–track matrix. Start with 32 factors and a fixed seed for reproducible comparisons. Supply track identity plus shared features such as `genre:indie`, `lang:tamil`, and `bpm:100-119`. Feed WARP positive weights. Apply skip penalties in the serving ranker.
- Export one versioned manifest, item vectors and item biases, and a listener vector for each fitted account. Use LightFM’s feature-composed representations. For a fixed listener the score is the dot product plus item bias. Verify the full score, including listener bias, against Python `predict()` in a TypeScript parity test.
- Add a bounded, injectable TypeScript scorer to the existing API service. Load a fixture artifact in development and run it through the real recommendation route. The hosted API scores vectors in TypeScript. The separate trainer runs in batches.
- Use three modes. **Off** serves the current ranker. **Shadow** computes the candidate ranking for comparison and serves the current result. **Serve** enables the new ranker for eligible pilot accounts.

**Real-catalog benchmark:** Capture a dated JioSaavn snapshot across languages and genres. Deduplicate alternate releases with Allegra’s recording identity. Use playlist membership as a proxy for related songs, with one training row per playlist–recording pair. Hold out a fixed quarter of the eligible recordings in test playlists, and derive genre features only from training memberships. Run the unmodified Quick Picks ranker against real provider candidates. Compare current Quick Picks, a feature ranker, LightFM with and without BPM, and a blend on the same candidate pool. Evaluate catalog expansion separately so changes to retrieval and ranking can be measured independently. Report nDCG@4 and nDCG@10, recall, artist diversity, candidate coverage, tempo coverage, upstream errors and paired uncertainty. This measures playlist continuation. Actual listener personalization and live feedback still require the eligible-account pilot.

**First run:** 2,174 recordings, 74 public playlists, 48 held-out playlist cases, and 419 BPM estimates from 600 audio excerpts. Current Quick Picks scored 0.115 nDCG@10. LightFM reached 0.147 without BPM and 0.125 with BPM. The feature ranker led at 0.198. The paired interval for the LightFM improvement included zero. Keep the feature ranker as the stronger baseline. Test tempo after improving coverage of recommendation candidates, and test LightFM and live reranking with later listening outcomes from eligible accounts.

**Local compatibility check:** The Windows source build failed in package setup. The prebuilt Windows extension imported, then hit an access violation inside the WARP training loop. The Linux conda-forge build trained on the real playlist snapshot, and 16 exported scores matched in TypeScript. The development API integration is still pending.

**Review checkpoint:** A repeatable command trains the fixture, Python and TypeScript agree on the scores, and the development route returns playable recommendations. [LightFM fitting and representation APIs](https://making.lyst.com/lightfm/docs/lightfm.html)

### 2. Rerank Quick Picks with live feedback

1. **Capture recent feedback through existing writes.** Reuse `/api/me/taste/signal` and the like and playlist writes. Use the same `listenVerdict` as live radio. Keep a bounded account-scoped window in Convex for eligible pilot listeners. Start with at most 10 usable events from the last 30 minutes, with influence fading to zero over that window. Deduplicate retries by account and play or operation identity, and use validated event time so an old Android outbox replay cannot become a fresh event. Withdraw the boost when the corresponding like or save is undone. Keep the feedback outside the training export. Existing history and tally data still supply batch training.
2. **Adjust the ranking after the candidate cache.** Retrieve the normal candidate pool, score it with features and LightFM, then adjust it with this listener’s recent feedback. Start with the relative weights from live radio for likes, finishes and early skips. Use artist and available genre and tempo similarity. Use now playing as a weak hint when supplied. Cap the adjustment and apply a penalty for similar tracks only after at least two distinct, reliable early skips of similar tracks. Treat a partial listen without a clear verdict, pauses, buffering, device handoffs and ambiguous transitions as neutral. Exclude the current recording and recent repeats. Apply the explicit language filter, availability checks, recording deduplication and artist limits to the result. Missing BPM leaves the other evidence usable.
3. **Refresh the visible shelf after the write succeeds.** Reuse Android’s successful listen-sync notification and web’s successful listen write. Wire successful likes, saves and preference changes into the same refresh path. Coalesce bursts, refresh on focus or explicit refresh, and drop responses from stale requests or a prior account. Other devices use the latest synced feedback on their next request. Offline changes take effect when they sync within the feedback window. The player and its current queue keep their own playback and radio behavior.
4. **Keep the serving path bounded.** Cache catalog candidates and versioned model data. Read recent feedback and the authenticated listener’s vector for each eligible request, and keep the personalized response private. If the feedback window is empty or unavailable, use the static ranking. Give live reranking its own switch so the pilot can fall back to static LightFM independently. During development, exercise this step using the fixture model and fixed clock.

**Review checkpoint:** With a fixed model version and warm candidate cache, a confirmed like or finish moves a matching song up on the next web or Android Quick Picks refresh. A pattern of deliberate skips can shift the ranking. Replayed events, paused playback, account changes and expired feedback produce the expected result. [Shared listen rules](../../packages/shared/listenSignal.ts) · [Existing radio feedback](../../packages/shared/radio.ts) · [Web listen acknowledgement](../../apps/web/src/hooks/useAccount.ts) · [Cached recommendation pool](../../apps/api/src/services/recommendations.ts)

### 3. Make the track and listening inputs reliable

- Use Allegra’s provider-qualified `SongRef` as the lookup key. Join external data only when we can match the recording confidently, such as an independently verified recording ID or a strong artist/title/duration match. Keep remixes and live versions distinct. Record each feature’s source and confidence.
- Measure BPM from a stratified sample of short JioSaavn audio excerpts in the offline benchmark. Require the estimates from two sections of the excerpt to agree and keep uncertain tracks unknown. The observed JioSaavn track payload provides no BPM or per-track genre. Infer genre from explicit playlist titles or descriptions and record it as playlist-derived. AcousticBrainz can supplement future enrichment when recording matches are reliable. Report coverage by language.
- Start pilot training with the existing bounded per-track tally and account data from eligible participants. Convert the tally to capped positive weights and avoid counting likes or saves twice where the tally already includes them. Check identity and deduplication before trusting synced Android signals, including account switches. Record interaction count, distinct listeners, track overlap and feature coverage before choosing a training cohort.
- Keep an as-of time with every training export. Allegra’s recent-play list and tally are bounded and the tally is aggregated. If we can’t reconstruct a reliable historical cutoff, freeze the first model and evaluate it on later outcomes. A backtest must use features and interactions available at its cutoff.

**Review checkpoint:** We can inspect a small set of source matches, see which inputs are missing, and measure how many listeners and tracks can contribute to a meaningful comparison. [Shared song references](../../packages/shared/songRef.ts) · [Shared genres](../../packages/shared/genres.ts) · [Convex taste tally](../../convex/taste.ts) · [AcousticBrainz feature downloads](https://acousticbrainz.org/download)

### 4. Serve the model on Quick Picks

- Retrieve the same provider, artist and language candidates as today. Apply recording deduplication, playable-track checks, the explicit language filter and artist diversity to the final list. Keep the current HTTP response shape and the existing mobile and web rendering. Keep MCP on the shared recommendation path.
- Compare a **genre-and-tempo feature ranker** against a **LightFM ranker** that adds learned relevance to those same signals. Use rank positions for blending so the model and the rules can contribute without assuming that their raw scores use the same scale. Treat missing factors as missing and rank those tracks with the feature score.
- Start with one daily Linux training job. Prove the build and export with a manual GitHub Actions run on synthetic data before wiring a pilot schedule. Use access-controlled pilot training input and output. Store bounded, server-only model records in Convex keyed by version and song ref or account. Load the active version and needed vectors with bounded reads. Validate every staged version before atomically switching the active version. If training or validation fails, keep the last usable model active.
- Use today’s ranking for guests and anyone outside the pilot. Use the feature ranker for an eligible participant with too little history to have a trained vector. If the model is missing, stale or unavailable, return the current Quick Picks result.
- Once the reranker is proven, test a second candidate source from LightFM’s offline top tracks. This is how the shelf can surface songs the current providers didn’t suggest. Reapply the same availability, language and deduplication checks. Evaluate this separately so we can tell whether retrieval or ranking produced the improvement.

**Review checkpoint:** Signed-in web and Android receive the new ranking through the normal endpoint, and the fallback works even when the model lookup fails. [Current candidate ranking](../../apps/api/src/services/recommendations.ts) · [Web API client](../../apps/web/src/lib/api.ts) · [Mobile API client](../../apps/mobile/src/services/account/allegraApi.ts)

### 5. Run a pilot and decide whether to expand

- Begin with a small set of signed-in participants who agree to pooled model training and have learning enabled. Use only the catalog and listening fields required by training. Keep raw exports and model vectors in access-controlled storage with an expiry. Keep the separate, on-device Listening Stats log on the phone.
- Connect pilot withdrawal and account erasure to model lifecycle. Stop serving the account’s learned and live ranking immediately. Clear its recent feedback and remove its private vectors and training rows. Because shared item vectors can retain a participant’s contribution, invalidate the affected pilot version on withdrawal or erasure and rebuild from eligible histories. Recheck eligibility before activating a staged version. Fall back to current Quick Picks while rebuilding.
- Compare today’s Quick Picks, the feature ranker, static LightFM and LightFM with live reranking on later substantial listens and saves. Compare static and live modes with the same model version and candidate inputs. Replay events in order and use only feedback available at each recommendation time. Use `nDCG@10` to check ranking quality and report new-listener and language cohorts separately. In the pilot, assign variants consistently per account. Measure shelf-attributed saves and substantial listens, early skips, diversity, empty shelves, API latency and time from acknowledged feedback to shelf refresh. Count the tracks actually displayed when attributing outcomes to the shelf.
- Agree on launch thresholds before evaluating. My proposed targets are a **5% relative improvement in nDCG@10 over the stronger baseline**, a credible lift in substantial listens or saves in the pilot, and no material increase in skips or empty shelves. Enable live reranking by default only if it improves on static LightFM in the comparison. Use **50 ms of added API p95** as the initial latency budget. Keep the pilot small if the data is too sparse for a decision.
- Disable live reranking independently or switch the whole pilot to **off** to serve today’s ranker. Exercise both switches through the HTTP paths and MCP.

**Review checkpoint:** Show the comparison results, feature coverage, failure rates and rollback test before deciding whether LightFM becomes the default. [Personalization and erasure contract](../../docs/api-contract.md) · [Existing account cleanup](../../convex/account.ts)

## Tests we’ll run

- **Trainer and artifact:** deterministic fixture, invalid input, missing features, version mismatch, finite vectors, and score parity with LightFM.
- **API:** real route and alias with fixture factors, model lookup failure, unknown tracks, no user vector, language filtering, repeat and alternate-release deduplication, artist caps, and no sharing of personalized results across accounts.
- **Live feedback:** committed likes, saves and finishes can change the next request with a warm candidate cache and the same model version. Test capped skip effects, neutral pauses and handoffs, missing BPM, expiry, duplicate and out-of-order delivery, and the independent live switch. Verify one failed feedback write leaves ranking usable.
- **Pilot privacy:** opted-out and deleted accounts are excluded from new snapshots, their vectors and recent feedback are removed, and affected model versions fall back until rebuilt.
- **User flow:** verify signed-in web Quick Picks in the Codex in-app browser and the Android Stream shelf with a test account. Check guest and low-history fallback. Run `npm run typecheck`, `npm run lint` and `npm test` from a clean branch. Run `npm run mobile:check` if the pilot adds mobile changes.

## Decisions for your review

| Decision | Proposed default |
| --- | --- |
| First feature | Improve the existing Quick Picks shelf on web and Android. Use the same ranking for MCP recommendations. |
| Data for the first pilot | Signed-in participants who agree to take part, plus catalog data. Begin with artist, language, genre and reliable BPM. |
| Training cadence | One shared model trained daily on Linux. Switch to a new version after validation. |
| Live feedback window | Up to 10 usable events in 30 minutes initially. Refresh after successful writes and on shelf focus. |
| When it becomes the default | LightFM must beat today’s ranking and the feature ranker. Live reranking must improve on static LightFM. |

**First implementation slice:** On a clean branch from current `origin/main`, run the real JioSaavn benchmark and verify exported LightFM scores. Use a small fixture to check API integration and replay confirmed feedback against a fixed model. Run the eligible-account pilot only after the offline and serving checks support it.
