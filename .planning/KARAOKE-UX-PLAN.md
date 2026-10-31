# Karaoke: bugs, optimisation and UX plan

Branch: `feat/karaoke-ux` · Written 2026-10-14 · Scope: web live karaoke (`apps/web/src/lib/liveKaraoke/`,
`hooks/useLiveKaraoke.ts`, `components/KaraokeMixSheet.tsx`, the karaoke bits of `PlayerPanel.tsx`).

Goal: pressing Karaoke changes the sound **at once**. Seeking back never redoes work. A song
already separated never gets separated again. The listener can always see which parts of the
song are ready.

---

## 1. What a listener goes through today

Desktop with WebGPU, model already downloaded (numbers from `roformer/MODEL.md`):

| Moment | What happens | Wait |
| --- | --- | --- |
| First press of the page session | Read 741 MB from OPFS into memory, build the ORT session, download and decode the song, separate the first chunk | **~27 s** before the instrumental plays |
| Seek | Separator re-aims; the original plays meanwhile | ~12 s |
| Seek **back** 30 s | Usually lands on chunks that were skipped and are only filled in at the end of the song (see B3) | another ~12 s, the "it processes again" report |
| Next or previous track | Karaoke turns **off**. All separated audio is thrown away | press again, ~10–15 s |
| Phone, or a browser without WebGPU | Downloads 741 MB, runs two chunks at 15–40 s each, then falls back to mid-side and **reloads the audio source** | 40 s+ and a stall |

On top of that, nothing on screen says the vocals came back after a seek: the status still reads
"On-device AI vocal removal".

---

## 2. Findings

### Bugs

| # | Issue | Where | Effect |
| --- | --- | --- | --- |
| B1 | Can't cancel while preparing. `toggle()` returns early while `busy`, and the button is `aria-disabled` | `useLiveKaraoke.ts:312`, `PlayerPanel.tsx:593,632` | Pressed by accident → stuck for 27 s, or for the whole 741 MB download |
| B2 | Only the gain of readiness is reported. `checkReady` fires when the playhead reaches separated audio and never when it leaves, so the hook keeps `status: 'active'` while the original (with vocals) plays | `streamSession.ts:226-230`, `PlayerPanel.tsx:1002` | Vocals come back after a seek with no explanation. This is the missing loader the user asked for |
| B3 | Seeking back lands on gaps. The first chunk aims ahead of the playhead (`catchUpChunk`), and after that the worker goes forward to the end and only then wraps to chunk 0. Chunks between the start point and the first aimed chunk, and everything before it, wait until the end of the song. Starting at 0:00 while playing skips chunk 0 | `chunks.ts:34-40`, `streamSession.ts:212-218`, `separatorWorker.ts:67-71` | The "30 s back processes again" report. It isn't a lost cache; that audio was never separated |
| B4 | A track change throws everything away: the stream is disposed, karaoke switches off, and going back means downloading, decoding and separating again | `useLiveKaraoke.ts:142-165` | No cache between songs. Karaoke has to be pressed again for every song |
| B5 | Devices that can't keep up still download the model. The only gate is `isRoformerLikelySupported()` (Worker + fetch). No WebGPU check, no device-memory check, and `modelTooSlow` only lasts for the page session | `pcm.ts:32-34`, `useLiveKaraoke.ts:63,348` | Phones and Firefox pull 741 MB and then fall back. The model author's own numbers: S24 Ultra 15.9 s per 11 s chunk, OnePlus 9RT 42.6 s |
| B6 | Falling back mid-song swaps `audio.src` (pause, `load()`, buffering) | `useLiveKaraoke.ts:207`, `useAudioPlayer.ts:284-300` | Audible stall exactly when the user is already annoyed by the wait |
| B7 | A model download can't be stopped. No signal reaches the worker (`warm`, `getSession`), and there is no cancel message | `separatorWorker.ts:148`, `separate.ts:47` | A 741 MB download keeps going after the user gives up |
| B8 | Every drift re-lock leaves a gap: `halt()` cuts wet to 0 at once and the new chain starts `LEAD_SECONDS` (30 ms) later, with dry already at 0 | `streamPlayer.ts:168-194,268-273` | Short dropout or click each time the clocks drift more than 120 ms. Likely part of the "lag". Count re-locks to confirm |

