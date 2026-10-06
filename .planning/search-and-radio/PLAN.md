# Search, song radio and the queue that learns

Prepared 2026-10-06. Covers web (`apps/web`), API (`apps/api`), shared rules (`packages/shared`)
and the phone (`apps/mobile`).

## Status (2026-10-06, branch `feat/search-radio`)

Phases 1 to 5 built on web and phone, with these differences from the plan below:

- **D1 reversed.** The phone keeps searching Saavn directly. Songs from the Allegra API would
  stream through the Vercel function instead of Saavn's CDN, which changes the playback path.
  The phone gets the same instant behaviour from the shared prefix cache, a 90 ms debounce,
  request cancellation and relevance order.
- **Phone taste is local.** The phone ranks with the artists and languages in its own stream
  history instead of the server profile, so it works for guests and offline. Web uses the server
  profile through `GET /api/radio/:songId`.
- **Sub-5 s skips** teach the radio on both apps. On the phone they do not reach the server: its
  outbox posts Recently played with every signal, and a two-second skip is not a play.
- **"Less like this"** is removing a radio song from Playing next (web). No new control.
- The Player menu's **Radio** on the phone now uses the same adaptive session.
- Not done: phase 0 baseline numbers, physical-phone checks.

## What the owner asked for

1. **Instant search.** Halfway through typing a song name, suggestions appear in under a second and
   change with every letter, the way Spotify's do.
2. **A tapped search result starts that song's radio.** What plays next is music like that song, chosen
   for this listener, not the next row of the search results.
3. **A queue that learns while you listen.** How long you listened before skipping changes what plays
   next:
   - a skip in the first 30 seconds means "not this";
   - a skip in the last 10–15 seconds means you liked the song.

   The upcoming songs re-rank immediately, not only in tomorrow's recommendations.
4. Do what Spotify does, then do it better.

## What Spotify actually does (researched 2026-10-06)

| Behaviour | Evidence |
|---|---|
| Every keystroke updates search results; this is a stated design requirement. Matching works on character prefixes, so a partial word finds the song. | Spotify Research, "Neural Instant Search for Music and Podcasts" (KDD 2021): https://research.atspotify.com/2021/8/neural-instant-search-for-music-and-podcasts |
| Autocomplete suggestions appear after a few letters and come from popular searches, the listener's own search history, and known artist, song and podcast names. | Spotify Support, "Search autocomplete": https://support.spotify.com/us/article/search-autocomplete/ |
| Playing a song from Search replaces the previous context. With Autoplay on, Spotify starts a **song radio** chosen from the listener's habits, so two people see different "next" songs for the same search. It does **not** play the next search result. With Autoplay off, the song plays and stops. | Spotify Community (Android, autoplay from search): https://community.spotify.com/t5/Android/How-can-I-get-back-autoplay-from-search-results/td-p/4909635 · "Bring back clear queue": https://community.spotify.com/t5/Other-Podcasts-Partners-etc/Bring-back-clear-queue-option/td-p/5587292 |
| The queue has two layers. **Next in queue** holds songs the listener added; they always play first and survive a new context. **Next from / Next up** is the context, then Autoplay's picks; it is replaced when new content is played. | Spotify Support, "Autoplay": https://support.spotify.com/us/article/autoplay/ · Spotify Community, "Turn off autoplay": https://community.spotify.com/t5/Your-Library/Turn-of-auto-play-FOR-REAL/td-p/6789575 · overview: https://www.drmare.com/spotify-music/spotify-clear-queue.html |
| Skips are a core implicit signal. Spotify ran a public sequential skip-prediction challenge built on what a listener did earlier in the same session. Its research uses negative signals (skips) inside a session model. Reordering a sequence alone cut skip rate by 2.73%. A skip within 30 seconds is widely reported as the negative threshold (it also does not count as a stream). | AIcrowd / WSDM, "Spotify Sequential Skip Prediction Challenge": https://www.aicrowd.com/challenges/spotify-sequential-skip-prediction-challenge · "Leveraging Negative Signals with Self-Attention for Sequential Music Recommendation": https://arxiv.org/html/2309.11623v2 · Spotify Research, sequencing: https://research.atspotify.com/2023/10/exploiting-sequential-music-preferences-via-optimisation-based-sequencing · 30-second threshold (industry write-up, not an official Spotify statement): https://www.boost-collective.com/blog/spotify-save-rate-vs-skip-rate |
| Typeahead practice: answer in roughly 100–300 ms. Cancel superseded requests. Never let an older response overwrite a newer query. Cache short, hot prefixes because they are shared by many longer queries. | https://systemdesignschool.io/problems/typeahead/solution · https://prachub.com/resources/search-autocomplete-system-design-interview-tries-ranking-and-low-latency · https://fearchitect.com/topics/autocomplete-typeahead |

