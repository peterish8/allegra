# P2-1 Structured diagnostics: correlation ids, redaction, timed operations

Draft id: P2-9. Priority: P2, but land it early: P1-3, P2-2, P2-5 and P3-1 log through it. Branch:
`chore/api-diagnostics`. API only; no contract change, no version bump.

## 1. Goal and user-visible outcome

When a listener reports "this song won't play" or "my scrobbles stopped", `vercel logs` shows one line per failed step
of that request, tied together by one id, with enough detail to tell an expired CDN link from a provider outage, and
never a token, cookie, signed URL or session key. Listeners see nothing.

Non-goals: Sentry or tracing SDKs on the API; log shipping; metrics dashboards; changing access-log fields; logging
successful stream requests (volume).

## 2. Evidence

| Fact | Where |
| --- | --- |
| pino logger with header redaction; request serializer keeps only method, path (no query), id, remote address | `apps/api/src/lib/logger.ts:1-41` |
| Request logging only in production (`enableRequestLogging: nodeEnv === 'production'`) | `apps/api/src/config.ts:192`, `apps/api/src/app.ts:109-117` |
| Services create their own logger the same way | `apps/api/src/services.ts:196`, `apps/api/src/routes/dj.ts:9` |
| `StreamResolver` logs nothing; a refused URL, a forced refresh and a mid-body failure are invisible | `apps/api/src/lib/streamResolver.ts:46-96` |
| Signed stream URLs are credentials (anyone holding one can fetch the file until it expires) | `streamResolver.ts:41` ("Never send this to the browser") |
| Backlog SEC-001 (log redaction of the gateway secret) shaped the current serializer | `audit/FIX-BACKLOG.md:68-80` |
| Hard rule 10: no `console.log` in production paths | `CLAUDE.md` |

Behavioural reference: `Echo-Music/app/src/main/kotlin/com/music/echo/utils/Fix403.kt` (a short correlation id per
logical operation, a redaction that prints only a length and a short hash prefix so "present / absent / changed" stays
visible, and wrappers that time an operation or trap its failure). Allegra keeps pino's JSON fields instead of Echo's
`k=v` text lines: Vercel's log search already parses JSON.

External: none needed (pino behaviour is already exercised by `apps/api/src/lib/logger.test.ts`).

## 3. Design decisions

| Decision | Rationale |
| --- | --- |
| New module `apps/api/src/lib/diagnostics.ts`; structured fields, not `k=v` strings | Matches pino and Vercel log search |
| `redactSecret` = `len=<n>,sha256=<first 8 hex>`; `absent` for empty | Enough to compare two attempts, useless to an attacker (8 hex = 32 bits of a SHA-256) |
| `redactUrl` = `<protocol>//<host>/~<sha256(pathname + search) first 8>` | Host tells which CDN; the hash tells whether the link changed; the signature never appears |
| Correlation id: the incoming `x-vercel-id` header when present (trimmed to 64 chars, `[A-Za-z0-9:_-]` only), else `<prefix>-<8 hex random>` | Vercel's id joins API lines to the platform's request log; a random id works locally |
| Only warnings and errors are logged on hot paths (stream); info for rare events (Last.fm connect) | Log volume and cost |
| Loggers are injected (`log?: DiagLog`) so tests capture lines without pino | Testable without global state |

Rejected: AsyncLocalStorage-based implicit context (more machinery than three call sites need); logging request
bodies (lyrics text, keys); SHA-1 like Echo (SHA-256 is already used across the repo, `packages/shared/sha256.ts`).

## 4. Exact change list

### 4.1 Create `apps/api/src/lib/diagnostics.ts`

```ts
import { createHash, randomBytes } from 'node:crypto';

export interface DiagLog {
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
}

/** A logger that drops everything (tests, local dev without logging). */
export const SILENT_LOG: DiagLog = { warn: () => undefined, error: () => undefined, info: () => undefined };

const short = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8);

export function redactSecret(value: string | null | undefined): string {
  return value ? `len=${value.length},sha256=${short(value)}` : 'absent';
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/~${short(url.pathname + url.search)}`;
  } catch {
    return 'invalid-url';
  }
}

const VERCEL_ID = /^[A-Za-z0-9:_-]{1,64}$/;

export function correlationId(prefix: string, vercelId?: string | null): string {
  const trimmed = vercelId?.trim().slice(0, 64);
  return trimmed && VERCEL_ID.test(trimmed) ? trimmed : `${prefix}-${randomBytes(4).toString('hex')}`;
}

/** Name and code of an error, never its message (messages can echo URLs or tokens). */
export function errorShape(error: unknown): { readonly name: string; readonly code?: string } {
  if (typeof error !== 'object' || error === null) return { name: typeof error };
  const record = error as { name?: unknown; code?: unknown; cause?: unknown };
  const cause = record.cause as { code?: unknown } | undefined;
  const code = typeof record.code === 'string' ? record.code : typeof cause?.code === 'string' ? cause.code : undefined;
  return { name: typeof record.name === 'string' ? record.name : 'Error', ...(code ? { code } : {}) };
}