### Performance and memory

| # | Issue | Where | Fix direction |
| --- | --- | --- | --- |
| P1 | Model download buffers every piece and then copies them into one array: about 1.5 GB peak in the worker. It can't resume, and it hashes 741 MB in one go | `modelCache.ts:76-105,190-212` | Stream straight into OPFS (`createWritable`), resume with `Range`, hash incrementally |
| P2 | Each page session reads the 741 MB file into the JS heap (`file.arrayBuffer()`) before ORT copies it again | `modelCache.ts:24-33,155-170` | Give ORT a blob URL from the OPFS `File` so there is no JS-heap copy. Measure the peak before and after |
| P3 | Session build (~18 s) only starts on the first press | `useLiveKaraoke.ts:348-351` | Warm up in idle time for listeners who use karaoke on a capable device (opt-out in Settings) |
| P4 | `topUp()` makes new `AudioBuffer`s (a copy of 2 stems × 10 s) every time it schedules, including each seek, play and re-lock | `streamPlayer.ts:216-221` | Build each segment's `AudioBuffer`s once, when the chunk arrives, and store those instead of `Float32Array`s |
| P5 | Memory per song: both stems as float32, ~170 MB for 4 min, plus the worker's copy of the mix (~85 MB) until the song is done | `streamSession.ts:58-64` | Int16 or Opus in the cache tier (§4 Phase 2). Keep float only for the segments near the playhead |
| P6 | The worker can't drop a chunk already running. After a track change the new song waits for the old song's chunk (up to ~6.5 s) | `separatorWorker.ts:106,115` | Prefetch the next song (Phase 3), so the wait never lands on the listener |
| P7 | The song is downloaded twice: once by `<audio>`, once in full by `fetchAndDecodeSong` | `streamFetch.ts:52` | Once every chunk of a song is cached, skip the fetch completely (stems sum to the mix) |
| P8 | Dead code: `LiveKaraokePlayer.ts`, `scnetWorker.ts`, `scnetWorker.client.ts`, `statusAfterPrepare`, `LiveKaraokeStream.processed`. The README still calls mid-side the default and SCNet the next step | `lib/liveKaraoke/` | Delete, and rewrite the README |

### UX and accessibility

| # | Issue |
| --- | --- |
| U1 | "Preparing 34%" doesn't say what is happening. Song download jumps 0 → 10 %, the model fills 10–90 %, then it **sits at 90 %** for the whole first chunk (6–25 s) |
| U2 | The first press quietly starts a 741 MB download. No size, no "Wi-Fi recommended", `saveData` ignored |
| U3 | Nothing shows which parts of the song are ready. The seek bar looks the same separated or not |
| U4 | No announcement for screen readers when karaoke becomes ready, falls back, or loses readiness. Only errors use `role=alert` |
| U5 | Double-tap to open the mix is hidden, and the double-tap delay makes switching karaoke **off** feel slow (300 ms) |
| U6 | The fallback note blames the GPU ("couldn't run on this device") even when the real reason is "too slow" or "not on Wi-Fi". The copy should match the reason |

---

## 3. Target experience

1. **Instant**: a press reduces the vocals within 100 ms, using live mid-side in the Web Audio graph,
   then switches to AI stems one segment at a time as they arrive. No source swap, no silence.
2. **Never twice**: separated chunks are cached in memory for recent songs and in OPFS across visits.
   A cached song costs no network and no GPU.
3. **Visible**: the seek bar shows AI-ready stretches in the accent colour, the chunk being worked
   on as a soft shimmer, and the rest plain. A small chip reads "Catching up · ~6 s" while the
   playhead is in a stretch that isn't ready.
4. **Honest about the device**: phones and browsers without WebGPU get Basic (or a smaller model)
   straight away, without the 741 MB download. The verdict is remembered.
5. **Sticky**: karaoke stays on from song to song, and the next song's opening is separated before it starts.

---

## 4. Plan

Each phase ships on its own, behind tests, keeping the three playback invariants and the
"karaoke stays in the browser" rule. No server work.

### Phase 0: Quick fixes (low risk, high return)

