# Blend and Import: implementation plan

Status: draft for owner review, 2026-10-04. Nothing is built yet. Do not start phase 1 until the
owner confirms section 2.
Owner decisions are recorded in section 2. Everything technical was decided by the planning agent
on the owner's instruction ("go with best practice"), with the reason next to each decision.

This document is written for a coding agent with no other context. Follow it in order. Every task
names its files, its interface, and the check that proves it is done. When this plan and the code
disagree, stop and report; do not guess.

## 0. Rules for the implementing agent

Read before the first task, in this order:

1. `CLAUDE.md` (root). Hard rules, playback invariants, verification commands.
2. `docs/architecture.md`. The three owners of state and the seams.
3. `convex/_generated/ai/guidelines.md`. Mandatory before any file in `convex/`.
4. `docs/api-contract.md`. Every new endpoint in this plan is written into it **before** the code.
5. `apps/mobile/CLAUDE.md` before phase 8.

Non-negotiable for every task:

- TypeScript strict, no `any`, no `as unknown as` except at a parse boundary with a narrowing check.
- Duration is seconds everywhere. Weights are "minutes-equivalent" numbers (section 4.2), never ms.
- Every API response is `{ success, data, error? }`; `error` is user-facing copy from section 9.
- Every outbound provider call has an `AbortController` timeout and its own `try/catch` returning
  empty (use `fetchWithTimeout` / `fetchBodyWithTimeout` in `apps/api/src/lib/fetchWithTimeout.ts`).
- No `console.log`. API uses the request logger (`request.log`) or `apps/api/src/lib/logger.ts`.
  Log counts and timings only. Never log titles, artists, user ids, invite codes or file contents.
- Pure logic lives in `packages/shared` as pure functions with unit tests. Routes and Convex
  functions only parse, authorize, load, call the pure function, and save.
- Shared files are flat (`packages/shared/blendMatch.ts`, never a subfolder): the shared test
  script globs `*.test.ts` in that folder only, and the API reaches shared code only through
  `npm run sync:shared`, which copies the names listed in `SHARED_COPIES` in
  `scripts/sync-shared.mjs` into `apps/api/src/shared/`. Add every new shared file the API uses
  to that list and run the script; `tests/infra` fails on a stale copy.
- New Convex test files must be added to the `convex:test` script in the root `package.json`.
- Convex: bounded reads (`.take(n)`, never `.collect()` on user data), indexes named
  `by_<field>_and_<field>`, no unbounded arrays in documents, internal functions for anything
  not called by a client, batch-and-reschedule for large deletes.
- Animations: `transform` and `opacity` only, durations and easings from `apps/web/src/motion`,
  `prefers-reduced-motion` collapses to opacity.
- One commit per task, conventional commit subject (`feat(api): ...`), no AI attribution.
- Done means: `npm run typecheck`, `npm run lint`, `npm test` all exit 0, plus the task's own
  "Done when" checks. Paste the command output in the PR.

Do not:

- Call the Spotify Web API, scrape Spotify pages, or embed Spotify players (section 2, D13).
- Upload the import file to the server. It is parsed in the browser (D14).
- Add a cron that walks every listener or every Blend daily (D7).
- Store per-listen rows. The listen list stays at 25 (privacy promise).
- Store Google profile photos or show emails to other members.
- Change the response shape of an existing endpoint.

## 1. What we are building

**Import.** A listener brings their Spotify Liked Songs and playlists into Allegra from the file
Spotify gives them under Account → Privacy → Download your data, or from a CSV any exporter makes.
Songs are matched to the Allegra catalog; matched songs become likes and playlists through the
existing library sync.

**Taste tally.** For each listener who has "Learn from my listening" on, Allegra keeps the 200 songs
they actually play most, weighted by minutes heard, fading over time. This is the "now" layer of
their taste.

**Blend.** Two people (later up to six) share one playlist that mixes their tastes, refreshed daily,
with a taste match percentage, the artist that brings them together, and story cards.

Importing 900 liked songs must not drown out what someone actually plays on Allegra, and must
not let the bigger library dominate a Blend. Section 4.4 is how.

## 2. Decision log

| # | Decision | Why |
|---|---|---|
| D1 | Blend data in Convex, reached through API routes with the existing secret pattern (like `shares`, `library`). One exception: the invite waiting screen may poll `GET /api/blends/:id` every 3 s while open; no direct Convex subscription in v1. | One integration seam, existing rate limits and envelope. Polling a single open screen is cheaper to reason about than a second auth path. |
| D2 | The taste tally fades by time, half-life **45 days**, using forward decay (section 4.1). The existing artist taste (`apps/api/src/user/taste.ts`, decays per signal) is **not** changed. Blend derives its artist vector from the tally, likes and playlists. | Blend should reflect "now". Leaving the existing taste alone keeps Quick Picks unchanged and the blast radius small. |
| D3 | Tally weight is minutes heard, capped at the song's duration per listen. Allegra like = +10, unlike = remove the like bonus, playlist add = +5, skip under 10 s = −1, floor 0. | A listen counts by how much was heard; looping one song cannot dominate; likes matter but less than an hour of listening. |
| D4 | Tally rows are separate documents in `tasteSongs`, at most **200 per listener**, plus one `tasteMeta` row per listener. | Convex guideline: no large arrays rewritten on every write. One small row write per listen. |
| D5 | Song sketches (MinHash) are **not** used. Overlap is computed exactly on the bounded inputs. | With 128 hashes the error is √(J(1−J)/k): about 40% relative at the 5% overlap typical between friends. A number that jumps for no reason is worse than none. |
| D19 | The match measures **mutual enjoyment**: how much of each person's taste the other would enjoy, scored at four levels (same song, same artist, similar artist, same language). Not cosine similarity. | Exact overlap between friends is tiny, so cosine reads as noise. Coverage is interpretable ("you'd enjoy 74% of her music") and the stories come from the same numbers. Tested on simulated listeners (4.6). |
| D20 | Popularity never reduces enjoyment credit; it only adds a bounded "rare bond" bonus and picks the story's artist. | A first version that discounted superstars scored one listener against themselves at 67%. Two big Arijit fans really would enjoy each other's Arijit. |
| D21 | The playlist is chosen by greedy Nash welfare over predicted enjoyment, not fixed turns. | One rule gives "maximise the joy", "equal" and "democratic" at once; in simulation every member's average enjoyment stays level. |
| D6 | Cold start: on first Blend action, seed the tally once from Allegra-native likes (+10), playlist items (+5) and the last 25 listens (+3 each), at their real timestamps. **Imported** likes and playlists are never seeded into the tally. | The tally means "what you play here". Imports are taste you declared, used through the Loved and Kept layers instead (section 4.4). |
| D7 | No daily cron over Blends. A Blend rebuilds when a member opens it and its build is for an earlier UTC day, or when membership changed. The existing daily sweep removes expired invites and Blends with fewer than 2 members. | Dormant Blends cost nothing. |
| D8 | "Day" is the UTC date (`YYYY-MM-DD`). | Members can be in different time zones; one day boundary for everyone. In India it rolls at 05:30. |
| D9 | Invites: one reusable link per Blend, 12-character code, expires 7 days after creation, any member can fetch or regenerate it. | Matches Spotify's flow; one active link is easy to revoke. |
| D10 | Membership: v1 caps a Blend at **2** members (`BLEND_MAX_MEMBERS = 2`); phase 9 raises it to **6**. The data model supports 6 from day one. A person can be in at most **20** Blends. If the creator leaves, the longest-standing member becomes owner. | Owner: Blend is mainly for two, groups up to six. |
| D11 | Members appear as display name plus initials on a coloured disc. No photos. | A photo shown to others is new personal data needing its own disclosure. |
| D12 | "Learn from my listening" off: may join; their part of the Blend uses likes and playlists only; others see "{name}'s picks come from likes and playlists". Turning learning off deletes their tally. | Respects the setting without locking people out. |
| D13 | Import never uses the Spotify Web API. Since 2025-05-15 extended access needs about 250,000 monthly active users; development mode allows 5 users. | Not available to Allegra. |
| D14 | Import reads the "Download your data" files (`YourLibrary.json`, `Playlist*.json`, or the whole ZIP) and generic CSV, **in the browser**. Only title, artist, album and duration go to the server, in batches, for catalog matching. | The file holds far more personal data than needed; it never leaves the device. |
| D15 | Only songs with a Saavn ref enter a Blend. Gaana-only refs are resolved to Saavn when building; unresolved ones are dropped and counted in the build log. | A Blend row that will not play is a broken promise. |
| D16 | Blend score and builder are deterministic pure functions in `packages/shared/blend*.ts `. The daily build is seeded by `blendId + builtFor`, so every member sees the same list. | Testable without a database; reproducible bugs. |
| D17 | Share cards are drawn client-side on a `<canvas>` (1080 × 1920) and shared with the Web Share API, falling back to download. | No server route that needs the viewer's token; no image dependency. |
| D18 | Feature flag: env `BLEND_ENABLED` (API) and `NEXT_PUBLIC_BLEND_ENABLED` (web, boolean only). Import has `IMPORT_ENABLED` / `NEXT_PUBLIC_IMPORT_ENABLED`. Off by default in production until phase 7 passes. | Ship dark, turn on deliberately. |