Spotify's internal ranking models are not public. Everything below about how Allegra ranks is our
own design, built from the behaviour above and the signals Allegra already has.

## How Allegra behaves today (read from the code with graft, 2026-10-06)

### Search

| Where | What happens | Why it feels slow |
|---|---|---|
| Web command palette `apps/web/src/components/CommandPalette.tsx:127-165` | 220 ms debounce. Needs at least 2 characters. Calls the full `/api/search` (`lib/api.ts:192`). Aborts the previous request. | The full search is the only tier. Measured from this machine against production: **1.1–4.1 s cold** (`kes` took 4.07 s), **0.67 s** on a cached repeat. |
| API `apps/api/src/catalog/catalog.ts:71-99` | Over-fetches 60 results. `normalizeMany` (`:488`) sorts by **play count**, which throws away the provider's relevance order before `originalsFirst`. `withCanonicalRelease` then makes extra provider calls on the same path. Results are cached only in each function instance's memory. | Every cold instance repeats the work. Enrichment adds latency even to a three-letter prefix. |
| API response headers | `/api` defaults to `Cache-Control: no-store` (audit F11), so Vercel's CDN never shares an answer between listeners. | The popular prefixes everyone types are never served from the edge. |
| Phone `apps/mobile/src/screens/SearchScreen.tsx:172-255` | Songs on the phone: 120 ms debounce, local index, fine. Online: **350 ms** debounce, then calls the third-party Saavn mirror directly (`MultiSourceSearchService.ts:125`). That request has a 25 s timeout and **no abort**: stale answers are only dropped by a sequence number. It waits with `Promise.all` for the **YouTube artist lookup** before showing any song. It then re-sorts songs by play count. | Songs are held back until the slower of two requests returns. Relevance order is lost. |
| Light endpoint we don't use | The same Saavn mirror has a global search, `/api/search?query=`, which returns the top hit, a few songs, albums, artists and playlists. One test: **0.47 s** cold for `kesar`, with "Kesariya" as top hit. | This is the right shape for the as-you-type tier. Check it against a working client before relying on it (CLAUDE.md rule on third-party APIs). |

### What plays after a tapped search result

| Where | What happens |
|---|---|
| Web palette → `playSong(song, results)` (`App.tsx:1056`, palette `:188`) | `fromSearch` is only true when `queue === displaySongs`. The palette passes its own `results`, so it is false. Radio then depends on the `shouldStartRadio` remaster heuristic. Otherwise **the search results become the queue.** |
| Web search page → `playSong(song)` | `fromSearch` is true. With **Keep playing similar songs** on, the queue is `[song]`, then `fillRadioQueue`: Saavn suggestions for that song, 20 of them, not personalised. With the setting off, the search list becomes the queue. |
| Phone online result → `StreamService.play(list, index)` (`SearchScreen.tsx:323`, `StreamService.ts:57`) | **The whole search list becomes the queue.** Radio only tops up once 2 songs remain (`RADIO_THRESHOLD`, `:209`), which is after ~18 search rows. This is the bug the owner sees. |
| Phone downloaded result → `playLocal` (`SearchScreen.tsx:290`) | The whole library becomes the queue. |
| Phone radio source `services/stream/recommend.ts:53` | YouTube Music automix, resolved song by song against the catalog. Saavn suggestions are used as a fallback. Good matches but **slow**: several network hops before the first song is queued. Not personalised. |
| "Play next" items (both apps) | Inserted into the one queue with no "added by you" mark, so starting a new song from Search wipes them. Spotify keeps them. |

### What we learn from listening

| Where | What happens |
|---|---|
| `apps/api/src/user/taste.ts:132` `playWeight` | Under 10 s heard counts −0.5 ("skip"). Half the song or 60 s counts +1. **Anything in between counts +0.4**, so a skip at 25 s counts as *liking* the song. It ignores *where* the listener left: skipping in the last 10 s and abandoning at 40 % look the same. |
| Phone `services/sync/listenTracker.ts:34` | Totals honestly heard seconds, which is good. But it **drops any session under 5 s** (`finish`, `:40`), so the strongest "no" (an instant skip) never reaches the server. It also reports a pause as a finished session, and it does not say *why* the song ended (finished, skipped, paused, switched). |
| Web `hooks/useAccount.ts:137` → `sendListenSignal` | Same signal, same gaps. |
| What uses it | The long-term taste profile only: up to 60 artists and 12 languages, decayed, server-side. **No radio or queue reads it**, and nothing reacts within the session. |