1. **Cancel while preparing** (B1, B7). `toggle()` while busy aborts: abort the song fetch, `cancel`
   the job, and send the worker a new `abort-download` message that stops the model fetch at its next
   read. The button stays clickable during preparation and reads "Cancel" to screen readers.
2. **Report readiness both ways** (B2). Replace `onReadyAtPlayhead` with
   `onReadinessChange(ready: boolean)`. The hook gets a new status, `'catching-up'` (karaoke on,
   playhead not separated yet), shown as its own status line and later as the chip.
3. **Backfill behind the playhead** (B3). Pull the chunk order out of the worker into a pure
   `nextChunk(done, focus, playheadChunk)` in `chunks.ts`, ordered like this:
   1. the focus chunk and the next one (staying ahead)
   2. up to 3 chunks behind the playhead, nearest first (covers "30 s back")
   3. forward to the end
   4. whatever is left, from the playhead backwards

   Unit-test the order. Once the instrumental is playing, the gap left by `catchUpChunk` gets filled next.
4. **Gate the model on the device** (B5). Before downloading, require `navigator.gpu.requestAdapter()`
   to return an adapter, and `navigator.deviceMemory` ≥ 4 where it is reported. Store the verdict
   (`too-slow` / `ok`, keyed by model SHA and UA) in localStorage so a phone measured once never
   downloads again. Settings gets a "Try the AI model anyway" escape hatch.
5. **Reuse `AudioBuffer`s** (P4), and make re-locks smooth (B8): schedule the new chain first and then
   crossfade over `RAMP_SECONDS`, rather than halt-then-start. Require 2 drifting ticks in a row before a re-lock.
6. **Delete dead code and rewrite the README** (P8).

Done when: cancel works at every stage, seeking back 30 s after 40 s of karaoke plays the instrumental
straight away, a phone never fetches `*.onnx.data`, and re-lock count is logged in dev.

### Phase 1: Instant karaoke with a live mid-side bridge (B6, the "no wait" part)

- Add a bridge path to `ElementGraph` (`lib/audioGraph.ts`): `source → splitter → M/S matrix
  (gain nodes) → mid: low-shelf keep < 200 Hz + band duck + air keep; side × 1.22 → merger → bridge
  gain → bus`. Same DSP as `midSideVocalRemove.ts`, but as live nodes, so there is no render, no
  blob and no `swapAudioSource`.
- The stream player crossfades three sources: **dry** (karaoke off) → **bridge** (on, segment not
  ready) → **wet stems** (segment ready). At every boundary `wet + bridge + dry` ramps over
  `RAMP_SECONDS`, using only gain automation.
- Fallback becomes "keep the bridge on and stop the separator". No source swap, so B6 is gone.
  `prepareMidSideKaraoke` and the WAV worker are kept only for browsers without Web Audio,
  or deleted if none are left.
- Mono sources: the bridge does nothing useful, so show the existing mono note at once rather than after processing.
- The mix sliders apply to stems only. While the bridge plays, the sheet says "AI mix starts at 1:20".

Done when: time from press to vocals reduced is under 100 ms (measured from the click handler
to the bridge gain reaching 1), with no change to the `<audio>` `src`.

### Phase 2: A cache that remembers (B4, P5, P7)

**2a, in memory (recent songs).** Song changes stop calling `dispose()`. Instead `disable()`
moves the stream into an LRU keyed by `songId`, sized by `deviceMemory`: 1 song under 4 GB,
2 under 8 GB, 3 above. The worker job is paused and kept for the current song only. Stored
songs keep their segments; the worker's mix copy is dropped. "Previous track" then "Karaoke"
is instant.

**2b, on disk (across visits).** `roformer/stemCache.ts` in OPFS:

- Directory `allegra-stems-v1/<modelSha8>-L<layoutVersion>/<songId>/`, one file per chunk
  (`<k>.bin`) plus `meta.json` (sample count, chunk count, `residualPass`, `createdAt`, `lastPlayed`).
  The key includes the model SHA and a layout version, so changing the separator or chunk layout
  invalidates the cache. This follows the repo rule "changed a scorer → bump its cache key".
- Format: Opus at ~192 kbps through WebCodecs `AudioEncoder` where available (~6 MB per stem for a
  4-minute song), int16 PCM otherwise (~42 MB per stem). Encode in the separator worker after each chunk, off the main thread.