## 3. Vocabulary

Use these names in code, copy and tests. Do not invent synonyms.

| Term | Meaning | Code name |
|---|---|---|
| Listener | An Allegra account (not a guest). | `userId: string` |
| Identity key | Normalised `title + lead artist`, used to treat a Saavn song, its Gaana twin and an imported Spotify song as the same song. | `identityKey(title, artist)` |
| Tally | A listener's up-to-200 most-played songs with decayed weights. | `tasteSongs` table, `TallyEntry` |
| Now / Loved / Kept | The three taste layers: tally, likes, playlist items. | `layer: 'now' \| 'loved' \| 'kept'` |
| Imported | A like or playlist created by Import. | `origin: 'import'` |
| Blend | The shared playlist and its scores. | `blends` table |
| Member | A listener in a Blend. | `blendMembers` table |
| Invite | The join link for a Blend. | `blendInvites` table |
| Build | One day's generated track list and scores. | `BlendBuild` |
| Match | The 0–99 taste match for a pair. | `PairMatch` |
| Pick | A track in a build, with who it is for. | `BlendTrack.for` |

## 4. The model

### 4.1 Forward decay (the only time maths in this plan)

A weight that halves every `H` days is stored relative to a fixed landmark `L`:

```
L = Date.UTC(2026, 0, 1)            // never change after release
H = 45 * 86_400_000                 // half-life in ms
g(t) = 2 ** ((t - L) / H)

store:  score += amount * g(eventTime)
read:   current(now) = score / g(now)
```

- Rows are comparable by stored `score` without knowing `now`, so "lowest" and "top N" are plain
  index reads (`by_userId_and_score`).
- A write touches one row; nothing else is re-decayed.
- Input timestamps are supported from UTC 1976-01-01 through UTC 2076-01-01, inclusive. This
  100-year horizon keeps `g(t)` finite and nonzero throughout; positive application tally amounts
  also remain representable as current weights across the full range. Outside it, underflow or
  overflow is possible and behavior is unspecified; do not clamp the exponent, because that changes
  the forward-decay maths.
- Negative amounts: `score = max(0, score + amount * g(now))`; a row at 0 is deleted.
- Put this in `packages/shared/blendDecay.ts`:

```ts
export const DECAY_LANDMARK_MS = Date.UTC(2026, 0, 1);
export const DECAY_HALF_LIFE_MS = 45 * 86_400_000;
export function decayFactor(atMs: number): number;              // g(t)
export function addDecayed(score: number, amount: number, atMs: number): number; // never < 0
export function currentWeight(score: number, nowMs: number): number;
```

Tests: weight halves after exactly 45 days; adding at two times equals the sum of currents;
negative never goes below 0; factors and current weights stay finite and positive at both supported
horizon boundaries; stored-score ordering matches current-weight ordering within the horizon.

### 4.2 Amounts (D3)

`packages/shared/blendDecay.ts`:

```ts
export const TALLY_AMOUNT = {
  likeBonus: 10,
  playlistAdd: 5,
  skip: -1,
  seedRecent: 3
} as const;

/** Minutes heard, capped at one play of the song. Null for a skip handled separately. */
export function listenAmount(secondsHeard: number, songSeconds: number): number;
// secondsHeard < 10            → TALLY_AMOUNT.skip
// otherwise                    → min(secondsHeard, songSeconds > 0 ? songSeconds : secondsHeard) / 60
```

### 4.3 The tally (D4)

`tasteSongs` row:

```ts
{
  userId: string,
  identity: string,          // identityKey(title, artist)
  ref: string,               // 'saavn:<id>' or 'gaana:<id>'; the last ref heard for this identity
  title: string, artist: string, artwork: string, duration: number, // SongSnapshot fields
  score: number,             // forward-decayed (4.1)
  likeBonus: boolean,        // true while the +10 like bonus is applied, so unlike can remove it once
  likeBonusAt?: number,      // timestamp of that +10 contribution, so a later unlike removes the same decay-scaled amount
  recentListens: number[],   // last 8 playedAt ms values, for idempotency; never longer than 8
  updatedAt: number
}
indexes: by_userId_and_identity, by_userId_and_score
```

`tasteMeta` row: `{ userId, songCount, seededAt?: number, updatedAt }`, index `by_userId`.

Write rule for a listen signal `(userId, snapshot, secondsHeard, playedAt)`:

1. Personalisation off → do nothing.
2. Find the row by `by_userId_and_identity`.
3. If `playedAt` is in `recentListens` → do nothing (duplicate delivery; mobile outbox retries).
4. `score = addDecayed(score, listenAmount(...), playedAt)`; push `playedAt`, keep the last 8.
5. New row → insert, `songCount + 1`. If `songCount > 200`: read the lowest row
   (`by_userId_and_score`, ascending, `take(1)`), delete it, `songCount - 1`.
6. Row reaching score 0 → delete, `songCount - 1`.

A native like adds `10 * g(at)` and records `likeBonusAt = at`. A later unlike subtracts
`10 * g(likeBonusAt)` from the stored score, then clears `likeBonus` and `likeBonusAt`; using the
unlike timestamp would subtract a different forward-decayed amount and could erase unrelated listens.

All in one Convex mutation, so concurrent signals cannot overshoot the cap.

### 4.4 Taste as a distribution: why 900 imported likes do not take over

For each member, build three layers over identity keys:

| Layer | Source | Read cap | Raw weight per item |
|---|---|---|---|
| Now | tally rows | 200 | `currentWeight(score, now)` |
| Loved | likes, native and imported | newest 1,000 | 1 |
| Kept | playlist items, native and imported | newest 300 | 1 |

