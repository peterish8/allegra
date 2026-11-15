# P3-1 Stream proxy: resume an upstream body that breaks mid-response

Draft id: P1-1. Demoted to P3 and gated on evidence: browsers and ExoPlayer already retry a broken body with a new
Range request, so a server-side resume saves one round trip at best. Build only when P2-1's logs show the failure is
frequent. Branch: `feat/stream-midbody-resume`. API only. No contract change (the response a client sees is the same
bytes). No version bumps.

## 1. Goal and user-visible outcome

When the CDN connection behind `/api/stream/:songId` drops partway through a response, the API fetches the missing bytes
from where it stopped and keeps writing the same response, so the listener's player never sees the break. If resuming is
not safe (different file, no length, too late in the function's life), the API ends the response exactly as today.

Non-goals: changing statuses or headers sent to the client; resuming multi-range (`multipart/byteranges`) responses;
extending the Vercel function's maximum duration; caching audio on the server.

## 2. Evidence

| Fact | Where |
| --- | --- |
| After headers, a body error calls `upstream.abort()` and `response.destroy()`; no resume | `apps/api/src/lib/streamResolver.ts:76-95` |
| Header deadline 25 s; no deadline on body reads (`fetchUntilHeaders` clears its timer at headers) | `streamResolver.ts:14`, `apps/api/src/lib/fetchWithTimeout.ts:15-40` |
| Pass-through statuses 200/206/416 and headers `content-type, content-length, content-range, accept-ranges, etag, last-modified` | `streamResolver.ts:15,58-64` |
| Byte-range rule: never collapse 206 to 200 | `CLAUDE.md`, `docs/api-contract.md:363-373` |

External facts (accessed 2026-11-13):
- Undici (Node fetch) surfaces a mid-body socket close as `TypeError: terminated` with `cause.code === 'UND_ERR_SOCKET'`
  ("other side closed"); body timeouts as `UND_ERR_BODY_TIMEOUT`.
  https://stackoverflow.com/questions/76931498/typeerror-terminated-cause-socketerror-other-side-closed-in-fetch-nodejs ,
  https://github.com/vercel/workflow/issues/5055
- Chrome's media loader retries failed loads (`kLoaderFailedRetryDelayMs = 250`, plus 50 ms per retry, about 29 s total)
  and retries short responses from the point it reached with a Range request.
  https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/media/resource_multi_buffer_data_provider.cc
- Vercel Functions: Hobby default and max duration 300 s; Pro default 300 s, max 800 s; the 4.5 MB response limit does
  not apply to streamed responses. https://vercel.com/docs/functions/limitations ,
  https://vercel.com/docs/functions/configuring-functions/duration
- HTTP range semantics: a 206 carries `Content-Range: bytes first-last/complete-length` (last inclusive, length may be
  `*`); 416 when unsatisfiable. RFC 9110 sections 14.4 and 15.3.7, https://www.rfc-editor.org/rfc/rfc9110 (not re-fetched;
  standard text).

Behavioural reference: `Echo-Music/playback/src/main/kotlin/echo/music/iad1tya/playback/ChunkingDataSource.kt` (reopen at
`position + bytesRead`, bounded retries, a 416 at the end is a clean end). Same idea on the server side here.

## 3. Design decisions

| Decision | Rationale |
| --- | --- |
| Evidence gate: P2-1 must show at least 20 `stream body failed` lines with `headersSent: true` per week on production, or a reproduced listener report | Without it this is complexity for a case clients already handle |
| Resume only when the original upstream window is known exactly: 206 with a parseable single `Content-Range`, or 200 with `Content-Length` | Otherwise the missing range cannot be named |
| At most 2 resumes per response; only while the function has been running < 240 s | Leaves 60 s before the 300 s Hobby ceiling |
| The resumed response must be 206 whose `Content-Range` starts exactly at `start + sent`, ends at the same `end`, has the same total, and the same `ETag` (or same `Last-Modified`) when the first response had one | Guarantees the spliced bytes belong to the same file |
| Same URL first; on 403/404 one forced refresh via `resolve(songId, true)`, then the same validation | Signed links can expire mid-song; validation stops a different file sneaking in |
| A manual read/write pump replaces `.pipe()`: read a chunk, `response.write`, await `drain` when it returns false | Needed to splice sources; keeps backpressure |
| Upstream idle timeout 20 s per read (only while we are waiting on upstream, never while waiting on the client) | A stalled CDN becomes an error we can resume |
| Client disconnect (`response` 'close' before finish) aborts upstream and never resumes | Existing behaviour |