- When karaoke starts: read `meta.json`, load the cached chunks into segments, and send the worker a
  `done` bitmap with the job so it skips them. If **every** chunk is cached, skip the song download
  and decode completely.
- Size cap: 1 GB by default, least recently played evicted first. Settings shows "Karaoke cache · 312 MB · Clear",
  next to the model row that is already there.
- Nothing leaves the device. This is local storage only, so the architecture rule holds.

Done when: replaying a separated song after a reload gives the instrumental in < 1 s with no
`/api/stream` request and no `session.run`, and old cache directories are deleted after a model change.

### Phase 3: Karaoke that stays on, with next-song prefetch

- Song change with karaoke on: keep the karaoke intent (new setting "Keep Karaoke on between songs",
  default on) and start the new song in bridge mode straight away.
- The worker gets a two-level queue: current song first, next song after. Once the current song has
  ≥ 3 chunks ready ahead of the playhead, or is fully done, fetch and decode the next song in the queue
  and separate its first 2 chunks (or catch-up chunks, if crossfade/shuffle predicts a start point).
  Results go into the 2a/2b caches.
- Cancel the prefetch on queue edits, shuffle or a manual skip. Use the queue `useAudioPlayer` already
  exposes; don't add a second source of truth.

Done when: with karaoke on, a natural track change plays the next song's instrumental from 0:00 with no original-vocal gap.

### Phase 4: Loader, colours and accessibility (U1–U6)

Visual direction follows our design taste: clear frosted glass, no dark veils, soft glows, icon-only controls.

- **Coverage on the seek bar** (`PlayerPanel.tsx` `.progress-range`, `PlayheadViews.tsx` `.am-scrub`):
  a thin layer under the track built from a stepped `linear-gradient`. AI-ready stretches use
  `--accent` at 55 %, the chunk being separated gets a soft shimmer (a `transform: translateX` sweep;
  static under reduced motion), and bridge-only stretches use a faint neutral. It updates on chunk
  events, not every frame. Exposed through `LiveKaraokeController.coverage: readonly number[]`
  (ready chunk indices) and `working: number | null`.
- **Staged loader** in place of a single percentage:
  `Downloading AI model · 312 / 741 MB` → `Loading model…` → `Separating your spot · ~6 s` →
  on. The ETA comes from the smoothed `chunkMs` that `streamSession` already tracks. The button keeps a
  progress ring (`transform: rotate` / opacity only) and gives the stage in `aria-valuetext`.
- **"Catching up" chip** next to the Karaoke button while `status === 'catching-up'`:
  "Vocals back for ~6 s · AI catching up". It disappears with an opacity fade when ready.
- **First-download sheet** (U2): one time, "Use the on-device AI model? 741 MB, kept in this browser.
  Wi-Fi recommended." Buttons: [Download] [Use Basic]. Skipped when `saveData` is on (default Basic).
  Basic (bridge) plays while it downloads, so the press still does something at once.
- **Announcements** (U4): one polite live region per player saying "Karaoke on", "AI vocals
  removed", "Catching up", "Basic mode: <reason>". Milestones only, never the percentage.
- **Mix discoverability** (U5): show the sliders button whenever karaoke is on, as today, and the
  first time karaoke turns on show a single "Double-tap for the mix" hint. Shorten the off-tap
  wait: wait only when the mix sheet has never been opened.
- **Fallback copy** (U6): one message per reason (too slow, no WebGPU, basic chosen, saveData,
  download failed), each with a matching action ("Try again on Wi-Fi", "Open Settings").
- All motion through `motionTokens`. Reduced motion collapses the shimmer and ring to opacity, and every feature still works.

Check at 360 / 768 / 1280 / 1920, light and dark.

### Phase 5: The model itself

1. **Streamed, resumable download** (P1): `fetch` → `TransformStream` (incremental SHA-256 via a
   small WASM hasher such as `hash-wasm`) → OPFS `createWritable`. Resume with `Range: bytes=<have>-`
   against the pinned commit URL. Progress reports real bytes for the staged loader.
