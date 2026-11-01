# Radio top-up and fresh stream links with the screen off: design

Item 7 of [REMAINING-WORK.md](REMAINING-WORK.md). **Status: proposed, waiting for the owner's choice.** No code until
then.

## The problem

Two things a long listening session needs still run in JavaScript:

1. **Radio top-up.** When a queue runs low, the Kotlin queue engine sends `onQueueLow`. JavaScript answers with
   `StreamService.extendRadio`: YouTube Music radio for the playing song (`services/stream/recommend.ts`), resolved
   to catalog audio (`services/ytmusic/resolver.ts`), inserted into the engine's queue with the queue's tag.
2. **Fresh stream links.** A streamed song's audio link can expire mid-queue. `PlaybackService` reports it through
   `onPlaybackError` (`expired`), and `playback/recovery.ts` searches again for a fresh link and reloads the song
   where it stopped.

With the screen off and the app in the background, both can stall. The Kotlin side keeps playing (the foreground
`PlaybackService` keeps the process alive), and JavaScript is alive too. But **React Native holds JavaScript's
timers while no activity of ours is resumed** (`JavaTimerManager.onHostPause`). Every provider call goes through
`fetchWithTimeout`, whose timeout is a `setTimeout`, and the cascades use timers too, so the work waits until the
app is opened again. The radio queue runs dry, or an expired song stops. The island hit exactly this problem;
`modules/IslandJsAwake.kt` fixed it there.

## Options

### A. Keep JavaScript awake for the job (recommended)

When the engine sends `onQueueLow`, or the service sends `onPlaybackError: expired`, the module starts the same
short headless task the island uses (`IslandJsAwake.hold`, about 20 s, renewed while work continues). Timers run,
`extendRadio` and the link refresh finish, and the engine applies the result as it does today.

- **Change:** `MainPlayerModule` calls `IslandJsAwake.hold` before it sends those two events. Move `IslandJsAwake`
  out of the island package (it becomes the player's), and let JavaScript end the hold early once the job is done.
- **Keeps:** one radio implementation (the JavaScript one the app already tests), the queue tag check, and
  `shouldRefillQueue` (never for repeat-one or Listen together). No API contract change, no new endpoint, no secrets.
- **Limit:** it needs the JavaScript runtime to exist. It does whenever `PlaybackService` is playing, because they
  share the process. If Android kills the whole process, playback stops anyway.
- **Size:** small (one module change, one JavaScript call, a JVM test for the hold's renewal rule).

### B. Kotlin asks the Allegra API for radio

`PlaybackService` calls `GET /api/radio/:songId` (already in `docs/api-contract.md`) itself and inserts the
candidates.

- **Cost:** a second radio implementation that disagrees with the phone's (the API ranks catalog suggestions; the
  phone uses YouTube Music radio, Echo's model). The API's `streamUrl` is the Allegra proxy (`/api/stream/:id`),
  so every radio song's audio would go through the Vercel function: real bandwidth cost, and the byte-range rule
  becomes a playback dependency for the phone. Needs the account token in Kotlin for personal radio.
- **Size:** medium to large.

### C. Port the radio and resolver to Kotlin

Re-implement `recommend.ts` and `resolver.ts` in Kotlin.

- **Cost:** two copies of the matching rules (covers, lofi, slowed, versions) that must stay identical, and the
  YouTube Music metadata client in Kotlin. Every matcher fix has to land twice.
- **Size:** large.

## Recommendation

**A.** It removes the actual cause (held timers) with the least code and keeps one implementation of radio and
matching. B and C both create a second implementation to maintain, and B moves audio onto Vercel.

## Done when (for A)

- With the screen off for 30 minutes on a phone, a streamed radio queue keeps refilling and an expired link is
  refreshed without the app being opened. Logcat evidence (`PerfMarks` / `diag` lines for each top-up and refresh)
  saved to `evidence/`.
- The existing queue tests, `nativeQueue` tests and `shouldRefillQueue` tests still pass; a JVM test covers the
  hold being renewed while a job runs and released after.
- No change to `docs/api-contract.md`.

## Decision needed

Owner: A, B or C?