## Target behaviour

- **Typing:** one letter shows phone matches and recent searches instantly (0 network). Each
  keystroke shows the cached answer for the longest typed prefix, filtered locally, at once, then
  replaces it with the live answer.
  - Target: **p50 < 300 ms, p95 < 1 s** from keystroke to visible suggestions on a warm session.
  - Old results stay visible until new ones arrive: no blank flash.
  - A pause or Enter loads the full result page.
- **Tapping a search result:** the song plays and the old context is replaced. Songs you added with
  Play next / Add to queue stay in front. **Next up** becomes this song's radio, ranked for you.
  - The first radio song is queued **before the current song's first 10 seconds end** (target
    p95 < 2 s).
  - **Keep playing similar songs** off: the song plays, then stops (Spotify's rule; see D2).
- **Radio that learns while it plays:**

  | How the song ended | Read as | Effect |
  |---|---|---|
  | Finished | Liked | Positive |
  | Skipped in the last 15 s (or after 90 % of the song) | Finished, liked | Positive |
  | Skipped after 30 s but before the end | Mild "not now" | Slightly negative this session; neutral long-term |
  | Skipped before 30 s | Disliked | Negative |
  | Skipped before 10 s | Strongly disliked | Strongly negative |
  | Liked, or added to a playlist | Strongly liked | Strong positive |
  | Went back with Previous to replay it | Liked | Positive, and undoes that song's skip penalty |

  On every signal, the songs that haven't started yet re-rank:
  - early skips push that artist and style down or out;
  - finishes and likes move the radio's centre toward what you enjoyed;
  - after three early skips in a row, the radio stops following the original seed and follows your
    most recent positive song, falling back to your long-term favourites.
- **Better than Spotify** (sensible, low clutter):
  1. Going back to a song you just skipped cancels the penalty (you skipped by accident).
  2. Seeking forward past an intro and staying is not a skip.
  3. Each radio row carries a quiet reason ("Like Kesariya", "You finish Arijit songs") in the
     queue sheet only.
  4. "Less like this" on a queue row re-ranks at once.
  5. Back-to-back repeats are kept out: never the same artist twice in a row, never remasters, lofi
     flips or slowed versions of the seed.

## Design

### A. Search in two tiers

1. **Suggest tier, new route `GET /api/search/suggest?q=`** (contract change: propose, update
   `docs/api-contract.md`, announce).
   - Backed by the provider's light global search.
   - Returns `{ success, data: { topResult, songs (≤6), artists (≤4), albums (≤4) } }`.
   - No canonical-release enrichment, keeps provider relevance order, 1.5 s `AbortController`
     timeout.
   - Search answers are not personal, so this route opts out of the `no-store` default with
     `Cache-Control: public, s-maxage=600, stale-while-revalidate=86400`. Vercel's CDN then shares
     hot prefixes across all listeners and instances, which also takes care of the ROADMAP "shared
     cache" item for search.
   - Mount it in `apps/api/src/app.ts` with a supertest through `createApp` (CLAUDE.md "new router"
     rule).
2. **Full tier, existing `/api/search`**, when typing pauses (~350 ms) or on Enter, for the results
   page.
   - Stop `normalizeMany` re-sorting by play count ahead of relevance; play count becomes a tie-break
     only.
   - **Bump the search cache key** v5 → v6 (CLAUDE.md "changed a matcher or scorer" rule).
3. **Client typeahead module**, shared logic in `packages/shared/typeahead.ts` with pure functions
   and tests:
   - a prefix LRU (~200 entries);
   - local filter of the longest cached prefix;
   - a generation number so an older answer can never overwrite a newer one;
   - an abort on every new keystroke;
   - 0–60 ms debounce for the suggest tier;
   - 1 character allowed for suggestions (2 kept for the network if 1-letter traffic is too costly).
4. **Web**: the palette uses the suggest tier while typing and the full tier on "See all". Recent
   plays and searches that match the prefix render first, with no network wait. Warm the function
   when the palette opens (one suggest request for the empty prefix, or `/api/health`).
5. **Phone**:
   - **D1** decides the source; the recommendation is the Allegra suggest route, for the CDN cache
     and one ranking.
   - Add an `AbortController` to catalog search.
   - **Show songs as soon as they arrive**; artists fill in when they do (drop the `Promise.all`
     wait).
   - Keep provider order.
   - Drop the 25 s timeout to 6 s for suggest.

### B. A search tap starts a song radio

1. One intent on both apps: `playFromSearch(song)`. Web replaces the palette's `onPlaySong(song,
   results)` and the search page's default-queue path. The phone replaces `StreamService.play(list,
   index)` in `playOnline`.
2. The queue becomes `[user-added items…] + [song] + radio`, using the queue tagged as a radio
   (`STREAM_QUEUE_ID` on the phone, `radioActiveRef` on web). That way it keeps refilling and old
   answers are dropped by the existing queue tag.
3. **Fast first song.** At tap time, request two sources in parallel:
   - Saavn suggestions (`/api/songs/:id/suggestions`: one call, cached 24 h);
   - on the phone, also the YouTube automix.

   Queue whichever arrives first. Merge the second into the candidate pool (section D) when it
   lands, deduplicated. If the listener presses Next before anything arrives, wait up to 2 s with a
   quiet "Finding songs like this…" in the player, rather than stopping.
4. **Prefetch** the radio candidates for the top search result once results settle, but only for
   that one row, so the most likely tap is instant.
5. **Mark user-added songs.** Play next / Add to queue items get an `addedByUser` flag on the queue
   item, client-side only. Replacing the context keeps them in front (Spotify's "Next in queue").
   See D3.
6. **Connect:** when this device is controlling another one, send `[song]` with the existing
   autoplay behaviour on the receiver. Both receivers already refill a queue that arrived by Connect
   when their setting is on. No wire change.
7. **Downloaded song tapped in Search (phone):** song radio when online, library as the queue
   offline (D4).

### C. Skip-aware listening signals

1. **Classify how each song ended, in the trackers** (web `useListenTracker`, phone
   `createListenTracker`). When the current song changes or stops, compare the **last position**
   with the duration:
   - `ended`: within 2 s of the end;
   - `skipped`: changed earlier;
   - `paused`: stopped without changing;
   - `switched`: a new context was started from elsewhere.

   This covers every skip path (buttons, notification, headset, voice, widget, Connect) without
   hooking each one. Report `{ heardSeconds, exitPositionSec, exit }`. Keep pause/resume as **one**
   session per song instead of finishing on pause.
2. **Stop dropping sub-5-second sessions when `exit === 'skipped'`.** They are the clearest
   dislike. Keep dropping them for pauses.
3. **New weights** in one pure function in `packages/shared/listenSignal.ts`, used by API, web and
   phone:

   | Heard / exit | Long-term weight | Session effect |
   |---|---|---|
   | `ended`, or skipped in the last 15 s / after 90 % | +1 | +1 |
   | skipped at ≥ 30 s | 0 | −0.3 |
   | skipped at 10–30 s | −0.5 | −1 |
   | skipped before 10 s | −0.8 | −1.5 |
   | seek forward, then ≥ 30 s more heard | treat by total heard | — |
   | Previous back to a skipped song | cancel that song's earlier skip | cancel |

   `playWeight` in `apps/api/src/user/taste.ts` delegates to it. The `/api/me/taste/signal` body gets
   **optional** `exit` and `exitPositionSec` (additive contract change; old clients keep today's
   rule).
   - Bump any cache keys that hold ranked recommendations.
   - Blend's taste tally reads listens too: check that a negative weight cannot drive a tally below
     its floor.
4. **Privacy:** when personalisation or learning is off (`isPersonalised`), nothing is sent or
   stored. In-session re-ranking still works from memory and is discarded when the radio ends (see
   D6).

### D. The smart radio ranker (shared, pure, tested)

`packages/shared/radio.ts`: no I/O. Both apps feed it candidates and events and take back the next N
songs.

- **Candidate pool, 40–60 songs.** Each candidate is tagged with where it came from:
  - seed suggestions (Saavn);
  - phone automix (YouTube);
  - the seed artist's top songs;
  - songs by the listener's top taste artists in the seed's language;
  - a few of the listener's own liked songs that fit, for familiarity.

  Refill when the pool drops below 15, seeded from the **moving centre** (below).
- **Score**, all terms bounded:
  ```
  score = similarity to centre        (rank in source lists, shared credited artists, same language)
        + taste affinity               (long-term favourite artists/languages; 0 for guests)
        + session feedback             (per-artist, decayed by songs since the event)
        − repetition                   (same artist as previous, same recording/variant, already played this session)
        + small exploration bonus      (keeps ~1 in 5 picks outside known artists)
  ```
- **Moving centre:** a weighted mix of 60 % the original seed and 40 % the last positive song
  (finished or liked). After three early skips in a row, switch to 100 % the last positive song, or
  the listener's top taste artists if there was none.
- **Re-rank rules:** only songs that haven't started yet move. User-added songs never move. The
  phone's next song, if Media3 has already staged it for gapless playback, is replaced only through
  `prepareNextInQueue`.
- **Reasons:** each pick carries a short machine reason, rendered as quiet copy in the queue sheet.
- **Deterministic tests** with seeded fixtures:
  - an early skip of artist X removes X from the next 5;
  - a finish moves the centre;
  - three early skips re-seed;
  - a late skip counts as liked;
  - Previous cancels a penalty;
  - user-added songs keep their place;
  - no back-to-back artist;
  - guest (no taste) still works.

### E. Wiring per platform

| | Web | Phone |
|---|---|---|
| Start radio | `playFromSearch` in `App.tsx`; ranker output goes into `useAudioPlayer.replaceUpcoming` | `StreamService.startSearchRadio`; ranker output goes into `nativeQueue.replace(…, tag)` / `insert(…, 'end', tag)`, then `reconcileNativeQueue` |
| Signal feed | `useListenTracker` exit events go to the ranker and `sendListenSignal` | `createListenTracker` (ConnectProvider) exit events go to the ranker and `postListenSignal` |
| Refill trigger | `fillRadioQueue` asks the ranker | `extendRadio` / `onQueueLow` ask the ranker |
| Playback invariants | Play/pause still goes only through `requestPlayback`. No load effect depends on `isPlaying`. The `<audio>` element stays in the layout. | The native engine stays the queue owner; the screen follows its report. |

## Phases

| # | Phase | Size | Proof |
|---|---|---|---|
| 0 | **Baseline.** Use the existing opt-in search→play trace (`.planning/performance/`) to record keystroke→suggestions and tap→next-queued on web and the emulator, before any change. | S | Numbers saved in this folder |
| 1 | **Instant search:** suggest route + contract + CDN header, typeahead module, palette and phone wiring, relevance fix + cache-key bump | M | Unit tests; supertest through `createApp`; browser at :5173 (360/768/1280/1920); emulator; repeat of phase 0 measurements |
| 2 | **Search tap → song radio:** `playFromSearch`, fast first song, prefetch, user-added marker, Connect path | M | Unit tests for the queue shape; browser and emulator: tap result #3 and Next is not result #4; manual Play next survives |
| 3 | **Skip-aware signals:** exit classification, shared weights, contract fields, sub-5 s skips sent | M | Tracker tests for each exit kind; API tests: late skip = positive, 15 s skip = negative, retry idempotent |
| 4 | **Smart ranker:** shared module, candidate pool, moving centre, live re-rank on both apps | L | Ranker fixtures; emulator session: skip two songs by one artist early and that artist leaves Next up |
| 5 | **Polish:** reasons in the queue sheet, "Less like this", Previous cancels a penalty | S | Browser and emulator; reduced motion (opacity only, tokens only) |

Gates for every phase: `npm run typecheck`, `npm run lint`, `npm test`, `npm run mobile:check`,
`npm run sync:shared` after shared edits. Any phone change bumps `expo.version` in
`apps/mobile/app.json` (minor for this feature). Physical-phone feel and two-device Connect remain
unverified until a phone is attached.

## Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| D1 | Phone online search: through the Allegra API (one ranking, CDN cache, one more hop) or directly to the Saavn mirror (one hop, no shared cache)? | Allegra API. A CDN hit should beat a direct cold call. Compare in phase 0/1 numbers and keep direct as fallback if slower. |
| D2 | With **Keep playing similar songs** off, a search tap should… | …play the song and stop (Spotify). Today it queues the search list. |
| D3 | Keep your Play next / Add to queue songs in front when you start a song from Search? | Yes (Spotify's "Next in queue"). |
| D4 | Tapping a *downloaded* song in Search on the phone | Song radio when online, library offline. |
| D5 | Skip thresholds | < 30 s = dislike, < 10 s = strong dislike, last 15 s / 90 % = liked, between = mild. Constants in one file, easy to tune. |
| D6 | Personalisation off | No sending or storing. In-session re-ranking from memory only. |

## Risks and coordination

- **Another session is editing the same files right now.** The performance work touches
  `CommandPalette.tsx`, `App.tsx` and `SearchScreen.tsx`, and `.planning/performance/CHECKLIST.md`
  changed during this research. Rebase on, or coordinate with, that work before phase 1. Keep its
  trace events working.
- The LuvLink branch work is unfinished. Do not mix these changes into it: branch
  `feat/search-radio` from `main` once LuvLink is parked.
- Third-party shapes (Saavn global search, YouTube automix) must be checked against a working client
  at implementation time. Each outbound call gets an `AbortController` timeout and returns empty on
  failure (rule 9).
- Radio quality needs real listening to tune. Fixture tests prove the rules, not the taste. Plan one
  owner listening session per phase 4 change.
