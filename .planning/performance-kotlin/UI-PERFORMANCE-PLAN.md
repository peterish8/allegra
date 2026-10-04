# Rendering and interaction plan

Date: 2026-10-04. Scope: LuvLyrics Android first; preserve the existing web/iOS contracts and visual design.

The user reports lag across the app, not one screen. This is a source-backed investigation and executable plan, not a measured attribution of the lag. The separate lyrics correction is an immediate correctness slice. Do not describe a language migration as a confirmed performance fix.

## Current evidence and existing optimizations

| Area | Source evidence | Consequence for the plan |
|---|---|---|
| Player state | `src/contexts/PlayerContext.tsx:94-120` writes playback progress to shared values and updates `positionStore` about once a second; transport state only changes when needed | Preserve this separation. Do not propose throttling a nonexistent whole-player store update at display frequency. Measure remaining consumers and synchronous shared-value reads. |
| Lyrics | `NowPlayingLyricsArea.tsx:39,300-383` premounts after settling and passes `live={showLyrics}`; `useNowPlayingLogic.ts` has already removed its second auto-scroll driver | Keep one scroll owner. Verify hidden work rather than claiming the old second driver still exists. Geometry correction is separate from CPU profiling. |
| Ambient graphics | `NowPlayingBackground.tsx:170-174` gives the glow `active={glowOn}`; unlike the aura path it does not include `focused`. `hooks/useVisualBudget.ts` depends on playing/battery saver/device tier, without an app-visibility input | Concrete lifecycle gap to test: a visible-lyrics glow can keep its loop eligible when the route or app is no longer visible. A worklet can remain active even when a React screen is frozen. |
| Callback registration | `player/GlowBackground.tsx:93`, `allegra/MusicFlowField.tsx:227`, and `PerformanceHUD.tsx:39` pass inline frame callbacks | Memoize these callbacks as a small separate change. Registration overhead exists on rerender; its contribution to perceived lag is unmeasured. Lyrics already memoizes its callbacks. |
| Graphics budgeting | `utils/visualBudget.ts` already caps ambient redraws, scales by pixel ratio, and rests on low-tier phones while paused | Extend the existing budget, not a second device-tier system. Normal-tier paused visuals still run at a reduced rate; measure whether they should rest under occlusion/background. |
| Backdrop composition | `player/AppleBackdrop.tsx:118-224` retains outgoing/incoming decoded covers and paints blur/mask layers. `NowPlayingBackground.tsx:147-163` adds a second backdrop as the video veil | Profile offscreen rendering, blend bandwidth and GPU memory. Kotlin alone does not reduce the number of full-screen layers or blur passes. |
| Covers | `player/coverImages.ts:18-22` decodes the source image; `player/imageCache.ts:17-54` already has an LRU of six images and in-flight coalescing | Investigate decoded dimensions and bytes, rather than claim an unbounded cache. Preserve outgoing images until their dissolve finishes. |
| Stream | `screens/StreamScreen.tsx:488-614` builds multiple shelf trees under a vertical `ScrollView`; it immediately fetches an extra YouTube Music home page | Growing home pages increase mounted UI and media. Virtualize the vertical feed and request continuation near the end; keep horizontal shelves and the same design. |
| Library | `LibraryScreen.tsx:110-176` memoizes filter/sort/deck, keeps deck order, observes download queue shape rather than progress. Its song list is a `FlatList` with fixed rows | Keep these wins. Optimize measured large-library search, database reads and row updates; replacing the entire page with Kotlin is not the first step. |
| Luvs | `luvs/TasteExplorer.tsx:129-279` keeps its camera on shared values and mounts a bounded neighborhood; native Luvs already prepares audio | Preserve both. Memoize gesture instances, bound retained lane data/audio resources, and distinguish card GPU cost from song-resolution latency. Do not restore the retired native pager just because it exists. |
| Diagnostics | `PerformanceHUD.tsx` stops both loops when disabled; the root mounts it once | Useful exploratory signal, not a benchmark. Turn it off for final traces to avoid changing the work being measured. |
| Build | `android/gradle.properties` already enables Hermes, New Architecture, R8 and resource shrinking | These are already present. Do not list enabling them as new wins. |

Paths in this document are relative to `apps/mobile/` unless otherwise stated. Source line numbers describe the research snapshot; check symbols again before edits.

## Slice UI-0: record a reproducible baseline

Ownership: benchmark configuration and scripts only. Suggested new paths: `android/benchmark/`, `scripts/perf/`, and `.planning/performance-kotlin/evidence/`. Add a profileable benchmark variant without changing the release launch/recovery gates. Keep secrets and listener data out of logs.

Use a release-equivalent build and repeat these journeys on the same device/thermal/network conditions:

