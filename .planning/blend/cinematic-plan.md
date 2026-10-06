# Blend + Spotify import: cinematic UI/UX plan

Mode: **planning only**. Nothing here is built or verified yet; the acceptance table lists planned checks.
Scope: web (`apps/web/src/components/blend/*`, `components/import/*`, `styles/blend.css`) and mobile
(`apps/mobile/src/screens/Blend*.tsx`, `ImportScreen.tsx`, `components/import/SpotifySyncPanel.tsx`).
Keeps: clear frosted glass (no dark veils), subtle glows, icon-only buttons, the existing spatial grammar
in `apps/web/src/motion/index.ts` (rise out of the light / sink back / text lifts), transform + opacity only,
every number from a token, reduced motion collapses to opacity.

## 1. What the references say

| Source | Lesson we take |
| --- | --- |
| Spotify Engineering, "A Look Behind Blend" (engineering.atspotify.com/2021/12/a-look-behind-blend…) | Attribution must be *believable*: a face next to a song means that person would agree it's their taste. Data stories (taste match, "the artist that brings you together") are the emotional payload, not the list. |
| Spotify Newsroom, Blend GA (newsroom.spotify.com/2021-08-31/…) | Three pieces: per-Blend cover art, taste-match score, shareable stories unique to each pair. We have score + stories; we lack a **unique cover/artifact** and **share**. |
| Spotify Newsroom, 2025 Wrapped campaign (newsroom.spotify.com/2025-12-03/wrapped-marketing-campaign/) | Reduced palette, bold imagery, texture. Expressive comes from restraint plus one strong visual, not more colour. |
| UX Playbook, Wrapped 2025 (uxplaybook.org/articles/spotify-wrapped-ux-design-lessons) | Stories beat stats: present a number with context ("top 2% of fans"), in a paced vertical sequence. |
| Buell & Norton, *The Labor Illusion* (HBS / Management Science 2011) | Showing the work being done (a running tally of real steps) raises perceived value and tolerance for waits, up to a limit (~15s before even transparency stops helping) and only when the outcome is good. Direct application to Spotify transfer. |
| TuneMyMusic / Soundiiz (tunemymusic.com, soundiiz.com) | Industry baseline: pick source → pick items → "Start transfer" → report with clearly flagged misses. Ours already does this; the gap is feel, not function. |
| Android Compose shared elements, Smashing "Shared Element Transitions API" (smashingmagazine.com/2022/10/…) | Continuity: the object you tapped *becomes* the thing on the next screen. Use one instance, moved by transform. |
| Awwwards transitions collection (awwwards.com/awwwards/collections/transitions/) | Mask reveals and object continuity carry the best transitions; page-wide wipes are for portfolios, not utilities. |

## 2. Where things stand (from the code)

