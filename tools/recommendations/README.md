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

The track feature ranker improved nDCG@10 by 0.084 over current Quick Picks, with a paired 95% bootstrap interval of +0.039 to +0.133. LightFM without BPM improved it by 0.033 on this sample, with an interval of −0.021 to +0.088. The results support using the feature ranker as the next comparison baseline. BPM was available for 34 of 1,539 candidate appearances. Only 66 of 372 held-out playlist memberships appeared in the current candidate pools, and only 20 were represented elsewhere in the training data. The small overlaps limit what this snapshot can tell us about tempo and collaborative learning. The Linux model trained successfully and all 16 sampled scores matched in TypeScript.

Before changing Quick Picks, test the API scorer with fixture factors and replay acknowledged feedback on a fixed model version. Measure the effect of live reranking in an account-level comparison with static LightFM. Use subsequent substantial listens and saves as outcomes, and watch early skips, empty shelves and latency. The public playlist benchmark supplies an offline comparison and a way to detect candidate retrieval bottlenecks.