1. Cold startup and warm return to Stream, with cached data and with uncached network data.
2. Scroll a realistic long Stream feed, enter search, type rapidly, start a song, and switch tabs while loading continues.
3. Library at small, medium and large fixture sizes; scroll, filter, change sort, open a playlist, and download two songs while browsing.
4. Open/close Now Playing repeatedly for local and streamed songs. Test cover, glow, canvas and no-canvas independently.
5. Follow long mixed-height lyrics; switch provider, text size, transliteration, line/letter highlighting, seek, manual scroll and reopen.
6. Browse Luvs across/deeper lanes repeatedly, then leave and return. Observe memory after resources settle.
7. Background playback, notification skip, screen off/on, incoming audio focus loss, network loss/recovery, and Connect remote playback.

Record cold/warm TTID and usable-content time, frame timing/overrun percentiles, JS long tasks, UI/render-thread slices, CPU, native/Java/JS memory, image dimensions, decoder count, request count, and time-to-first-audio/video-frame. Use Macrobenchmark/Perfetto plus React Native profiling; distinguish cache warmth and network waits from frame jank.

Acceptance: repeatable baseline artifacts tied to commit/build/device/refresh rate and fixture. At 60 Hz the display interval is about 16.7 ms, at 120 Hz about 8.3 ms; measure frame deadline misses rather than rely on an average FPS label. Do not publish claimed percentage gains before a controlled before/after run.

## Slice UI-1: make hidden surfaces idle

2026-10-04: source slice implemented and locally checked with GPT-6 Luna xhigh workers; see [execution/debug handoff](LUNA-EXECUTION.md) and [verification](LUNA-VERIFICATION.md). Native visual and measured performance acceptance remain pending.

Files: `hooks/useVisualBudget.ts`, `utils/visualBudget.ts`, `components/NowPlayingBackground.tsx`, `components/player/GlowBackground.tsx`, `components/allegra/MusicFlowField.tsx`, `components/PerformanceHUD.tsx`; inspect `CanvasVideoLayer.tsx` and every call site before widening scope.

1. Define one visibility policy: attached + app active + route focused + surface actually shown + not covered by the active video/other full-screen surface. Playback-service activity is independent of this UI policy.
2. Feed policy to existing visual budgets and each loop. Stop frame callbacks when hidden; preserve the last frame and apply a new palette while resting.
3. Keep lyrics premounting available if measured first-open benefit justifies it, but no hidden clock, automatic scroll, waveform or per-word work. Audit `live` through the entire subtree.
4. Memoize frame callbacks and gesture objects. Use transforms/opacity and project motion tokens. Preserve reduced-motion behavior and accessible controls.
5. Stop/resume cleanly on route transitions and AppState changes; resync from actual player state at foreground return.

Verification: render-thread/worklet counters stop for hidden surfaces while native playback and notification controls continue; no wrong palette or frozen active surface after return; compare opening/toggling latency and battery/CPU before and after. Do not infer that a missing visibility guard caused every lag symptom.

## Slice UI-2: virtualize Stream and isolate changing rows

Files: `screens/StreamScreen.tsx`, `components/stream/StreamHome.tsx`, `components/browse/BrowseShelf.tsx`, relevant shelf components and `services/stream/feedCache.ts`.

1. Build a typed section model with stable IDs for header/search, account picks, keep listening, quick picks, recommendations, followed artists and browse shelves.
2. Replace the vertical all-content `ScrollView` with one virtualized section list. Keep horizontal shelf behavior; avoid nested same-direction scroll lists. Treat variable section heights honestly rather than invent a fixed `getItemLayout`.
3. Load continuation when the viewport approaches the end, coalesce duplicate continuations and reject results for a replaced chip/request generation.
4. Memoize transformed shelf items and callbacks. Let a playing/download/like row subscribe to its own state; do not send new arrays and functions to every shelf for an unrelated update.
5. Limit image prefetch to visible/near-visible items and prioritize song start above feed/cover prefetch. Keep cached content immediately available while revalidating.

Verification: long-feed mounted sections are bounded by a viewport window; rapid typing and refresh do not show old results; scroll offset, tab double-tap, quick-picks paging, refresh, account picks, downloads and every existing action behave the same. Compare request/mount counts and frame traces.

## Slice UI-3: reduce large-library and Luvs work

Files: `screens/LibraryScreen.tsx`, `store/songsStore.ts`, `database/queries.ts`, `components/library/libraryShape.ts`, `services/luvsLanes.ts`, `store/luvsLanesStore.ts`, `components/luvs/TasteExplorer.tsx`, `services/LuvsBufferManager.ts` and the Kotlin Luvs modules.

Library: measure full-library focus reads and filtering/sorting at realistic large sizes. If they exceed the interaction budget, add summary projections/indices and incremental revisions first. Use existing native search for suitable queries or a cancellable worker-backed paged query; do not duplicate the SQLite database or rewrite it to Room without a migration case. Hydrate lyrics only for the selected song. Preserve downloaded/online playlist union, exact provider-qualified identities and sync tombstones.

Luvs: keep the UI-thread camera and bounded rendered neighborhood. Stabilize gesture instances and card props. Cap retained distant lane pages with explicit restoration metadata, not an unbounded list of fully resolved songs. Bound prepared player/decoder resources and release them when leaving the surface. A lane-generation change must invalidate old resolution results. Confirm the existing native pool handoff mutes/stops the other player; no simultaneous audio owners.

