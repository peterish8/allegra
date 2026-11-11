# Quick Picks benchmark on JioSaavn playlists

This benchmark fits a shared LightFM WARP model on real playlist membership and compares it with the current Quick Picks service. Each training profile represents a public playlist. Listener personalization and live reranking are measured in a later pilot with eligible accounts.

From the repository root, install Node workspace dependencies. Create a Linux environment with the conda-forge LightFM build. Use a system FFmpeg with HTTPS support and Librosa for the optional tempo step.

```bash
npm ci
micromamba create -n allegra-recs -c conda-forge python=3.11 lightfm=1.17 numpy=1.26 scipy=1.13 scikit-learn=1.5.2 librosa=0.11 ffmpeg=7
node --import tsx tools/recommendations/collect.ts
node --import tsx tools/recommendations/baseline.ts --provider https://jiosaavn-api-byprats.vercel.app/api
micromamba run -n allegra-recs python tools/recommendations/tempo.py --limit 600
micromamba run -n allegra-recs python tools/recommendations/benchmark.py
node --import tsx tools/recommendations/verify-export.ts
```

The collector searches 50 language and genre combinations and keeps up to two playlists per query by default. It uses Allegra's recording identity to group alternate releases and removes near-duplicate playlists. Titles, artist credits, languages, duration, year and popularity come from the provider. Genre is inferred from explicit playlist labels. BPM is estimated from 30 seconds of a track when the two halves agree. Uncertain or unavailable tempo stays unknown. The tempo step processes audio in memory and writes estimates and status only.

The baseline runs Allegra's existing `RecommendationService` with the local development JioSaavn provider and captures both the returned picks and the underlying ranked candidate pool. The benchmark masks one quarter of same-language playlist tracks in a fixed split. It uses visible playlist memberships for training and derives item genre features from those memberships. Every shared-pool variant sees the same pool, with the language filter, exclusions and artist cap applied. The expanded-catalog experiment changes retrieval as well as rank, so read it separately. The BPM ablation compares two LightFM runs with identical settings and training rows.

`output/recommendations/benchmark.json` reports ranking metrics at 4 and 10, recall, candidate coverage, diversity, upstream errors, per-language results and paired bootstrap intervals. It also includes examples from the real rankings. The model vectors, candidate snapshots and source pointers stay under ignored `output/`. The Python benchmark and the TypeScript export check verify the composed factors and biases against LightFM `predict()`.

## Run on 2026-11-11

The catalog held 2,174 distinct recordings from 74 public playlists, with 9 usable genre labels. Training used 1,873 playlist memberships across 1,823 recordings. The 48 test playlists covered Bengali, Hindi, Kannada, Malayalam, Marathi, Punjabi, Tamil and Telugu. We measured 600 audio excerpts and kept 419 BPM estimates. The baseline returned all 48 shelves with 8 failures across 451 JioSaavn requests.

| Ranking | nDCG@4 | nDCG@10 | Recall@10 |
| --- | ---: | ---: | ---: |
| Current Quick Picks | 0.145 | 0.115 | 9.9% |
| Track feature ranker, same pool | **0.290** | **0.198** | **14.9%** |
| LightFM without BPM, same pool | 0.191 | 0.147 | 11.6% |
| LightFM with BPM, same pool | 0.159 | 0.125 | 10.4% |
| Current + LightFM with BPM, same pool | 0.156 | 0.122 | 10.1% |
| LightFM with BPM, expanded catalog | 0.160 | 0.140 | 13.1% |

The track feature ranker improved nDCG@10 by 0.084 over current Quick Picks, with a paired 95% bootstrap interval of +0.039 to +0.133. LightFM without BPM improved it by 0.033 on this sample, with an interval of −0.021 to +0.088. BPM was available for 34 of 1,539 candidate appearances. Only 66 of 372 held-out playlist memberships appeared in the current candidate pools, and only 20 were represented elsewhere in the training data. The Linux model trained successfully and all 16 sampled scores matched in TypeScript. These numbers describe the first run before candidate enrichment.

## Expand the catalog and enrich the candidates

Run these commands after the original `collect.ts` and `baseline.ts` steps. The expanded run reuses the captured baseline results and the 48 held-out cases. It adds distinct playlists and uses JioSaavn's batch song lookup to obtain audio sources for the current recommendation candidates. All generated files live in the separate `output/recommendations/enriched` directory.

```bash
node --import tsx tools/recommendations/collect.ts --playlists-per-query 4 --output output/recommendations/enriched-catalog
node --import tsx tools/recommendations/expand-catalog.ts
node --import tsx tools/recommendations/reccobeats.ts --limit 180
micromamba run -n allegra-recs python -B tools/recommendations/tempo.py --output output/recommendations/enriched --limit 3200
micromamba run -n allegra-recs python -B tools/recommendations/benchmark.py --output output/recommendations/enriched
node --import tsx tools/recommendations/verify-export.ts output/recommendations/enriched/playlist-model.json
```