**Blend (web)** — strong bones. `BlendStage` already encodes match as orb distance with `screen` blending;
`BlendReveal` slides discs from ±60vw over the shader and counts up; `BlendRing` draws pairs with transform-only lines;
lens filter uses a shared `layoutId` pill.
Gaps:
1. **The reveal and the page are two different objects.** Reveal shows discs over a shader, then dismisses; the page then shows orbs. No continuity: the climax evaporates.
2. Orbs sit at their final distance from first paint. The single most meaningful motion (two tastes moving toward each other until they overlap by the match amount) never plays.
3. Lens filter swaps the track list instantly; the coloured stripe attribution is there but nothing ties the chosen person's tone to the list.
4. Stories, ring and tracks enter with the same generic `pageVariants` stagger: every beat equally loud.
5. Waiting state ("needs a second person") is a plain state card; the ghost orb is the hook and sits above it disconnected.
6. No shareable artifact (Spotify's third pillar).

**Spotify import (web)** — functional, flat. Rows with cover + check, a per-row progress bar, dock with Transfer/Pause,
daily toggle. File import uses native `<progress>`, plain checkboxes, and ends on "Done.".
Gaps:
1. No focal object: selection, transfer and completion look like the same list in three states.
2. Progress is a bar + "Matching · N added": no operational transparency (which songs, how many found).
3. Completion is a status string, no arrival into the library.
4. Selection has no consequence outside the row (the dock counter changes text only).

**Mobile** already uses Reanimated (springs, translateX progress fill, disc slide-in) — same gaps, smaller surface.

## 3. Decision statements

> **Blend.** The user opens a shared playlist with a friend. The persistent **pair of light orbs** changes by
> **drifting together until they overlap by exactly the taste match**, then the overlap lights the number. The
> frosted stage supports that object with one soft light pool behind the overlap. The controls stay round glass
> keys in the hero bar. The journey concludes with **the orbs settled as the page hero, a shareable match card,
> and Play** ready.

> **Spotify import.** The user moves their library into Allegra. The persistent **crate** (a stack of the selected
> playlist covers in the dock) changes by **gaining a sleeve per selection, then dealing each sleeve into the
> library as it finishes**. The stage supports it with the existing glow. Controls stay the tactile list + one
> primary key. The journey concludes with **the crate empty, a counted arrival ("1,284 songs now in your
> library"), and Open Library**.

## 4. Blend storyboard

| Scene/state | User intent | Focal object pose | Content and controls | Light/space | Entry/exit | Reduced motion |
| --- | --- | --- | --- | --- | --- | --- |
| B0 Loading | wait | skeleton orbs (static, not shimmer-heavy) | skeleton title, 3 rows | none | fade | same |
| B1 Waiting for friend | invite | your orb lit left, ghost orb right breathing (opacity only) | headline *inside* the stage: "Waiting for a friend"; Send invite key directly under the ghost orb | light pool only behind your orb | ghost breathes 0.35↔0.6 opacity | ghost static at 0.5 |
| B2 First reveal (once per build, existing `revealSeen`) | discover the match | orbs start far apart (±reach_max) **in the hero itself**, not an overlay; drift in by spring to match distance | name lifts in, number counts up as overlap forms; Skip visible | light pool brightens as overlap grows (opacity on a pre-blurred layer) | ~1.4s total; content below waits to rise until number lands; Skip jumps to end pose | orbs at final pose, number shown, fade 100ms |
| B3 Hero settled | browse / play | orbs at match distance, slow drift (existing `blend-drift`) | title, meta, round keys: Play (accent), Invite, Share card, Leave | static | — | drift off |
| B4 Stories | read the "why" | orbs unchanged | story cards rise one at a time on scroll into view (IntersectionObserver, once) | each card tinted by mixed palette (existing `useBlendPalette`) | riseIn, 40ms stagger cap 3 | opacity only |
| B5 Lens: one person | see their picks | **their orb scales 1.06, other dims to 0.5 opacity** | list: rows not theirs exit (exitUp, 140ms), theirs re-flow; pill already slides | — | list swap ≤ 300ms | opacity swap |
| B6 Pair sheet (group) | inspect a pair | ring line for that pair brightens; others dim | sheet rises | — | sheet spring | fade |
| B7 Share card | brag | orbs render into a 9:16 card with names + % + "brings you together" artist | Download / Share (Web Share API, feature-detected) | — | card rises from hero | fade |
| B8 Leave confirm | leave | your orb sinks (exitDown) on confirm *after* server success | sheet | — | on failure orb stays, error shown | fade |
| B9 Rebuilding (`stale`) | wait | orbs pulse together once per poll (opacity) | "Refreshing…" status, no refresh button needed while polling | — | — | static |

Key change: **delete the overlay-vs-page split.** `BlendReveal` becomes a *mode of `BlendStage`* (`intro` prop),
keeping its Skip, focus trap equivalent (focus moves to Play when landed) and `markSeen`. The shader can stay as an
optional backdrop behind the stage during intro only.

## 5. Spotify import storyboard

| Scene/state | User intent | Focal object pose | Content and controls | Entry/exit | Reduced motion |
| --- | --- | --- | --- | --- | --- |
| S0 Not connected | connect | empty crate outline in dock + Spotify mark | one line of value, Connect key | rise | static |
| S1 Connected, nothing picked | choose | empty crate | list; Liked Songs pinned first; "Select all" | rows stagger (cap 6, then instant) | opacity |
| S2 Picking | choose | **tapped row's cover flies (FLIP via transform) into the crate**; crate shows top 3 sleeves fanned with count badge | dock: "3 playlists · 812 songs" + Transfer | cover flight 280ms; unselect flies back | no flight; crate count updates |
| S3 Transferring | wait | top sleeve of crate lifts and tilts while its playlist matches | **operational transparency line**: real titles ticking "Found · Song — Artist" (throttled, 4/s max, from existing step data); per-row ring; overall bar | ticker swaps with swapVariants | ticker updates without travel |
| S4 One playlist done | see progress | sleeve deals out of the crate toward the Library nav item, crate count -1 | row gets check + "214 added · 6 skipped" | 320ms | instant |
| S5 Paused / failed | recover | crate stays with remaining sleeves | Resume key; failed row explains + Retry; nothing lost | — | — |
| S6 All done | arrive | crate empty, settles; library nav item gets one soft glow pulse | "1,284 songs now in Allegra", Open Library, Review 12 skipped | number counts up (existing `MatchNumber` pattern) | number shown |
| S7 Daily sync on | trust | small "daily" badge on crate | toggle with explanation | — | — |

File import (Takeout/CSV) reuses the same crate: parsed playlists enter the crate after reading; "Found N of M"
becomes the ticker; the close-match review keeps its list but each ticked row flies a mini-sleeve to the crate.
Replace native `<progress>` with the shared transform-based bar the mobile app already uses (`translateX` fill).

## 6. Action contract

| Event | Logical state accepted | Immediate feedback (≤ `ACK_MS` 120) | Secondary response | Next input ready | Duplicates / interruption |
| --- | --- | --- | --- | --- | --- |
| Select Spotify row | `selected` set updated synchronously | check fills (spring.tactile), row press 2px | cover flight to crate (280ms) | immediately; flight is decorative | rapid toggles: cancel in-flight flight, retarget to latest state |
| Transfer | queue built, button → Pause | key press + label swap | top sleeve lifts, ticker starts | Pause available at once | double-click ignored (existing `syncing` guard) |
| Pause | abort current run | Pause → Resume | sleeve settles back | at once | — |
| Lens filter | `filter` set | pill slides (existing) | orb emphasis + list swap | at once; list swap may be interrupted by next tap (AnimatePresence `mode="popLayout"`) | last tap wins |
| Skip reveal | `markSeen` | jump to settled pose | below-fold content rises | at once | Escape = Skip (existing) |
| Leave confirm | server call | key pending state | orb sinks only on success | after response | failure: orb stays, error |

**Reveal timeline (most important, plays once per build):**

```
t=0      orbs at ±reach_max, opacity 0 → 1 (base 240ms)
t=80     orbs spring toward match distance (spring.hero)        ┐ overlap
t=200    light pool opacity follows overlap amount              ┘
t=400    MatchNumber starts counting (existing component)
t≈1100   number lands → label + meta lift in (riseIn), focus → Play
t≈1300   stories rise; page interactive the whole time (Skip always live)
```

New tokens (add to `motion/index.ts`, no ad-hoc numbers): `duration.flight = 0.28`, `duration.deal = 0.32`,
`ticker.maxPerSecond = 4`, `reveal.numberDelay = 0.4`. Reuse `spring.hero`, `spring.tactile`, `riseIn`, `exitUp`, `exitDown`, `swapVariants`.

## 7. Engines and cost

- Web: `motion/react` (already used) for springs, `layoutId`, AnimatePresence; CSS keyframes only for ambient drift/breath.
  Cover flight = FLIP with `transform` on a cloned `<img>` in a fixed overlay layer, removed on `animationend`.
  No new library.
- Mobile: Reanimated shared values; cover flight via `measure()` + absolute `Animated.Image`; haptic `selectionAsync`
  on select, feature-safe no-op.
- Light pool: one pre-blurred radial gradient layer, animate **opacity** only (never `filter`/`box-shadow`).
- Orbs already use `mix-blend-mode: screen`: profile on a mid Android phone; fallback to plain opacity overlap if
  frame time > 16ms during the reveal.
- Ambient pause: drift/breath stop when the tab is hidden and under reduced motion.
- Ticker: `aria-live="polite"` region updates at most every 2s with a summary ("Matched 140 of 812"); the visual ticker is `aria-hidden`.

## 8. Rollout (small PRs)

1. **Tokens + shared progress bar** (web `<progress>` → transform bar). Low risk.
2. **Blend reveal-in-hero**: merge `BlendReveal` into `BlendStage` intro mode; orbs travel to match distance. Biggest felt win.
3. **Lens emphasis + list swap** (orb focus, row exit/enter).
4. **Spotify crate + cover flight + ticker** (web, then mobile).
5. **Completion arrival** for Spotify + file import (count-up, library nav glow).
6. **Blend share card** (canvas render 1080×1920, Web Share / download; mobile `expo-sharing`).
7. Waiting-state redesign around the ghost orb; leave/sink; stale pulse.

Each PR: `npm run typecheck`, `npm run lint`, `npm test`; 360/768/1280/1920 check; reveal profiled on a real phone.

## 9. Acceptance (planned checks, none run)

| Scenario | Expected | Method |
| --- | --- | --- |
| Static first paint | Blend title, match and Play readable before any motion; import list usable | screenshot with animations disabled |
| Reveal | orbs end at the same distance `BlendStage` computes today; number = API match; Skip/Escape lands the same final frame | interaction + DOM transform read |
| Reveal replay | once per `revealKey`; reload does not replay | localStorage trace |
| Rapid row toggles | final selection = last state; no orphan flying covers | 10 fast clicks, DOM count of overlay nodes = 0 after 1s |
| Transfer pause/resume | no lost or duplicated playlist; crate count matches `runs` | stub API |
| Lens rapid taps | list = last filter; no stuck exiting rows | fast taps |
| 360×740 and 390×844 | dock and Transfer reachable, no horizontal scroll | browser |
| Reduced motion | no travel, flight, overshoot, haptics; all states still visible | emulate `prefers-reduced-motion`, Android "Remove animations" |
| Keyboard | every control reachable; focus lands on Play after reveal, on Open Library after import | keyboard pass |
| Screen reader | ticker silent; summary announced ≤ every 2s | NVDA/TalkBack |
| Failure | failed playlist keeps crate sleeve and offers Retry; no celebration | stub 500 |
| Performance | reveal ≥ 55fps on mid Android; no layout/paint storms in trace | Chrome perf trace on device |
| Playback | music keeps playing through all of the above | play, run reveal/import, confirm `<audio>` not remounted |