Each layer is turned into shares that sum to 1, then the layers are mixed:

```
share(layer)[i] = raw[i] / Σ raw            // a layer with no items is left out

βnow   = 0.6 * min(1, nowCount / 50)        // grows with real listening on Allegra
βloved = 0.3
βkept  = 0.1
renormalise β over the layers that have items, so they sum to 1

p(i) = Σ_layer β_layer * share(layer)[i]    // p sums to 1: "how much of your taste is song i"
q(a) = Σ_i p(i) * credit(i, a)              // artist shares; per song the lead artist gets 2/3
                                            // and featured artists split 1/3 (one artist: 1)
```

What this does with an import of 900 liked songs:

- **Size does not buy influence.** The Loved layer is 30% of a taste whether it holds 60 likes or
  900. Each imported like is 0.3 / 900 of that listener's taste.
- **Day one still works.** A new importer has no tally, so βnow is 0 and their taste is their
  likes (75%) and playlists (25%). That is right: they did listen to all of it, elsewhere.
- **Listening takes over.** After about 50 tallied songs βnow reaches 0.6 and what they play on
  Allegra leads. Imported likes stay as a steady long-term layer and never fade, because the
  Spotify file has no dates to fade them by.
- **Overlap is still found.** A song in my 900 imported likes that you play every day is in both
  tastes.