Rejected: buffering the whole file in the function (memory, latency); converting to chunked encoding (changes headers
the browser relies on).

## 4. Exact change list

### 4.1 Create `apps/api/src/lib/rangeWindow.ts` (pure)

```ts
export interface RangeWindow {
  readonly start: number;          // first byte index of this response in the file
  readonly end: number;            // last byte index, inclusive
  readonly total: number | null;   // complete length, null when '*'
  readonly validator: string | null; // ETag, else Last-Modified, else null
}

/** The byte window a 200/206 response covers, or null when it cannot be resumed. */
export function windowOf(status: number, headers: Headers): RangeWindow | null;

/** Range header asking for what is left after [sent] bytes, or null when nothing is left. */
export function resumeRange(window: RangeWindow, sent: number): string | null;

/** Whether a resumed upstream response continues [window] exactly after [sent] bytes. */
export function continuesWindow(window: RangeWindow, sent: number, status: number, headers: Headers): boolean;
```

Rules:
- `windowOf(206)`: parse `content-range` with `/^bytes (\d+)-(\d+)\/(\d+|\*)$/`; `content-type` starting
  `multipart/byteranges` -> null. `windowOf(200)`: `content-length` integer >= 1 -> `{ start: 0, end: len - 1, total: len }`;
  missing -> null. Other statuses -> null. Validator: `etag` header, else `last-modified`, else null.
- `resumeRange`: `next = window.start + sent`; if `next > window.end` -> null; else `bytes=${next}-${window.end}`.
- `continuesWindow`: status must be 206; parsed range start === `window.start + sent`, end === `window.end`; totals equal
  when both numeric; validator equal when the window has one (compare `etag` to `etag` or `last-modified` to `last-modified`).

Worked examples (test vectors):
1. Request `Range: bytes=1000-`; upstream 206 `Content-Range: bytes 1000-9999/10000`, `Content-Length: 9000`.
   `windowOf` -> {1000, 9999, 10000}. After 4000 bytes: `resumeRange` -> `bytes=5000-9999` (5000 = 1000 + 4000; remaining
   length 9999 - 5000 + 1 = 5000 = 9000 - 4000, consistent). Resumed `bytes 5000-9999/10000` -> continues.
   Resumed `bytes 5000-9999/12000` -> rejected (different total).
2. No request Range; upstream 200, `Content-Length: 10000`. `windowOf` -> {0, 9999, 10000}. After 3000: `bytes=3000-9999`.
   A resumed 200 -> rejected (must be 206).
3. Request `Range: bytes=-500`; upstream 206 `bytes 9500-9999/10000`; after 100 -> `bytes=9600-9999`.
4. After 9000 of example 1 (all sent) -> `resumeRange` null: nothing to do, end normally.
5. `bytes 0-0/*` -> window {0, 0, null}; after 0 sent -> `bytes=0-0`.

### 4.2 Modify `apps/api/src/lib/streamResolver.ts` (`pipe`, lines 71-95)

```
const startedAt = Date.now()
window = windowOf(upstream.status, upstream.headers)
sent = 0; resumes = 0; current = upstream
response.on('close', () => { if (!response.writableFinished) current.abort() })        // unchanged intent
loop:
  try:
     for await chunk of readWithIdleTimeout(current.body, 20_000):
        if (response.destroyed) return
        sent += chunk.byteLength
        if (!response.write(chunk)) await onceDrainOrClose(response)
     response.end(); return
  catch error:
     current.abort()
     if (response.destroyed) return                                         // the client left
     if (!response.headersSent) { existing JSON 502 path; return }           // unchanged
     canResume = window && resumes < 2 && Date.now() - startedAt < 240_000 && isUpstreamBodyError(error)
     range = canResume ? resumeRange(window, sent) : null
     if (range === null) { log.warn(... 'stream body failed', sentBytes: sent); response.destroy(); return }
     next = await fetchResolved(songId, range, false)   // then on 403/404: fetchResolved(songId, range, true)
     if (!continuesWindow(window, sent, next.status, next.headers)) { next.abort(); log.warn(...'stream resume rejected'); response.destroy(); return }
     resumes += 1; current = next; log.warn(... 'stream resumed', sentBytes: sent, resumes)
     continue loop
```