2. **No heap copy** (P2): give ORT `URL.createObjectURL(opfsFile)` for the graph and external data.
   Measure `performance.measureUserAgentSpecificMemory()` before and after.
3. **Idle warm-up** (P3): after the first played song, if the model is cached, the device verdict is
   `ok` and the user has used karaoke before, `requestIdleCallback` → `getSeparator().warm()`.
   Then the first press costs only the first chunk (~6.5 s, covered by the bridge).
4. **Smaller tier for phones (spike, decision gate)**: the current model is fp16 Mel-Band RoFormer
   "Big" (741 MB), never real-time on phones. Evaluate 2–3 smaller vocal models exported to ONNX
   (for example a small Mel/BS-RoFormer or SCNet; the README already names an SCNet ONNX at ~47 MB)
   against 4 criteria: ms per 10 s chunk on an Adreno 7xx phone and on a laptop iGPU, download size,
   vocal bleed on 10 reference songs, and license. Ship as `karaokeQuality: 'auto' | 'high' | 'light'`,
   where `auto` picks from the device verdict.
5. **Faster first audio (research)**: a second export with a shorter window (for example T=548 ≈ 5.5 s)
   only for the first chunk after a press or seek. That would halve time-to-first-AI. Check whether
   both graphs can share one external-data file before committing to it.
6. Keep STFT/iSTFT on the CPU in the worker (0.5 s of 6.5 s). Not worth moving until the model
   itself gets faster.

---

## 5. Measuring it

Dev-only logger events (no `console.log` in production paths): `karaoke.press`,
`karaoke.bridge_on`, `karaoke.ai_ready` (ms since press), `karaoke.seek_recover` (ms),
`karaoke.relock`, `karaoke.chunk` (ms, cached/separated), `karaoke.fallback` (reason),
`karaoke.cache_hit` (ratio).

| Metric | Today | Target |
| --- | --- | --- |
| Press → vocals reduced | ~27 s cold / ~10 s warm | < 0.1 s (bridge) |
| Press → AI stems, model cached, warmed | ~10 s | ≤ 7 s (≤ 4 s with a short first window) |
| Seek back 30 s → AI stems | ~12 s | 0 s |
| Replay of a separated song after reload | full redo | < 1 s, 0 network, 0 GPU |
| Chunks separated twice per session | possible | 0 |
| Phone downloads of the 741 MB model | every visit until it falls back | 0 unless opted in |
| Peak worker memory during download | ~1.5 GB | < 100 MB above the model |

## 6. Tests

Per our rule, every fix ships a regression test, and features get a full local e2e before merge.

- Unit: `nextChunk` ordering (backfill, wrap, all done); `catchUpChunk` edge cases already covered,
  extend for the start-at-0 case; `stemCache` key and versioning, LRU eviction, partial-hit bitmap;
  device-verdict storage; readiness events in both directions (`LiveKaraokeStream` with a fake
  `HTMLAudioElement` and a fake separator).
- Hook: `useLiveKaraoke` cancel during each stage; song change keeps intent and moves the stream to the LRU.
- E2E (Playwright, on :5173, never :8080 because of CSP): a fake separator worker behind a dev flag
  returns a known instrumental at once, so CI needs no 741 MB model. Cover: toggle, seek back 30 s
  (no new chunk request), next/prev track (cache hit), cancel during preparation, and playback
  survives route changes with karaoke on.
- Manual: real phone (Phase 0 gate, Phase 4 loader), and desktop WebGPU timings filled into the table above.

## 7. Decisions needed from you

1. **Disk cache size and format**: 1 GB default with Opus (smaller, slight quality loss on the vocal
   stem) or int16 (exact, ~7× larger)? Suggestion: Opus, with int16 where WebCodecs is missing.
2. **Keep karaoke on between songs** as the default? Suggestion: yes.
3. **Phones**: Basic-only for now, or fund the Phase 5.4 smaller-model spike?
4. **Consent sheet before the 741 MB download**: always, or only on cellular / `saveData`?
   Suggestion: always on first use. It's a big download.

Suggested order: Phase 0 → 1 → 2a → 4 (loader + coverage) → 2b → 3 → 5. Phases 0 + 1 alone remove
the wait people notice, and 2a + Phase 0's backfill fix the "processes again" report.