- **The existing artist taste is protected.** Import does not send 900 like signals. It applies
  one seed of the import's top 25 artists by song count, with weight `SIGNAL_WEIGHT.seed *
  log2(1 + count) / log2(1 + maxCount)` (task I6).

### 4.5 Artist facts the score needs

From the catalog, cached and shared between listeners because they are not personal:

```ts
interface ArtistFacts {
  readonly key: string;                 // lower-cased name, as creditedArtists produces
  readonly popularity: number;          // 0 niche … 1 superstar
  readonly language?: string;           // most common language among the artist's catalog songs
  readonly similar: readonly string[];  // keys from ArtistProfile.similar, at most 10
}
popularity = clamp(log10(1 + followerCount) / 7, 0, 1)   // 10 M followers → 1, 10 k → 0.57
```

Source: `GET /api/artists/:name` (`ArtistProfile`: `followerCount`, `similar`, `songs[].language`),
cache key `artist-facts:<key>`, 30 days. Fetched only for each member's top 30 artists by `q`,
4 at a time, inside a 3 s budget. A missing fact uses `popularity = 0.5`, no language and no
similar artists. The score degrades and never fails.

### 4.6 Taste match (D5, D16, D19 to D21)

The question the number answers: **how much of each other's music would you enjoy?**

**Step 1. Would B enjoy A's song i?** The best of four levels, from exact to loose:

```
enjoyB(i) = max(
  1.00 × [i is in B's taste],                                // same song
  0.85 × affinityB(lead(i)),                                 // same artist
  0.40 × max over a' in similar(lead(i)) of affinityB(a'),   // B likes a similar artist
  0.15 × [language(lead(i)) is at least 10% of B's taste]    // same language
)
affinityB(a) = min(1, qB(a) / 0.02)   // an artist that is 2% of B's taste counts as fully liked
```

**Step 2. Coverage.** The share of A's taste that B would enjoy, and the other way round:

```
coverA = Σ_i pA(i) × enjoyB(i)      // "Priya would enjoy 74% of your music"
coverB = Σ_i pB(i) × enjoyA(i)
M      = sqrt(coverA × coverB)      // geometric mean: a broad listener who covers a narrow one
                                    // does not get a high score from one direction alone
```

**Step 3. The rare-bond bonus.** Sharing a niche artist says more than sharing a superstar.

```
rare = Σ_a min(qA(a), qB(a)) × (1 − popularity(a))
M'   = M + (1 − M) × 0.5 × rare
```

**Step 4. Confidence.** A pair with very little data is pulled toward a neutral value instead
of claiming 95% from three songs.

```
nEff(m)    = 1 / Σ_i p_m(i)²                     // effective number of songs (Kish)
λ          = min over the pair of nEff / (nEff + 8)
M''        = λ × M' + (1 − λ) × 0.2
match      = clamp(round(100 × M''^0.75), 0, 99)
confidence = λ < 0.6 ? 'low' : 'normal'          // 'low' shows "Early days"
```

All constants live in one exported object, so tuning is one edit:

```ts
export const MATCH = {
  level: { song: 1, artist: 0.85, similar: 0.4, language: 0.15 },
  fullAffinityShare: 0.02,
  languageShare: 0.1,
  rareBonus: 0.5,
  shrinkK: 8,
  prior: 0.2,
  gamma: 0.75
} as const;
```

What it gives, from `.planning/blend/match-sim.mjs` (synthetic listeners; run `node match-sim.mjs`):

| Pair | Match | A would enjoy B's | B would enjoy A's |
|---|---|---|---|
| Same listener on two different days | 86 | 90% | 91% |
| Both Arijit-heavy, different second artist | 70 | 73% | 71% |
| 900 imported likes vs a 60-song listener | 66 | 70% | 60% |
| Share a niche indie band, rest differs | 62 | 45% | 52% |
| Broad listener vs one-artist listener inside it | 48 | 93% | 26% |
| Only similar artists (Arijit vs Pritam and Atif) | 44 | 40% | 40% |
| Thin: 3 songs each, same artist | 44, "Early days" | 90% | 95% |
| Only a superstar in common (Arijit) | 37 | 27% | 27% |
| Same language, no shared artist | 26 | 15% | 15% |
| Tamil only vs Punjabi only | 8 | 0% | 0% |

These orderings are the acceptance tests (task M2), not the exact numbers.

**The stories read from the same maths**, so every card can be explained:

- **Both directions:** "You'd enjoy 93% of Rahul's music. He'd enjoy 26% of yours." From
  `coverB` and `coverA`.
- **The song that brings you two together** (two-person Blends only):

  ```
  together(i) = (pA(i) + pB(i)) × min(enjoyA(i), enjoyB(i)) × (1 − 0.3 × songPopularity(i))
  songPopularity(i) = clamp(log10(1 + playCount) / 8, 0, 1)    // 100 M plays → 1
  ```

  over every song in either taste (`enjoy` is 1 for a person's own song). It finds a song both of
  you love, and works even with no exact song in common: a song of yours by an artist they love
  scores through `enjoy`. `playCount` comes from the existing batch song lookup
  (`GET /api/songs?ids=`, cached 6 h), only for the 20 best candidates by the first two factors.
  If the winner's `min(enjoyA, enjoyB)` is below 0.5, the card reads "The closest you get"
  instead; below 0.3 the card is left out. Simulated (`match-sim.mjs`): two Arijit-heavy
  listeners get an Arijit song both play; a pair sharing a niche band gets that band's song rather
  than the shared superstar; Arijit vs Pritam-and-Atif gets "The closest you get"; same language
  with no shared artist, and Tamil vs Punjabi, get no song card.
- **The artist that brings you together:** argmax over a of `min(qA(a), qB(a)) × (1 − 0.4 ×
  popularity(a))`, so a shared niche artist beats a shared superstar for the story.
- **Your gift to them:** A's highest-`pA` song where `enjoyB < 0.5` but its artist is similar to
  one B likes ("Priya hasn't heard this, and she'll probably like it").
- **Why it moved:** per-artist contributions `contribA(a) = Σ over i with lead(i) = a of pA(i) ×
  enjoyB(i)`. The top 10 per pair are stored with each build. When |Δmatch| ≥ 5, the reason names
  the artist whose contribution changed most.

Groups of 3 to 6 (phase 9) use the same pair matches, and the stories change:

- **Group match:** the mean of all pair matches.
- **Most in tune with you:** the other member with your highest pair match, with the percentage.
- **Least in tune with you:** the other member with your lowest pair match, with the percentage.
  Ties go to whoever joined first. Each viewer sees their own pair, so these two cards differ per
  member and are computed in the client from `pairs`.
- **The group's glue:** artists with `affinity ≥ 0.5` for at least half the members.
- **No song card.** A song that "brings six people together" is rarely true, so groups skip it.

`packages/shared/blendMatch.ts` exports:

```ts
export interface MemberTaste {
  readonly userId: string;
  readonly songs: ReadonlyMap<string, number>;      // identity → p(i), sums to 1
  readonly songArtist: ReadonlyMap<string, string>; // identity → lead artist key
  readonly artists: ReadonlyMap<string, number>;    // artist key → q(a), sums to 1
  readonly languages: ReadonlyMap<string, number>;  // language → share
  readonly nEff: number;
}
export interface PairMatch {
  readonly a: string; readonly b: string;           // userIds, a < b
  readonly match: number;                            // 0–99
  readonly cover: { readonly a: number; readonly b: number }; // a's taste B enjoys, and b's A enjoys
  readonly rare: number;
  readonly confidence: 'normal' | 'low';
  readonly together: string;                         // artist key
  readonly contributions: readonly { readonly artist: string; readonly value: number }[]; // top 10
}
export function enjoyment(identity: string, listener: MemberTaste, facts: ArtistFactsMap): number;
export function pairMatch(a: MemberTaste, b: MemberTaste, facts: ArtistFactsMap): PairMatch;
export function explainChange(previous: PairMatch | undefined, next: PairMatch): ChangeReason | null;
```

### 4.7 The daily build: greedy fair welfare

The goal is not equal song counts. It is that **each member enjoys the playlist about as much as
the others, and as much as possible**. Spotify's team calls these "maximise the joy" and "equal".
One rule does both: pick songs greedily to maximise the sum of the logs of each member's total
enjoyment (Nash social welfare). A member who is behind gains most from the next song, so the list
stays fair without fixed turns. A song both people love counts for both, so shared songs rise on
their own.

```
enjoy_m(s) = s is in m's taste ? 0.6 + 0.4 × min(1, p_m(s) / p_m(10th favourite))  // favourites → 1
           : enjoyment(s, m)                                                       // 4.6 step 1

U_m = enjoyment member m has from songs already chosen (starts at 0)

each step, choose the candidate s maximising
  gain(s) = Σ_m log(1 + enjoy_m(s) / (1 + U_m)) × spacing(s) × freshness(s) × (1 + 0.03 × noise(s))

spacing(s)   = 0.3 if the same lead artist is in the last 4 chosen, else 1
freshness(s) = 0.5 if s was in either of the two previous builds and is not in every member's taste
noise(s)     = PRNG(seed, s) in [−1, 1]   // seed = blendId:builtFor, small daily variety
```

Then `U_m += enjoy_m(s)` for every member. Repeat until 50 tracks.

Candidates: each member's top 300 identities by `p`, plus up to 50 discovery songs (catalog
suggestions for the 3 best shared songs). `for` on each track = the members whose taste holds it.
A song nobody holds is `kind: 'discovery'` and shows "New for you both"; held by two or more is
`kind: 'shared'`; held by one is `kind: 'pick'`.

Simulation results (`match-sim.mjs`, 50 tracks):

| Pair | Songs each person brought | Shared | Average enjoyment per member |
|---|---|---|---|
| 900 imported likes vs 60-song listener | 40 / 24 | 14 | 0.73 / 0.71 |
| Tamil only vs Punjabi only | 25 / 25 | 0 | 0.50 / 0.50 |
| Twins | 35 / 34 | 19 | 0.88 / 0.88 |
| Three people, mixed | 28 / 19 / 18 | 10 | 0.54 / 0.56 / 0.54 |

The importer brings more songs because the other person also enjoys them, while enjoyment stays
level. That is the "democratic" property working, not a bias.

Cost: 50 steps × at most 1,850 candidates × 6 members ≈ 555,000 small operations, well under 100 ms.

`packages/shared/blendBuild.ts`:

```ts
export interface BlendTrack {
  readonly song: SongSnapshot;           // resolved to a Saavn ref (D15)
  readonly for: readonly string[];       // userIds; empty only for discovery
  readonly kind: 'shared' | 'pick' | 'discovery';
}
export const BUILD_SIZE = 50;
export function buildBlend(input: {
  readonly members: readonly MemberTaste[];
  readonly songs: ReadonlyMap<string, SongSnapshot>; // every candidate identity
  readonly discovery: readonly string[];             // identities
  readonly facts: ArtistFactsMap;
  readonly previous: ReadonlySet<string>;            // identities in the last two builds
  readonly seed: string;
}): readonly BlendTrack[];
```

Required fixtures (`blendBuild.test.ts`, worlds taken from `match-sim.mjs`): each member's average
enjoyment within 0.05 of the others for the four simulated pairs; same seed gives the same output;
a new day changes at least 10 positions; no identity twice; never more than 50; no lead artist twice
within 4 tracks unless only one artist is left; a thin member's slots fill with discovery; fewer
than 10 candidates returns them and the caller shows "not enough yet".

## 5. Data model (Convex `convex/schema.ts`)

```ts
tasteSongs: defineTable({ /* 4.3 */ })
  .index('by_userId_and_identity', ['userId', 'identity'])
  .index('by_userId_and_score', ['userId', 'score']),

tasteMeta: defineTable({
  userId: v.string(), songCount: v.number(), seededAt: v.optional(v.number()), updatedAt: v.number()
}).index('by_userId', ['userId']),

blends: defineTable({
  name: v.string(),                       // ≤ 60 chars
  ownerId: v.string(),
  memberCount: v.number(),                // denormalised, ≤ BLEND_MAX_MEMBERS
  createdAt: v.number(),
  builtFor: v.optional(v.string()),       // 'YYYY-MM-DD'
  buildVersion: v.number(),               // compare-and-set guard
  stale: v.boolean(),                     // membership changed since the last build
  tracks: v.array(blendTrack),            // ≤ 50
  pairs: v.array(pairMatch),              // ≤ 15 (6 members)
  previousPairs: v.array(pairMatch),      // last build's pairs, for change reasons
  previousTracks: v.array(v.string()),    // identities from the last two builds, ≤ 100
  palette: v.optional(v.object({ a: v.string(), b: v.string() }))
}),

blendMembers: defineTable({
  blendId: v.id('blends'),
  userId: v.string(),
  displayName: v.string(),                // snapshot at join, ≤ 40 chars, updated on rename
  joinedAt: v.number(),
  consent: v.object({ policyVersion: v.string(), at: v.number() }),
  learning: v.boolean()                   // false → likes and playlists only (D12)
})
  .index('by_blendId_and_joinedAt', ['blendId', 'joinedAt'])
  .index('by_userId_and_joinedAt', ['userId', 'joinedAt'])
  .index('by_blendId_and_userId', ['blendId', 'userId']),

blendInvites: defineTable({
  code: v.string(), blendId: v.id('blends'), createdBy: v.string(),
  createdAt: v.number(), expiresAt: v.number()
})
  .index('by_code', ['code'])
  .index('by_blendId', ['blendId'])
  .index('by_expiresAt', ['expiresAt'])
```

Library rows (`libraryLikes`, `libraryPlaylists`) gain `origin: v.optional(v.literal('import'))`.
Absent means native. Additive, so no migration. `packages/shared/library.ts` carries it through
`LibraryOp` (`like` and `playlist_upsert` get optional `origin`). Update `docs/api-contract.md`
"Library sync" first.

Size check: a build document is about 50 × 350 B + 15 × 400 B ≈ 24 KB, written at most once a day.

## 6. Tasks

Each task: goal, files, steps, done when. Tasks inside a phase are in order.

### Phase 0. Make the privacy page true

**R1. Sweep slack.** Files: `packages/shared/legal.ts`, `apps/api/src/auth/auth.ts`,
`convex/account.ts`, `convex/account.test.ts`.
Move `ACTIVE_TOUCH_DAYS = 7` into `legal.ts`; the API's `ACTIVE_TOUCH_MS` reads it. In
`sweepInactive`, the cutoff becomes `now - (days + ACTIVE_TOUCH_DAYS) * DAY_MS`.
Done when: a test shows a profile last touched 89 days ago survives and one touched
`90 + 7 + 1` days ago is erased; the privacy page still renders the same numbers.

**R2. Report minimisation.** Files: `convex/schema.ts` (`closedAt: v.optional(v.number())`),
`convex/reports.ts` (set `closedAt` in `closeFor` and `takeDown`), `convex/account.ts` or a new
`convex/retention.ts` internal mutation called from the existing daily cron:
patch `contact` and `details` to `undefined` on closed reports with `closedAt` older than 365 days,
200 per pass, reschedule while more remain. Add `REPORT_DETAIL_RETENTION_DAYS = 365` to `legal.ts`.
Closed reports that predate `closedAt` must be stamped with the server time in a bounded,
paginated one-off backfill after deployment. This deliberately gives those reports a fresh 365-day
retention period instead of guessing their historical close time. Already-closed reports touched
by `closeFor` are stamped as well. Run `npx convex run retention:backfillClosedReports` once after
the schema/function deploy; the trim cron may run safely before it because unstamped rows are not
eligible for trimming.
Privacy page line: "Reports are kept as a record. The reporter's contact details and message are
deleted one year after the report is closed."
Done when: a test with an old closed report shows the fields gone and code, reason, status and
dates kept; an open report is untouched.

**R3. Tombstone pruning.** Files: `convex/library.ts`, `convex/schema.ts` (indexes
`by_liked_and_likedAt` on likes and `by_deleted_and_updatedAt` on playlists and items, declared
`staged: true` first if the tables are large), the daily sweep.
Delete tombstones older than 90 days, 200 per pass. Record `prunedBefore` (ms) in
`libraryState` per user; `library:changes` with a `since` older than `prunedBefore` answers
`{ resync: true }`, and both clients already handle `since === 0` as a full fetch. Update the
contract and both clients to treat `resync: true` as "fetch from 0".
Done when: tests show an old tombstone gone, a fresh one kept, and a stale cursor told to resync.

**R4. Dead field and doc.** Remove `playStats` from `convex/profiles.ts` and `convex/schema.ts`
(confirm with `graft grep "playStats"` that nothing reads it), and fix the "play tally" paragraph in
`docs/architecture.md` to describe the tally in this plan.

**R5. Production check (owner).** In the Convex dashboard, confirm no `profiles` row lacks
`lastActiveAt`; if any do, run `npx convex run account:backfillLastActive`.

### Phase 1. Shared helpers

**S1. One `identityKey`.** Today there are two `songIdentity` functions
(`apps/api/src/lib/normalize.ts:53`, `apps/web/src/lib/songIdentity.ts:7`) and two
`creditedArtists` (`apps/api/src/user/taste.ts:39`, `apps/web/src/lib/utils.ts:39`).
Create `packages/shared/identity.ts` exporting `identityKey(title, artist)` and
`creditedArtists(artist)`. Make all four call sites import it, keep behaviour identical, and delete
the copies (`graft callers songIdentity --depth all` first).
Done when: existing tests pass unchanged, and a new `identity.test.ts` covers remaster suffixes,
"feat." variants, case and punctuation.

**S2. Decay and amounts.** `packages/shared/blendDecay.ts` (decay and amounts together` per 4.1 and 4.2, with tests.

### Phase 2. Taste tally

**T1. Tables.** Add `tasteSongs` and `tasteMeta` to `convex/schema.ts` (section 5).

**T2. Convex functions** in `convex/taste.ts`, all secret-guarded like `convex/profiles.ts`:
- `record({ secret, userId, song: SongSnapshot, secondsHeard, playedAt })`: the write rule in 4.3.
- `bonus({ secret, userId, song, kind: 'like' | 'unlike' | 'playlistAdd', at })`: like sets
  `likeBonus` and adds 10; unlike subtracts 10 only if `likeBonus`, then clears it.
- `seed({ secret, userId, likes, items, recents })`: the cold start in D6. No-op when `seededAt`
  is set. Inputs are bounded by the caller (≤ 200 + 300 + 25).
- `top({ secret, userId, limit })`: up to 200 rows by `by_userId_and_score` descending.
- `clear({ secret, userId })`: deletes 200 rows per pass and reschedules. Deletes `tasteMeta` last.
Register each name in `CONVEX_QUERIES` / `CONVEX_MUTATIONS` in `apps/api/src/db/convexGateway.ts`
(its test checks the export exists).
Done when: `convex/taste.test.ts` covers duplicate `playedAt` ignored, the 201st song evicts the
lowest, skip to 0 deletes, like then unlike leaves no bonus, seed runs once, and clear empties both tables.

**T3. API port.** `apps/api/src/user/tasteTally.ts`: interface `TasteTally` with
`record`, `bonus`, `seed`, `top`, `clear`; `ConvexTasteTally` (via the gateway) and
`MemoryTasteTally` (tests and local dev without Convex, same rules, reusing the shared decay code).
Wire it in `apps/api/src/services.ts` next to `UserStore`.

**T4. Hook the signals.** In `apps/api/src/user/actions.ts`:
- `listened(...)` calls `tally.record` when personalised and the snapshot has a ref, in its own
  `try/catch` (a failed tally write must not fail the listen signal).
- Native like, unlike and playlist add call `tally.bonus`. Imported ones (`origin: 'import'`) do not.
- `PATCH /api/me/settings` with `personalization: false` calls `tally.clear`.
- `account:eraseSome` in `convex/account.ts` deletes `tasteSongs` and `tasteMeta` (batched like
  the other tables), and the data export (`account:extras`) includes the tally's titles, artists
  and current weights rounded to whole minutes.
- Web `sendListenSignal` (`apps/web/src/lib/api.ts:551`) sends `playedAt`, as mobile already
  does; the contract marks `playedAt` as recommended.
Done when: API tests cover a listen raising the weight, a duplicate delivery not double counting,
learning off clearing the tally, and erase removing it.

**T5. Privacy page.** `LegalPage.tsx` "What we keep": add "the up to 200 songs you play most on
Allegra, with how much you play them, fading over time". "How long": "Your most-played list keeps
200 songs; a song you stop playing fades and drops off." Move `POLICY_VERSION` on. Before merging,
confirm how the web and mobile apps react to a new `POLICY_VERSION` (consent screen or banner)
and note it in the PR.

### Phase 3. Import (independent of Blend; ship before it)

**I1. Parsers**, `packages/shared/importParse.ts`. Pure, no I/O.

```ts
export interface ImportedTrack {
  readonly title: string; readonly artist: string;
  readonly album?: string; readonly durationSec?: number;
}
export interface ImportedPlaylist { readonly name: string; readonly tracks: readonly ImportedTrack[] }
export interface ImportBundle {
  readonly source: 'spotify-export' | 'csv';
  readonly liked: readonly ImportedTrack[];
  readonly playlists: readonly ImportedPlaylist[];
  readonly skipped: number;                 // podcasts, local files, malformed rows
}
export function parseSpotifyLibrary(json: unknown): ImportedTrack[];   // YourLibrary.json, "tracks"
export function parseSpotifyPlaylists(json: unknown): ImportedPlaylist[]; // Playlist1.json, Playlist2.json…
export function parseCsv(text: string): ImportBundle;                 // header row required
```

- Treat every field as `unknown` and narrow it. Unknown keys are ignored. The exact Spotify field
  names must be confirmed against a real export before coding. Get one from the owner, strip it to
  5 tracks, and commit it as a fixture with names replaced. Field names guessed from memory are
  not acceptable.
- Skip podcast episodes, local files, empty titles. Count them in `skipped`.
- CSV: accept headers case-insensitively: `title|track name|name`, `artist|artist name(s)|artists`,
  `album|album name`, `duration|duration (ms)`; `;`-separated multi-artists become ", ".
- Limits: 10,000 tracks and 200 playlists per import; more is cut with a visible note.
Done when: fixture tests for both formats, a malformed file, an oversized file, and a podcast-only file.

**I2. ZIP reading.** Accept the ZIP Spotify sends. Add `fflate` (small, no native code) to
`apps/web` only, and read only `*.json` entries whose names match `YourLibrary.json` or
`Playlist\d+.json`. Reject entries over 20 MB and archives over 200 MB before inflating
(read sizes from the central directory). Done when: a test ZIP with an extra 100 MB junk entry is
rejected without inflating it.

**I3. Match endpoint.** `POST /api/import/match` (contract first). Account only (guests get 403
`import.signin`). Body `{ tracks: ImportedTrack[] }`, 1–50 tracks; each title and artist at most
200 characters. Response `{ results: { index, song: SongSnapshot | null, confidence: 'exact' | 'close' | 'none' }[] }`.
Server, in `apps/api/src/services/importMatch.ts`:
1. Normalised key `identityKey(title, artist)`; look up `cachedLookup` key `import-match:<key>`
   (hit 30 days, miss 7 days). Match results are not personal, so the cache is shared.
2. On a miss, catalog search `"<title> <lead artist>"` (existing catalog service, which already has
   timeouts), take the best by title similarity + lead-artist match + duration within 5 s when known.
   `exact`: normalised title equal and lead artist equal. `close`: title equal and artist overlaps,
   or similarity ≥ 0.85. Otherwise `none`.
3. At most 4 searches in flight per request (simple semaphore).
Rate limit bucket `import`: 30 requests a minute per IP (1,500 tracks a minute).
Done when: tests with a fake catalog cover exact, close, none, the cache hit path, the 51-track
400, and a provider timeout returning `none` without failing the batch.

**I4. Import flow (web).** Route `/import` (add to `apps/web/src/lib/routes.ts`), linked from
Settings and from the Library empty state. Component `apps/web/src/components/ImportPage.tsx`,
state as a reducer (`useReducer`) with these states and nothing else:

```
choose → reading → preview → matching → review → saving → done
                 ↘ error (file)          ↘ error (network, resumable)
```

- **choose**: two cards, "Spotify data download" (with a 3-step how-to: Account → Privacy →
  Download your data → "Account data"; it can take a few days to arrive) and "CSV file".
- **reading**: parse in a Web Worker so a 10,000-track file never blocks the page.
- **preview**: "912 liked songs and 14 playlists". Checkboxes per playlist, liked songs on by default.
- **matching**: batches of 50, 2 in flight, progress `matched / total`, cancel button. Progress is
  saved in IndexedDB under the file's SHA-256 so a closed tab resumes where it stopped.
- **review**: "Found 861 of 912". Lists `close` matches to confirm and `none` to search manually
  (reuse the existing search) or skip. Nothing is written before this step is confirmed.
- **saving**: library ops through `POST /api/me/library/ops` (`applyLibraryOps` in
  `apps/web/src/lib/api.ts`). Each request holds at most `LIBRARY_OPS_MAX` (100) ops and at most
  28 KB of JSON (the API's body limit is 32 KB), and the writes bucket allows 60 requests a minute,
  so a 10,000-song import takes a few minutes: show it, and on 429 wait for `Retry-After`.
  Each like op has `origin: 'import'`. Each imported playlist gets a deterministic id
  `import-<first 12 hex of sha256(source + name)>`, so importing the same file twice updates the
  same playlists instead of duplicating them. Library ops are last-writer-wins by `at`, so retried
  chunks are idempotent.
- **done**: counts, "Open Liked songs", "Open playlists". Songs already liked are counted as
  "already in your library", not re-added.
Accessibility: progress in an `aria-live="polite"` region updated at most every 2 s; every
control keyboard-reachable; the file input has a visible label.
Done when: a browser test on :5173 imports the fixture file, a resumed import after reload skips
done batches, and a second import of the same file creates no duplicate playlists.

**I5. Mobile import.** Phase 8 adds the same flow using the shared parsers and endpoint; pick the
file with the Expo document picker.

**I6. Taste seed from import.** After saving, call `POST /api/me/taste/import-seed` with
the top 25 artists by count (computed in the browser from matched songs). Server applies one seed
per artist with weight `SIGNAL_WEIGHT.seed * log2(1 + count) / log2(1 + maxCount)` through
`applySeeds`. Done when: a test shows an import of 900 songs by 300 artists changes the stored
taste by at most 25 artists, and leaves `signals` growing by at most 25.

Privacy page for import: "When you import from Spotify, the file stays on your device. Allegra
receives song titles, artists, albums and lengths to find them in its catalog. Songs it finds are
added to your library like any other."

### Phase 4. Match score

**M0. Artist facts.** `apps/api/src/services/artistFacts.ts`: `artistFacts(keys)` per 4.5, using the existing
artist lookup and `cachedLookup` (30 days hit, 1 day miss), at most 4 lookups in flight, 3 s total budget,
fallbacks as listed. Tests: cache hit, provider timeout falls back, popularity maths.

**M1. Taste distribution.** `packages/shared/blendTaste.ts`: `memberTaste({ now, loved, kept }, facts)` →
`MemberTaste` per 4.4. Tests: shares sum to 1 (within 1e-9); 900 imported likes and 60 likes give the Loved
layer the same total; βnow ramps with tally size; featured artists split 1/3.

**M2. Match.** `packages/shared/blendMatch.ts` per 4.6. Port the worlds in `.planning/blend/match-sim.mjs`
into `blendMatch.test.ts` and assert the table's **ordering** (each row scores at or above the next), plus:
symmetry (`pairMatch(a, b).match === pairMatch(b, a).match`), an empty member (0 and `low`), every output
finite and inside 0–99, and `explainChange` naming the artist whose contribution moved most.

### Phase 5. Blend data and API (pairs, `BLEND_MAX_MEMBERS = 2`)

**B1. Tables** per section 5.

**B2. Convex `convex/blends.ts`**, secret-guarded, every function bounded:
`create`, `get` (blend + members ≤ 6), `listForUser` (`take(20)`), `invite` (reuse a live invite or
create), `preview` (by code), `join`, `leave`, `rename`, `saveBuild` (compare-and-set: only writes if
`buildVersion` equals the version read; returns `{ saved: false }` otherwise), `sweep` (expired
invites, Blends with < 2 members and their members; called from the existing daily cron).
Invariants each mutation must enforce, with a test each:
- `memberCount ≤ BLEND_MAX_MEMBERS`; join on a full Blend fails with `full`.
- A user is in at most 20 Blends; the 21st join or create fails with `limit`.
- Joining twice is a no-op that returns the Blend.
- Leaving as owner moves ownership to the earliest `joinedAt` remaining member.
- The last member leaving deletes the Blend, its members and invites in the same mutation.
- Any membership change sets `stale: true`.
- Erasing an account (`account:eraseSome`) removes its `blendMembers` rows and applies the leave rules.

**B3. API routes** `apps/api/src/routes/blends.ts`, all account-only (guest → 403 `blend.signin`),
all behind `BLEND_ENABLED`, rate limits: writes bucket for writes, `lookup` bucket for invite preview.

| Method and path | Body | Returns | Errors |
|---|---|---|---|
| `POST /api/blends` | `{ name?, consent: { policyVersion } }` | `BlendSummary` + `invite` | `limit`, `consent` |
| `GET /api/blends` | none | `BlendSummary[]` | none |
| `GET /api/blends/:id` | none | `BlendDetail` (rebuilds if needed, B4) | `notfound` for non-members, never `forbidden` |
| `POST /api/blends/:id/invite` | none | `{ code, url, expiresAt }` | `notfound` |
| `GET /api/blend-invites/:code` | none | `{ inviterName, memberCount, full, expired }` | `notfound` |
| `POST /api/blend-invites/:code/accept` | `{ consent: { policyVersion } }` | `BlendSummary` | `expired`, `full`, `limit`, `consent`, `notfound` |
| `POST /api/blends/:id/leave` | none | `{ left: true }` | `notfound` |
| `PATCH /api/blends/:id` | `{ name }` | `BlendSummary` | `notfound`, `invalid` |

`BlendDetail` = `{ id, name, members: { userId, displayName, initials, isYou, learning }[],
pairs: PairMatch[], change?: ChangeReason, tracks: BlendTrack[], builtFor, state:
'ready' | 'not_enough' }`. Member `userId`s are opaque ids already used in the app; never emails.
`consent.policyVersion` must equal `POLICY_VERSION` or the call fails with `consent`.
Invite codes: 12 characters from the existing `CODE_ALPHABET` (`apps/api/src/user/actions.ts:15`),
drawn with rejection sampling so there is no modulo bias (write `randomCode(length)` once and use
it for shares too). Unknown, expired and malformed codes all return the same `notfound` copy and
timing class, so a guesser learns nothing.
Done when: route tests cover each row of the table, guest rejection, flag off (404), and a
non-member fetching a Blend id getting `notfound`.

**B4. Build orchestration** `apps/api/src/services/blendBuild.ts`:
1. If `builtFor === todayUtc` and not `stale`, return stored.
2. For each member: `tally.top(200)` (skipped when `learning` is false), newest 1,000 likes,
   newest 300 playlist items (new bounded Convex queries on the existing indexes).
3. Resolve Gaana-only identities to Saavn via the catalog (cached like I3); drop the unresolved.
4. `artistFacts` for each member's top 30 artists (4.5) → `memberTaste` → `pairMatch` for every
   pair → `buildBlend` with discovery from catalog suggestions of the top 3 shared songs (existing
   `/api/songs/:id/suggestions` service). Facts and discovery share one 3 s budget.
5. `saveBuild` with the version read in step 1. If it returns `saved: false`, another request
   built first: return what is stored.
6. Log `{ members, candidates, unresolved, tracks, ms }`.
Budget: the whole build under 8 s; if the discovery step times out, build without it.
Done when: a test with two fake members returns 50 tracks; a concurrent second build does not
overwrite; a provider outage still returns a build from library data.

### Phase 6. Builder

Implement 4.7 in `packages/shared/blendBuild.ts` with every fixture listed there. This phase can
run in parallel with phase 5 since it is pure. The blend document keeps the identities of the last
two builds (`previousTracks`, at most 100) for the freshness rule.

### Phase 7. Web UI (behind `NEXT_PUBLIC_BLEND_ENABLED`)

Routes in `apps/web/src/lib/routes.ts`: `/blends`, `/blend/:id`, `/blend/join/:code`.
Entry points: a "Blends" shelf in `LibraryPage.tsx` with "Create a Blend"; nothing on Home in v1.

**W1. Create and invite.** "Create a Blend" → consent sheet (copy `blend.consent.*`) → creates →
invite sheet with the link, "Copy link", and `navigator.share` when available. The sheet polls
`GET /api/blends/:id` every 3 s while open and visible (D1) and moves to the reveal when the
member count reaches 2.

**W2. Join page** `/blend/join/:code`. Signed out: inviter name and "Sign in to join", using the
existing sign-in. Signed in: consent sheet, then join, then the reveal. Expired, full, limit and
unknown codes each have their own state (section 9).

**W3. Reveal.** Components in `apps/web/src/components/blend/`:
- `BlendReveal.tsx`: two `MemberDisc`s slide in from the left and right edges
  (`transform: translateX`) and meet in the centre, over `MusicFlowShader` with `palette` mixed from
  each member's top cover colour (`extractPalette` exists in `apps/web/src/lib/palette.ts`).
- `MatchNumber.tsx`: counts 0 → match over `motionTokens.duration` (the longest token), spring
  from `apps/web/src/motion`. With reduced motion it shows the final number with an opacity fade.
- One `tapHaptic()` when the number lands (`apps/web/src/lib/haptics.ts`).
- The reveal plays once per build; `localStorage` key `blend-revealed:<id>:<builtFor>` (wrapped in
  `try/catch`) prevents replaying it every visit.

**W4. Blend page** `/blend/:id`: header (name, discs, match, "Updated today"), story cards row,
track list. Each row shows the discs of `for` members; `kind: 'discovery'` rows show "New for you".
A chip per member filters to their picks. Play, like and add-to-playlist reuse the existing row
component and the one playback funnel (`requestPlayback`); playing a Blend sets the queue to its
tracks.

**W5. Story cards** `BlendStories.tsx`, horizontally scrollable with snap points.
Two-person Blend, in this order, at most 6: match (with the change reason if any), the song that
brings you two together, both directions ("You'd enjoy 93% of Rahul's music. He'd enjoy 26% of
yours."), the artist that brings you together, each person's gift to the other, and how many songs
each person brought. Group Blend (phase 9), at most 4: group match, most in tune with you, least in
tune with you, the group's glue. The card set is chosen by member count in one place
(`storiesFor(detail, viewerId)` in `packages/shared/blendStories.ts`, unit tested), never by
scattered `if`s in components. Each card has "Share", drawn on a
1080 × 1920 `<canvas>` (D17), shared as a PNG file, or downloaded if sharing files is unsupported.

**W6. States.** Each needs a screenshot in the PR at 360, 768 and 1280 px:
loading (skeleton matching the final layout), not enough yet (`state: 'not_enough'`), low
confidence note, learning-off note for a member, invite expired, Blend full, at your 20 limit,
network error with retry, flag off (route 404s to the existing not-found page).

**W7. Accessibility.** Discs have `aria-label="{name}"`; the match is text, not only an animation;
story cards are a list of buttons with visible focus; the reveal is skippable with Escape and with
a "Skip" button; nothing auto-advances.

Done when: browser checks on :5173 with two test accounts (two browser profiles) cover create,
join, reveal, play a Blend track, leave; console has no errors; reduced motion shows no movement
other than opacity.

### Phase 8. Mobile (LuvLyrics)

Same endpoints. Screens: Blends list, Blend detail, join from a deep link
(`lyricflow://blend/join/<code>` plus the https link). Import from Phase 3 (I5). Follow
`apps/mobile/CLAUDE.md`; mobile has its own lockfile.

### Phase 9. Groups of 3 to 6

Raise `BLEND_MAX_MEMBERS` to 6. UI: a ring of discs; each line between two discs is that pair's
match (thickness by match, drawn as scaled elements, transform only). Tapping a line opens that
pair's card. Group match = mean of pairs, shown as "Group match". Story cards switch to the group
set (W5, 4.6). Builder fixtures for 3 and 6 members (each member's average enjoyment within 0.05
of the others). Budget check: 6 members read at most
6 × 1,500 rows per daily build.

## 7. Cost and limits

| Action | Convex writes | Convex reads |
|---|---|---|
| A listen | 1 tally row (+1 meta row for a new song, +1 delete on eviction) | 2 index reads |
| A like or playlist add | 1 tally row | 1 index read |
| Open a Blend already built today | 0 | 1 blend + ≤ 6 members |
| Daily build, 2 members | 1 blend | ≤ 3,000 small rows |
| Import of 1,000 songs | about 1,000 library rows, in 5 requests | none extra |

Hard caps in code, each with a test: 200 tally rows per listener, 1,000 likes and 300 items read per
member per build, 50 tracks, 20 Blends per listener, 6 members, 50 tracks per match request,
10,000 tracks per import.

## 8. Edge cases

### 8.1 Data
- A song is played as `saavn:x` and liked as `gaana:y`: same identity, one entry.
- A member erases their account: they leave every Blend (B2), the next build excludes them.
- A member turns learning off: the tally is cleared; their `learning` flag in every Blend becomes false.
- A Blend whose remaining songs all fail Saavn resolution: `state: 'not_enough'`.
- Clock skew: `playedAt` in the future is clamped to server now; older than 30 days is ignored for the tally.

### 8.2 Concurrency
- Two members open the Blend at the same moment: compare-and-set in `saveBuild` (B4 step 5).
- Two joins race for the last seat: the mutation re-reads `memberCount` inside the transaction.
- Invite regenerated while someone holds the old link: the old code returns `expired`.

### 8.3 Product states
- "Not enough yet": fewer than 10 tracks. Copy says what to do ("Like a few songs or keep listening").
- Low confidence: either member has fewer than 20 items. The match shows with "Early days" beside it.

## 9. Copy (user-facing; keys are suggestions, words are final)

| Key | Text |
|---|---|
| `blend.signin` | Sign in to make a Blend. Blends need an account so your friend knows it's you. |
| `blend.consent.title` | Blend your taste with a friend |
| `blend.consent.body` | Your most-played songs, likes and playlists shape a playlist that everyone in this Blend can see. They see songs and your taste match, never how much you listen. You can leave at any time. |
| `blend.full` | This Blend is full. |
| `blend.expired` | This invite has expired. Ask for a new link. |
| `blend.notfound` | We couldn't find that Blend. The link may be wrong or the Blend may have ended. |
| `blend.limit` | You're in 20 Blends, the most there can be. Leave one to join this. |
| `blend.notenough` | Not enough to blend yet. Like a few songs or keep listening, and it fills in. |
| `blend.lowconfidence` | Early days |
| `blend.learningoff` | {name}'s picks come from likes and playlists. |
| `blend.change.up` | Up {n} points: you both played more {artist}. |
| `blend.change.down` | Down {n} points: you've drifted apart on {artist}. |
| `blend.story.song` | The song that brings you two together |
| `blend.story.closest` | The closest you get |
| `blend.story.mostInTune` | Most in tune with you: {name}, {n}% |
| `blend.story.leastInTune` | Least in tune with you: {name}, {n}% |
| `blend.story.groupMatch` | Group match: {n}% |
| `blend.story.glue` | What holds this group together |
| `import.signin` | Sign in to import your library, so it follows you to every device. |
| `import.toolarge` | That file has more than 10,000 songs. We'll import the first 10,000. |
| `import.unreadable` | We couldn't read that file. Pick the ZIP or the JSON files from Spotify's data download, or a CSV. |
| `import.network` | Matching paused because the connection dropped. Your progress is saved; carry on when you're back online. |

## 10. Verification at the end of each phase

```
npm run typecheck
npm run lint
npm test
```

Plus, per phase:
- Phase 0: `cd convex && npm test` (the repo's `convex:test`), and the privacy page at :5173/privacy.
- Phase 2: a local listen of a song, then `top` showing it (dev route or test).
- Phase 3: browser import of the fixture on :5173; a 10,000-track synthetic file stays responsive
  (no long task over 200 ms during reading, measured with a `PerformanceObserver`).
- Phase 5: the route table tests.
- Phase 7: two accounts end to end, screenshots at 360 / 768 / 1280, reduced-motion check.

## 11. Out of scope for v1

Artist Blends, Google profile photos, push notifications on join, Blend cover image generation on the
server, Wrapped-style yearly Blends, Apple Music / YouTube Music import formats (CSV covers most
exporters).

## 12. Sources

- Spotify Engineering, "A Look Behind Blend" (relevant, coherent, equal, democratic; "maximise the
  joy"): https://engineering.atspotify.com/2021/12/a-look-behind-blend-the-personalized-playlist-for-youand-you
- Spotify Support, Blend (up to 10 friends, daily updates):
  https://support.spotify.com/us/article/social-recommendations-in-playlists/
- Spotify Newsroom, cover art, taste match, data stories (2021-08-31):
  https://newsroom.spotify.com/2021-08-31/how-spotifys-newest-personalized-experience-blend-creates-a-playlist-for-you-and-your-bestie/
- Spotify Newsroom, groups and artist Blends (2022-03-30):
  https://newsroom.spotify.com/2022-03-30/discover-and-listen-to-music-with-even-more-friends-and-family-plus-some-of-your-favorite-artists-with-spotifys-newest-blend-update/
- Spotify for Developers, quota modes (development mode: 5 users):
  https://developer.spotify.com/documentation/web-api/concepts/quota-modes
- Spotify for Developers, extended access criteria from 2025-05-15:
  https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access
- Spotify Support, what the data download contains (playlists; library items with URIs):
  https://support.spotify.com/us/article/understanding-your-data/
- MinHash estimator variance √(J(1−J)/k):
  https://mbrenndoerfer.com/writing/minhash-algorithm-jaccard-similarity-lsh-deduplication
- Forward decay: Cormode, Shkapenyuk, Srivastava, Xu, "Forward Decay: A Practical Time Decay Model
  for Streaming Systems", ICDE 2009 (cited in Kleppmann, Designing Data-Intensive Applications, ch. 1).