`isUpstreamBodyError(error)`: `errorShape(error)` (P2-1) has `code` in `{ 'UND_ERR_SOCKET', 'UND_ERR_BODY_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT' }`
or `name === 'TypeError'` with message `'terminated'`, or our own idle timeout error (`StreamIdleTimeoutError`).
`readWithIdleTimeout(body, ms)`: async generator over `body.getReader()`; each `read()` raced with a timer; on timeout
`reader.cancel()` and throw `StreamIdleTimeoutError`. Release the reader lock in `finally`.

Headers are written once from the first upstream response (unchanged code above line 71). The resumed response's headers
are never copied.

## 5. Implementation order

0. Check the evidence gate (`vercel logs` search for `stream body failed` with `headersSent":true`). Record counts here.
1. `rangeWindow.ts` + tests. Verify `cd apps/api && node --import tsx --test src/lib/rangeWindow.test.ts`.
2. Pump + resume in `streamResolver.ts` + tests. Verify `src/lib/streamResolver.test.ts`.
3. Root gates. Then prove the Range rule (`docs/workflows.md` "proving the Range rule") on a preview.

## 6. Edge cases

| Input / state | Behaviour |
| --- | --- |
| Client seeks (aborts) during a resume fetch | `response` closed -> abort the resume fetch, stop |
| Resume after 241 s | Not attempted; destroy (client retries itself) |
| Upstream returns 200 to the resume | Rejected; destroy |
| ETag differs | Rejected |
| 416 on resume (sent already reached the end) | Cannot happen (resumeRange null first); if it does, treat as rejected |
| Two failures already resumed | Third failure: destroy |
| Upstream without Content-Length on 200 | No window; behaves as today |
| Backpressure from a slow client | `drain` wait does not count toward the idle timeout |

## 7. Test plan

`apps/api/src/lib/rangeWindow.test.ts`: the five worked examples, `multipart responses are not resumable`,
`missing content-length on 200 is not resumable`, `etag mismatch is rejected`, `last-modified used when no etag`.

`apps/api/src/lib/streamResolver.test.ts` add (use a `ReadableStream` that enqueues N bytes then `controller.error(Object.assign(new TypeError('terminated'), { cause: { code: 'UND_ERR_SOCKET' } }))`):
- `a body that breaks after headers is resumed with the exact remaining range` (assert the second CDN request's Range
  header equals `bytes=5000-9999` for example 1 and the client receives all 9000 bytes in order).
- `a resumed response for another file ends the response` (different total).
- `no more than two resumes`.
- `client close stops without resuming`.
- Existing: `Range requests preserve 206...`, `no Range request returns 200`, `403 causes exactly one forced URL refresh`.

## 8. Security, privacy and cost

No new data. Each resume is one extra CDN request (and possibly one provider lookup). Function time grows only by the
resume latency and is capped at 240 s of age.

## 9. Rollout and rollback

Optional env kill switch `STREAM_RESUME=off` (read in `services.ts`, passed as `resume: false` to `StreamResolver`;
default on once merged). Evidence after deploy: `stream resumed` lines in `vercel logs`, and a browser seek test showing
206 responses unchanged.

## 10. Acceptance checklist

- [ ] Evidence gate recorded.
- [ ] Status and headers sent to the client are byte-identical to today's for every case.
- [ ] Resume Range arithmetic matches the vectors (inclusive end, `start + sent`).
- [ ] Backpressure respected; no unbounded buffering.
- [ ] Byte-range rule proven on a preview after merge.

Common mistakes: computing the resume start from the client's Range instead of the upstream `Content-Range`; off-by-one
on the inclusive end; resuming after the client left; copying the resumed response's headers.

## 11. Open questions (defaults)

1. Build at all? Default: only if the gate passes.
2. Raise `maxDuration`? Default: no (Hobby caps at 300 s; Pro could go to 800 s but a 5-minute song should never need it).
