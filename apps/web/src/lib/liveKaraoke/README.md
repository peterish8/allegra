# Browser live karaoke

Vocal removal that runs entirely on the listener's device. No server job, no uploaded audio.

## What a press does

1. **Bridge, instantly** (`bridge.ts`). The `<audio>` element's Web Audio graph switches to a
   live mid-side remover: one-pole IIR filters duck the centre (vocals) above the bass and keep
   the sides. It sounds within the click and detects mono songs with analysers.
2. **Device gate** (`device.ts`). `aiBlock()` decides before any download: no worker, no WebGPU
   adapter, phone or tablet, under 4 GB memory, Data Saver, or a stored "too slow" verdict keep
   the bridge. Settings → "Always AI" skips every guess except the worker.
3. **Consent.** The first AI use asks before the one-time ~752 MB model download.
4. **AI stream** (`streamSession.ts`, `streamPlayer.ts`, `roformer/`). The worker separates
   ~11 s chunks ahead of the playhead; ready segments replace the bridge as they land, and
   anywhere not separated yet keeps the bridge. The element stays the clock and keeps its `src`.

## Never wait twice

- **Order** (`roformer/chunks.ts` `nextChunk`): the lead ahead of the playhead first, then
  three chunks behind it (so seeking back plays separated audio), then forward, then the rest.
- **Stem cache** (`roformer/stemCache.ts`): every separated chunk is written to OPFS as Opus
  (WebCodecs; int16 when Opus is unavailable), keyed by model, layout and hop. 1 GB cap,
  least-recently-played songs go first. A saved chunk under the playhead is served first,
  so karaoke on a song heard before is on in about a second, without the model.
- **Parked streams**: the previous song's segments stay in memory; going back is instant.
- **Prefetch**: once the current song is nearly separated, the next song's opening is too.
- **Warm-up**: listeners who used karaoke recently get the model loaded in idle time.

## Pace verdict

The first two separated chunks are timed. Slower than playback falls back to the bridge for
that song. The verdict is stored per device and model, with two rules: a chunk that ran while
the tab was hidden is not timed (the browser throttles it), and one slow run after an "ok"
only clears the verdict, so a busy GPU once never locks a capable device out.

## UI

- The seek bar tints the separated stretches (`--karaoke-coverage`, built by
  `lib/karaokeView.ts`), so the listener sees where AI karaoke is ready.
- The button and status say what karaoke is waiting on (download, starting, separating with
  an ETA, catching up after a seek), never a bare percentage. Changes are announced politely.
- Settings shows the cached size with a Clear button, and "Try AI again" after a too-slow verdict.

## Without Web Audio

`prepareMidSideKaraoke` renders a bass-preserving mid-side instrumental in a worker and the
player swaps that blob in. Limits: prefers same-origin `/api/stream/:songId`, refuses downloads
over ~40 MB or audio over 8 minutes. Mid-side only helps stereo; mono shows a warning.

## Model

See [roformer/MODEL.md](./roformer/MODEL.md).