Verification: search stays responsive while typing; no lost deck order, A–Z jumps, downloads, likes or offline data; repeated Luvs journeys do not monotonically grow memory/player count after settling. No “room/database moved to Kotlin” claim until actually implemented and migration-tested.

## Slice UI-4: bound image bytes and offscreen composition

Files: `player/coverImages.ts`, `player/imageCache.ts`, `player/AppleBackdrop.tsx`, `player/GlowBackground.tsx`, `NowPlayingBackground.tsx`, `CanvasVideoLayer.tsx`, `allegra/Artwork.tsx` and native `PaletteModule.kt` after tracing callers.

1. Log decoded dimensions/bytes only in diagnostic builds. A count of six source-sized images is not a byte budget.
2. Establish separate cover-thumbnail and blurred-backdrop targets; avoid decoding full source resolution for a tiny/blurred target. Compare decode approaches supported by installed Skia/Expo versions before adding a native decoder.
3. If measured memory requires it, add a byte-aware eviction policy while preserving reference ownership: never explicitly dispose an image still painted by the outgoing layer or another surface. Trim on memory pressure.
4. Cache a reduced-resolution static blur result per URI/size/style if traces show repeated blur work. Preserve the approved color, mask and transition appearance.
5. Reduce redundant live full-screen canvases/offscreen layers. A video surface, veil, glow and blurred cover should not all redraw for the same effect when one can be static.
6. Do not add live blur to the page beneath a dragged sheet or to every list card; those were already removed for performance.

Verification: rapid skips, malformed art, failed/late decoding and video quality changes never display another song's cover or a black flash; compare GPU/CPU and peak bytes; retain generated-art fallback and accessibility.

## Slice UI-5: Kotlin lyrics/video surface, only after measurement

Detailed native implementation: `NATIVE-PLAYBACK-PLAN.md`. Video identity/provider/clock constraints: `BACKEND-YOUTUBE-PLAN.md`.

Recommended boundary: a single Android native component for the high-frequency lyrics/video area, inside the current React Native navigation/sheets. Pass a versioned lyric document/style/layout snapshot on change. Native reads the existing Media3 timeline and performs line selection, word highlighting, measured row anchoring and scrolling. Send only user actions and coarse state/discontinuity reports back to JS. Keep iOS/remote-Connect fallback explicit.

The same document must support all requested modes:

- Existing upper lyrics area with lower transport controls.
- Video above a separately measured lyrics viewport.
- Full lyrics, with accessible transport/navigation affordances.

Layout changes must not replace the player, queue or source, replay audio, reset progress, create another decoder, or keep an invisible prohibited YouTube embed playing. Retarget the active line from the new measured viewport. Switching providers/lyrics generations discards stale timing and geometry atomically. Large fonts, transliteration, RTL and wrapped rows must work in every mode.

Start with the simplest native View/RecyclerView implementation that meets measured requirements; evaluate ComposeView as an alternative with proper lifecycle/disposal. Kotlin/Compose does not automatically make shaders cheaper. A full Now Playing Compose port is a later measured decision; all-app Compose/Kotlin is a distinct migration milestone with feature parity costs.

## Dependencies, rollout and rollback

Order: UI-0 -> the focused lyrics correctness fix -> UI-1 -> UI-2 / UI-3 -> UI-4 -> UI-5, choosing later work from the recorded bottleneck. Each slice is an independent reviewable change with its own before/after evidence. Fix responsiveness before adding YouTube workloads.

Keep previous renderer/player adapter available during the native-view pilot. Internal rollout selection must be consumed and tested; do not ship dead settings. Roll back the renderer without losing queue/library/schema data. Native binary changes require a new APK and launch/smoke gates; JS-only changes are not proof a released APK contains them.

Dependencies already installed: RN 0.81.5, Expo 54, Reanimated ~4.1.1, FlashList 2.2.2, Skia 2.6.4. The Reanimated docs describe optimizations needing different minimum versions: check the installed compatibility matrix before upgrades or flags. Treat upgrade experiments separately; include transformed touch-target tests and root/mobile release gates. Do not combine a framework upgrade with a renderer migration.

## Primary references

- [React Native 0.81 performance](https://reactnative.dev/docs/0.81/performance): release-mode evaluation and separating JS/UI-thread work.
- [Reanimated performance](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/): stable frame callbacks/gestures, avoiding repeated synchronous shared-value reads on JS, and version-specific optimization caveats.
- [Macrobenchmark](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview): release-equivalent journey measurement and trace artifacts.
- [Compose in Views](https://developer.android.com/develop/ui/compose/migrate/interoperability-apis/compose-in-views): embedding and disposal/lifecycle rules.
- [Baseline Profile measurement](https://developer.android.com/topic/performance/baselineprofiles/measure-baselineprofile): controlled with/without-profile comparisons.
- [GPU rendering inspection](https://developer.android.com/topic/performance/rendering/inspect-gpu-rendering): investigating rendering cost separately from networking.

These support the engineering methods. They do not establish that this app has a particular measured bottleneck or guarantee a percentage speedup.
