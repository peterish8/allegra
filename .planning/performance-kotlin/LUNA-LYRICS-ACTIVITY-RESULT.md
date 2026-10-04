# UI-1 lyrics activity result

## Change

`NowPlayingLyricsArea` now enables the existing `SynchronizedLyrics.live` policy only when lyrics are requested, the Now Playing route is focused, and the app is active. Both the local player and Connect remote player render this shared component under the Now Playing route. The subtree remains mounted once created, preserving lyric state and the existing open animation; its existing live gates stop lyric clock/follow/glide, word sweep, and instrumental waveform activity while hidden.

The 900 ms hidden premount still runs for the visible route. It now waits for route focus and app activity, and its existing effect cleanup cancels the delay/interaction task when either visibility input turns off. Explicitly opening lyrics still mounts immediately.

## Scope and preservation

- Changed by this task: `apps/mobile/src/components/NowPlayingLyricsArea.tsx`.
- Shared dependency supplied by the visibility worker: `apps/mobile/src/hooks/useAppActive.ts` (and its `useAppActive.test.ts`).
- Local and Connect call sites were traced; neither required a prop or contract change.
- Left `SynchronizedLyrics.tsx`, `playback/lyricLayout.ts`, and `playback/lyricLayout.test.ts` untouched; their concurrent geometry work remains intact.
- No playback-store, requestPlayback, queue, or native audio behavior changed.

## Validation

- Focused ESLint on `src/components/NowPlayingLyricsArea.tsx`: passed.
- Jest lyric/worklet checks (`workletSafety`, `lyricLayout`, `lyricClock`, `lyricMotion`): 4 suites, 26 tests passed.
- Jest `useAppActive.test.ts`: 1 suite, 3 tests passed.
- `git diff --check`: passed; only CRLF normalization warnings were emitted for shared dirty files.
- Graft wiring graph rebuilt for 437 indexed mobile files and checked current; 2,860 nodes and 7,122 edges.
- Graft `grep "live="` found the updated handoff. Graft's `callers` graph had no indexed incoming references for the component, so raw `rg` was used to confirm both consumers.
- Graft savings reported by the two query calls: approximately 4,553 + 4,590 = 9,143 tokens. `graft stats` reported 0 tracked retrieval reads / 0 estimated tokens saved for the session, so the query estimates are reported separately.
- Root's integrated mobile suite passed: 86 suites / 726 tests; root typecheck and lint passed.

No phone or emulator was connected, so this is source and test verification, not device/frame-counter evidence or a measured performance gain.