/** Runs [work]; on failure logs one warning with the elapsed ms and the error shape, then rethrows. */
export async function timedWarn<T>(log: DiagLog, op: string, fields: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } catch (error) {
    log.warn({ op, ms: Date.now() - started, ...fields, error: errorShape(error) }, `${op} failed`);
    throw error;
  }
}
```

Test vectors (computed 2026-11-13, SHA-256, UTF-8):
- `redactSecret('fixture-session-key')` -> `len=19,sha256=4ca18850`
- `redactSecret('')` and `redactSecret(undefined)` -> `absent`
- `redactUrl('https://cdn.example/song.mp4?sig=abc')` -> `https://cdn.example/~575e81fc`
- `redactUrl('not a url')` -> `invalid-url`
- `correlationId('str', 'bom1::abcde-123')` -> `bom1::abcde-123`; `correlationId('str', 'bad id!')` matches `^str-[0-9a-f]{8}$`.
- `errorShape(Object.assign(new TypeError('terminated'), { cause: { code: 'UND_ERR_SOCKET' } }))` -> `{ name: 'TypeError', code: 'UND_ERR_SOCKET' }`.

### 4.2 Modify `apps/api/src/lib/streamResolver.ts`

- `StreamResolverOptions` gains `readonly log?: DiagLog;` stored as `this.log = options.log ?? SILENT_LOG`.
- `pipe(songId, range, response, corr = correlationId('str'))` (new optional 4th parameter; existing callers and tests
  keep working).
- Log points (warn level, exactly these messages and fields):
  - after a 403/404 on the first fetch (line 48): `{ op: 'stream', corr, song: songId, status, url: redactUrl(cachedUrl), step: 'refresh' }`, message `stream link refused`.
  - non-passthrough status (line 53): `{ op: 'stream', corr, song: songId, status }`, message `stream upstream status`.
  - body error before headers (line 87): `{ op: 'stream', corr, song: songId, error: errorShape(e), headersSent: false }`, message `stream body failed`.
  - body error after headers (line 93): same with `headersSent: true, sentBytes` (count bytes in a `data` listener; this
    counter is also what P3-1 needs).
  To log the URL, `fetchResolved` returns `{ response, abort, url }`.
- `apps/api/src/routes/stream.ts:15`: pass `correlationId('str', request.header('x-vercel-id'))`.
- `apps/api/src/services.ts:172`: pass `log: createLogger(process.env.NODE_ENV === 'production')` (one logger instance
  shared with `blendLog`; rename to `serviceLog`).

### 4.3 Adopt elsewhere (later PRs, listed for consistency)

P1-3 (`scrobbles.ts`) uses `redactSecret(userId)` for user fields and never logs titles; P2-2 uses `redactUrl` for refused
URLs; P2-5 uses `timedWarn` around Paxsenix requests; P3-1 uses `errorShape` and `sentBytes`.

## 5. Implementation order

1. `diagnostics.ts` + `diagnostics.test.ts`. Verify `cd apps/api && node --import tsx --test src/lib/diagnostics.test.ts`.
2. Stream resolver wiring + tests. Verify `cd apps/api && node --import tsx --test src/lib/streamResolver.test.ts`.
3. Route and services wiring. Verify `npm run typecheck && npm run lint && npm test`.
4. Deploy a preview; request a nonexistent song id through `/api/stream/<bad>` and confirm one `stream ...` line in
   `vercel logs <deployment-url>` with no URL query or token.

## 6. Edge cases

| Input | Behaviour |
| --- | --- |
| URL with credentials (`https://user:pass@host/x`) | `url.host` excludes userinfo; output has no credentials |
| Very long secret | Length printed, hash 8 hex |
| Error whose message contains a URL | Message never logged (`errorShape` uses name/code only) |
| `x-vercel-id` with odd characters | Replaced by a random id |
| Logging disabled (dev/test) | `SILENT_LOG` or pino `enabled: false` |

## 7. Test plan

- `apps/api/src/lib/diagnostics.test.ts`: `redactSecret prints length and short hash`, `redactSecret marks absent`,
  `redactUrl hides path and query`, `redactUrl never prints userinfo`, `correlationId keeps a valid vercel id`,
  `correlationId replaces an invalid one`, `errorShape reads cause code and never the message`,
  `timedWarn logs once and rethrows`.
- `apps/api/src/lib/streamResolver.test.ts` add: `a refused link logs a redacted url and the refresh step` (capture with a
  fake `DiagLog`; assert no `sig=` substring and no full URL in any captured field);
  `a body failure after headers logs sentBytes`.
- Existing: `logger.test.ts`, all `streamResolver.test.ts` cases unchanged.

## 8. Security, privacy and cost

Strictly reduces exposure: no URL query, token or message text reaches logs. Song ids are public catalog ids (they appear
in share links) and may be logged. Volume: only failure lines on the stream path.

## 9. Rollout and rollback

No flag. Rollback by reverting. Evidence: one preview log line as in step 4, screenshot or pasted JSON with ids intact
and secrets absent.

## 10. Acceptance checklist

- [ ] No `console.*` added.
- [ ] No full URL, query string, token or error message in any new log field.
- [ ] `pipe` signature change is backward compatible (optional 4th parameter).
- [ ] Tests assert absence of secrets, not just presence of fields.

Common mistakes: logging `error.message` (undici messages can include the URL); logging `request.originalUrl` (has the
query); creating a pino instance per request.

## 11. Open questions (defaults)

1. Hash length 8 or 12 hex? Default 8 (Echo uses a short prefix too; collisions only blur debugging).
2. Log successful forced refreshes at info? Default: no (warn on refusal already covers it).