- **ReccoBeats** provides BPM, key, mode, loudness, energy, acousticness, danceability, valence, instrumentalness, liveness and speechiness. Match on normalized title, lead artist and close duration. Group releases by ISRC where available and leave ambiguous matches empty. Lookups are paced and resumable. A 429 checkpoints the run. ReccoBeats analytical metrics are stored with source provenance, while JioSaavn supplies the catalog metadata. [Track search](https://reccobeats.com/docs/apis/search-tracks) · [Batch audio features](https://reccobeats.com/docs/apis/get-audio-features) · [Terms of service](https://reccobeats.com/docs/documentation/terms-of-service)
- **Local audio analysis** covers a larger sample and prioritizes actual Quick Picks candidates. It estimates BPM and key where the excerpt supports them and measures signal level, dynamic range, spectral centroid, spectral flatness and onset density. It stores the features and source labels. Audio is processed in memory.
- **Training** compares catalog metadata, BPM, local audio descriptors, and local plus ReccoBeats features on identical memberships. Continuous audio features are binned using training recordings. Feature weights preserve the influence of artist and track identity as audio descriptors are added. The expanded retrieval test adds up to 80 same-language candidates using feature similarity to the observed tracks. It reports the number of held-out tracks the expanded pool could reach before ranking.

### Enriched run on 2026-11-11

The expanded catalog contains 4,461 distinct recordings. The model trained on 3,208 memberships across 122 playlists and 2,968 recordings. JioSaavn supplied audio sources for 1,414 of the 1,415 unique tracks in the current Quick Picks pools. Local analysis produced descriptors for 3,199 of 3,200 excerpts. ReccoBeats returned audio features for 85 of 180 searched recordings, including 41 unique Quick Picks candidates. The combined sources supplied BPM for 2,363 recordings and 1,109 of 1,539 current candidate appearances. Local analysis supplied other audio descriptors for 1,537 candidate appearances.

| Ranking | Mean nDCG@10 across three seeds |
| --- | ---: |
| Current Quick Picks | 0.115 |
| Catalog feature ranker, same pool | 0.116 |
| LightFM with catalog metadata, same pool | 0.097 |
| LightFM with BPM, same pool | 0.106 |
| LightFM with local audio, same pool | 0.094 |
| LightFM with local audio and ReccoBeats, same pool | 0.099 |
| Current Quick Picks blended with enriched LightFM | 0.117 |
| Enriched LightFM, expanded candidate pool | 0.068 |

BPM improved the standalone LightFM score in all three seeds. The blend's primary-seed improvement over current Quick Picks was 0.003 nDCG@10, with a paired 95% bootstrap interval of −0.017 to +0.022. The wider candidate pool could reach 191 of 372 hidden playlist tracks, up from 66. Its top-ten ranking scored lower. Of 54 recordings with BPM from both sources, 38 agreed within 7%, rising to 44 after accounting for half and double tempo. These are offline playlist results. The account pilot remains the test for listener personalization and live reranking.

Use `--seed 2027 --report-only` and `--seed 2028 --report-only` on `benchmark.py` to reproduce the two additional reports. The default run exports the seed 2026 model. All 16 sampled TypeScript scores matched Python.

## Local side-by-side preview

The development API can show today's Quick Picks next to the LightFM blend for any of the 48 benchmark playlists. Write the preview profiles from the saved catalog and baseline, then start the API with the output directory. The page lives at `/dev/quick-picks` in development builds of the web app.

```bash
node --import tsx tools/recommendations/preview-profiles.ts
RECOMMENDATIONS_PREVIEW_DIR=output/recommendations/enriched npm run dev
# open http://localhost:5173/dev/quick-picks?profile=1566837
```

Each profile reuses the baseline's seeds and exclusions, so the current ranker gets the same input it had in the benchmark, and the API asks the live JioSaavn provider for candidates. The LightFM column blends today's order and the playlist's LightFM scores by reciprocal rank (k = 10), as `blend_same_pool` does. A candidate without a vector gets no LightFM credit. If the model file is invalid or the profile has no vector, the LightFM column repeats today's order and the page says why. When another checkout already serves port 8080, start this API with `PORT=8090` and the web app with `ALLEGRA_DEV_API_PORT=8090`.

Before changing Quick Picks, test the API scorer with fixture factors and replay acknowledged feedback on a fixed model version. Measure the effect of live reranking in an account-level comparison with static LightFM. Use subsequent substantial listens and saves as outcomes, and watch early skips, empty shelves and latency. The public playlist benchmark supplies an offline comparison and a way to detect candidate retrieval bottlenecks.
