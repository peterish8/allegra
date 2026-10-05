# 06-02 Summary: member taste distribution

## Changes

- `packages/shared/blendTaste.ts`: `LAYER_BETA`, `ARTIST_CREDIT`, `memberTaste`. Per layer, weights
  (default 1) become shares; empty layers drop out; βnow = 0.6 × min(1, nowCount/50) (Now ignored
  when `learning` is false); β renormalised over present layers; `p` summed across layers; lead
  artist from the first layer naming the song; `q` gives the lead 2/3 and splits 1/3 across the other
  credited artists (a solo artist gets 1); languages = Σ q over artists with a known language;
  `nEff = 1/Σp²`. A song with no credited artist would leave `q` short of 1, so `q` is renormalised.
- `packages/shared/blendTaste.test.ts`: 9 tests (sums to 1, 900 vs 60 likes equal Loved share, βnow
  ramp, learning off, 2/3 + 1/6 + 1/6 split, nEff, empty input, two-layer sum, language weighting).
- In `SHARED_COPIES`; API copy generated.

## Verification

- `npm test --workspace packages/shared` — passed. Full gate — exit 0.
