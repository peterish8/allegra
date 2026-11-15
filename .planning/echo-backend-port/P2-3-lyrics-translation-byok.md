# P2-3 Lyrics translation upgrade: bring-your-own-key LLM with line-locked output

Draft id: P1-6 (demoted to P2 and redesigned). Branch: `feat/lyrics-translate-ai`. API + web. Contract change:
additive fields on `POST /api/lyrics/translate`. No mobile change (the phone has no translation UI today), no bump.

## 1. Goal and user-visible outcome

On the website, a listener who has entered an AI key for the DJ (OpenAI, OpenRouter or Gemini) gets better lyric
translations, plus two new views: romanised lyrics (how a Tamil or Hindi song is pronounced, in Latin letters) and
pronunciation in another script. Lines stay aligned with the timed lyrics because the reply must contain exactly one
line per input line. Listeners without a key keep today's free MyMemory translation.

Non-goals: a server-paid LLM (Allegra is free and has no payments; open question 2); mobile translation UI; translating
word-timed pieces (translated lines carry no `words`, as today); storing the key anywhere.

## 2. Evidence

| Fact | Where |
| --- | --- |
| Translation is MyMemory first, optional self-hosted LibreTranslate, all-or-nothing, cached 30 days by title/artist/langs/line count/body hash | `apps/api/src/services/translation.ts:9-119` |
| Anonymous MyMemory cap 5,000 chars/day, 50,000 with a contact email (server-side config) | `translation.ts:25-29`, `apps/api/src/config.ts:60-66,134-136` |
| Route: `POST /api/lyrics/translate` (alias `/api/ai/translate-lyrics`), no auth, max 400 lines x 500 chars | `apps/api/src/routes/discovery.ts:12-44,74-85` |
| Rate bucket: discovery, 20/min/IP | `apps/api/src/app.ts:201-202,273-276` |
| JSON body limit 32 kB for this route (general limit) | `apps/api/src/app.ts:127` |
| The DJ already proxies a listener's own key server-side to `openai` / `openrouter` / `gemini` OpenAI-compatible chat completions, key never stored | `apps/api/src/routes/dj.ts:21-34,109-123,228-260`; `apps/web/src/lib/djSession.ts:6-7` ("The API key is never written anywhere") |
| The web key lives in React state in `useDjSession` | `apps/web/src/hooks/useDjSession.ts:208` |
| Web client call | `apps/web/src/lib/api.ts:550-560`; used in `apps/web/src/App.tsx` |
| Contract text for translate | `docs/api-contract.md:413-420` |

Behavioural reference: `Echo-Music/lyrics/src/main/kotlin/echo/music/iad1tya/api/OpenRouterService.kt:35-225` and
`.../lyrics/LyricsTranslationHelper.kt` (one request returns a JSON array whose length must equal the input line count,
retried when the count is wrong; three modes: translate, romanise, transcribe into a target script; low temperature).
Echo puts the user's key on the device and calls the LLM directly; Allegra's web cannot (CORS for some providers, and
the DJ precedent proxies server-side without storing).

External facts (accessed 2026-11-13):
- OpenRouter structured outputs: `response_format` with `type: json_schema` (Chat Completions) or `text.format`
  (Responses); support is per model and per upstream provider; set `require_parameters: true` in provider preferences to
  route only to supporting endpoints. https://openrouter.ai/docs/guides/features/structured-outputs
- Gemini OpenAI compatibility: base `https://generativelanguage.googleapis.com/v1beta/openai/`; structured output
  supported through `response_format`. https://ai.google.dev/gemini-api/docs/openai
- UNVERIFIED: whether OpenAI strict JSON schema accepts `minItems`/`maxItems`. Default: do not use them; validate the
  count in code.
- Pricing: not researched in depth because the listener's own key pays. Order of magnitude for planning: one song is
  about 40 lines x ~10 tokens in and out per line, under 2k tokens per mode.

## 3. Design decisions

| Decision | Rationale |
| --- | --- |
| BYOK: the request may carry `ai: { provider, apiKey, model }`; the server forwards it, never stores or logs it | Same model as the DJ; no cost to the owner; no new secret |
| Share the provider endpoints with the DJ through a small `aiProviders.ts` | One place for the three URLs and the Gemini quirk (`reasoning_effort: 'low'`) |
| Modes `translate` (default), `romanize`, `transcribe`; `romanize`/`transcribe` require `ai` | MyMemory cannot romanise |
| Input deduplicated (choruses), chunks of at most 40 lines or 3,000 characters, 2 chunks in flight | Fewer tokens; a short reply is easier to keep aligned |
| Output contract: `{ "lines": string[] }`, exactly as many items as the chunk; one corrective retry; then the whole song fails | Line alignment is the feature; half-translated lyrics read worse (existing all-or-nothing rule) |
| Structured output requested; if the provider rejects `response_format` (HTTP 400 naming it), retry once without it and parse the first JSON object in the text | Works on models without structured output |
| Romanize validation: at least 90% of the letters in each non-empty output line are Latin script | Catches a model that translated instead of romanising |
| Cache shared across listeners, key includes provider, model, mode, languages and the body hash, 30 days | Lyrics translations are not personal; saves the next listener's tokens. Open question 3 |
| Deadlines: 25 s per call (body included, hard rule 9), 45 s per request (same as `MAX_TURN_MS` in `dj.ts:11`) | Bounded outbound work |
| Errors: provider 401/403 -> 400 "That AI key was refused."; 429 -> 429 "Your AI provider is limiting this key. Try again in a minute."; other -> 502 "Could not translate this song right now. Try again later." | User-facing copy, provider details mapped server-side (hard rule 4) |

Rejected: DeepL/Mistral server keys (cost to a free product, new processor); streaming partial translations (Echo's
streaming service; adds UI complexity for little gain); translating per line (cost and latency).

## 4. Exact change list

### 4.1 Create `apps/api/src/lib/aiProviders.ts`

```ts
export type AiProvider = 'openai' | 'openrouter' | 'gemini';
export const AI_PROVIDERS: readonly AiProvider[] = ['openai', 'openrouter', 'gemini'];
export function chatCompletionsUrl(provider: AiProvider): string {
  return provider === 'openai' ? 'https://api.openai.com/v1/chat/completions'
    : provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    : 'https://openrouter.ai/api/v1/chat/completions';
}
/** Extra body fields a provider needs (Gemini thinks by default). */
export function providerExtras(provider: AiProvider): Record<string, unknown> {
  return provider === 'gemini' ? { reasoning_effort: 'low' } : provider === 'openrouter' ? { provider: { require_parameters: true } } : {};
}
export function isAiProvider(value: unknown): value is AiProvider { return value === 'openai' || value === 'openrouter' || value === 'gemini'; }
```

Refactor `apps/api/src/routes/dj.ts:228-233` to call `chatCompletionsUrl(input.provider)` (behaviour identical; DJ tests
`app.dj.test.ts` prove it). Do not add `require_parameters` to the DJ (tool calling, different needs).

### 4.2 Create `apps/api/src/services/translationLlm.ts`

```ts
export type TranslationMode = 'translate' | 'romanize' | 'transcribe';
export interface AiKey { readonly provider: AiProvider; readonly apiKey: string; readonly model: string }
export class AiKeyRejectedError extends Error {}
export class AiRateLimitedError extends Error {}

export const LLM_CHUNK_LINES = 40;
export const LLM_CHUNK_CHARS = 3_000;
export const LLM_CONCURRENCY = 2;
export const LLM_CALL_TIMEOUT_MS = 25_000;
export const LLM_TOTAL_BUDGET_MS = 45_000;
export const ROMAN_SHARE = 0.9;

export function chunkLines(texts: readonly string[]): string[][];          // greedy by LLM_CHUNK_LINES and LLM_CHUNK_CHARS
export function systemPrompt(mode: TranslationMode, target: string, source: string | undefined): string;
export function parseLines(content: string, expected: number): string[] | null;   // strips ``` fences, finds first {...}, validates
export function latinShare(text: string): number;                          // letters in \p{Script=Latin} / all \p{L}; 1 when no letters

export class LlmTranslator {
  public constructor(fetchImpl: typeof fetch = fetch);
  /** Unique source texts -> translated texts in the same order, or null on failure. Throws the two typed errors. */
  public translate(texts: readonly string[], mode: TranslationMode, target: string, source: string | undefined, key: AiKey): Promise<string[] | null>;
}
```

Request per chunk (`fetchBodyWithTimeout`, POST, `Authorization: Bearer <apiKey>`):

```json
{
  "model": "<model>",
  "temperature": 0.2,
  "max_tokens": "<min(4000, 64 + chunkChars * 4)>",
  "messages": [
    { "role": "system", "content": "<systemPrompt>" },
    { "role": "user", "content": "{\"lines\":[\"...\",\"...\"]}" }
  ],
  "response_format": { "type": "json_schema", "json_schema": { "name": "lyric_lines", "strict": true,
    "schema": { "type": "object", "properties": { "lines": { "type": "array", "items": { "type": "string" } } },
                "required": ["lines"], "additionalProperties": false } } }
}
```

plus `providerExtras(provider)`. Read `choices[0].message.content` (string). Validation in `parseLines`: JSON object with
`lines` array, every item a string, `length === expected`; an empty item becomes the source line. For `romanize` also
require `latinShare(item) >= 0.9` for every item whose source has letters.

System prompts (Allegra's own wording; `{N}`, `{target}`, `{source}` substituted):
- translate: "You translate song lyrics one line at a time. The user sends JSON {"lines": [...]} with {N} lines{ from {source}}.
  Reply with JSON {"lines": [...]} holding exactly {N} strings in the same order, where item i translates line i into
  {target}. Keep each line short and natural to sing. Keep names as they are. Never merge, split, number, explain or
  skip lines. Copy a line unchanged when it is already in {target}, empty, or only sounds like "la la"."
- romanize: same frame, item i "writes how line i is pronounced using plain Latin letters, without translating its meaning".
- transcribe: same frame, item i "writes how line i sounds using the {target} script, without translating its meaning".

Retry policy per chunk: attempt 1 with `response_format`; if HTTP 400 and the body mentions `response_format` or
`json_schema`, attempt again without it (counts as the structured fallback, not the corrective retry); if the reply parses
but has the wrong count or fails romanisation, one corrective retry appending
`{ role: 'assistant', content: <previous reply> }, { role: 'user', content: "That had {got} items. Reply again with exactly {N} items, one per input line." }`.
Then give up (null). 401/403 throw `AiKeyRejectedError`, 429 throws `AiRateLimitedError`. Overall `withinBudget(…, 45_000)`.

### 4.3 Modify `apps/api/src/services/translation.ts`

`translate(lines, title, artist, targetLanguage = 'English', sourceLanguage?, options: { mode?: TranslationMode; ai?: AiKey } = {})`:
- `mode` default `'translate'`. If `ai` is absent and `mode !== 'translate'` -> throw `new BadRequestError('Romanised and pronunciation lyrics need your AI key.')` (add `BadRequestError` to `apps/api/src/lib/errors.ts` if absent; map it to 400 in `routes/common.ts`).
- `ai` present: key `cacheKey('translate', 'llm-v1', ai.provider, ai.model, mode, source, target, String(lines.length), bodyHash)`;
  `load` = dedupe exactly as today (line 99-101, same `MAX_BATCH_BYTES` filter is not needed for the LLM: use all non-empty,
  non-`[INSTRUMENTAL]` unique texts) -> `LlmTranslator.translate` -> map back to lines exactly as today (line 109-114),
  `provider: \`${ai.provider}:${ai.model}\``.
- `source === target` short-circuit (line 85) applies to `translate` mode only.

### 4.4 Modify `apps/api/src/routes/discovery.ts:23-44`

Parse `mode` (`'translate' | 'romanize' | 'transcribe'`, else 400) and `ai` (object with `provider` per `isAiProvider`,
`apiKey` string 8-512 chars, `model` string 1-160 chars; any other shape -> 400). Map `AiKeyRejectedError` -> 400,
`AiRateLimitedError` -> 429 with the copy in section 3. Keep both paths (`/lyrics/translate`, `/ai/translate-lyrics`).
Body limit: requests with 400 lines can exceed 32 kB; add `app.use('/api/lyrics/translate', express.json({ limit: '256kb', inflate: false }))`
and the same for `/api/ai/translate-lyrics` in `apps/api/src/app.ts` beside the other route-specific parsers (lines 123-127).

### 4.5 Web

- Create `apps/web/src/lib/aiKeyVault.ts` (memory only, never storage):
  ```ts
  export interface AiKeyChoice { readonly provider: 'openai' | 'openrouter' | 'gemini'; readonly apiKey: string; readonly model: string }
  export function setAiKey(choice: AiKeyChoice | null): void;
  export function currentAiKey(): AiKeyChoice | null;
  export function subscribeAiKey(listener: () => void): () => void;
  ```
- `apps/web/src/hooks/useDjSession.ts`: whenever provider, model or key change (an effect on `[provider, model, apiKey]`),
  call `setAiKey(provider is a cloud provider && apiKey.trim() ? { provider, apiKey: apiKey.trim(), model } : null)`.
  This effect has no playback dependency (invariant 2 is about audio load effects; still, do not read `isPlaying`).
- `apps/web/src/lib/api.ts:550`: `translateLyrics(song, lines, targetLanguage, signal, options?: { mode?: TranslationMode; ai?: AiKeyChoice })`
  adds `mode` and `ai` to the body only when set. Switch the path to `/api/lyrics/translate` (the documented primary).
- `apps/web/src/App.tsx` (translation control): when `currentAiKey()` is set (subscribe with `useSyncExternalStore`), show a
  three-way choice "Translate / Romanised / Pronounce" next to the language picker; without a key show only Translate and a
  hint "Add an AI key in the DJ for romanised lyrics." Follow `DESIGN.md` tokens; motion only `transform`/`opacity`
  with tokens (hard rules 5-7).

### 4.6 Docs

`docs/api-contract.md:413-420`: document `mode`, `ai` (forwarded, never stored or logged), the 400/429 cases, and the
`provider` value format `<provider>:<model>`.

## 5. Implementation order

1. `aiProviders.ts` + DJ refactor. Verify `cd apps/api && node --import tsx --test src/app.dj.test.ts`.
2. `translationLlm.ts` + `translationLlm.test.ts`. Verify that file.
3. `translation.ts`, route, body limit, errors. Verify `npm run typecheck && npm run lint && npm test`.
4. Contract doc.
5. Web vault, hook, api, UI. Verify gates; check 360/768/1280/1920; translate a Tamil song with a real key on :5173.

## 6. Edge cases and failure modes

| Input / state | Required behaviour |
| --- | --- |
| Model returns 39 items for 40 | Corrective retry; then null -> 502 |
| Model returns fenced JSON | Fences stripped |
| Provider rejects `response_format` | One retry without it |
| Key invalid | 400 "That AI key was refused." (no provider text echoed) |
| 429 from provider | 429 to client with copy; no retry server-side |
| 400 lines (song with long outro) | 10 chunks, 2 in flight, within 45 s or 502 |
| `[INSTRUMENTAL]` lines | Passed through unchanged (existing rule) |
| Romanize a song already in Latin script | Model copies lines; validation passes (share 1) |
| Same song, same mode, another listener | Cache hit, no provider call |
| Listener clears the key mid-request | Request already carries it; completes |
| Body over 256 kB | 400 from the body parser (existing error handler) |

## 7. Test plan

- `apps/api/src/services/translationLlm.test.ts`: `chunkLines splits at 40 lines`, `chunkLines splits at 3000 chars`,
  `parseLines accepts exactly N`, `parseLines rejects N-1`, `parseLines strips code fences`, `empty item falls back to the source line`,
  `latinShare of "vanakkam" is 1 and of "வணக்கம்" is 0`, `corrective retry sends the count message once`,
  `falls back without response_format after a 400 that names it`, `401 throws AiKeyRejectedError`, `429 throws AiRateLimitedError`,
  `the api key is only in the Authorization header` (assert the captured body JSON has no key).
  Write non-Latin fixtures with `\u{...}` escapes in source (repo memory).
- `apps/api/src/services/translation.test.ts` add: `romanize without a key is a bad request`, `llm path caches by provider, model and mode`.
- `apps/api/src/app.translate.test.ts` (supertest through `createApp`): `mode=romanize with ai returns aligned lines`,
  `bad ai shape is 400`, `refused key maps to 400 with user copy`, `body of 300 lines is accepted`.
- Existing: `app.dj.test.ts` (DJ unchanged), `translation.test.ts`, `app.routes.test.ts`.

## 8. Security, privacy and cost

- The key travels over HTTPS in the request body, is used for one outbound call and dropped. Request logs never include
  bodies (`apps/api/src/lib/logger.ts:15-30`); do not log `ai` anywhere; `errorShape` (P2-1) only.
- Lyrics text is sent to the provider the listener chose with their own key; state that in the UI hint ("Uses your AI key;
  the lyrics are sent to <provider>").
- Cost to the owner: none (BYOK). Cost to the listener: their provider's token price.
- Abuse: the route is anonymous but BYOK means the caller pays; the discovery bucket limits request rate per IP.

## 9. Rollout and rollback

No flag needed (requires a listener key). Rollback: revert; the MyMemory path is unchanged throughout.
Evidence: a preview deployment, a real OpenRouter or Gemini key, one Tamil song in all three modes, screenshots and the
line counts matching the timed lyrics.

## 10. Acceptance checklist

- [ ] Output length equals input length for every chunk, or the request fails.
- [ ] The key is never stored, logged, cached, or echoed.
- [ ] DJ behaviour unchanged after the endpoint refactor.
- [ ] Contract doc updated in the same PR as the route change.
- [ ] Web motion uses tokens; reduced motion collapses to opacity.

Common mistakes: putting `ai` into the cache key (it would include the key); trusting `minItems`; translating
`[INSTRUMENTAL]`; logging `request.body`.

## 11. Open questions (defaults)

1. Offer the AI modes on the phone? Default: not now (no translation UI on mobile).
2. A server-paid LLM fallback for everyone? Default: no (cost, new processor, and a free product).
3. Share LLM translations across listeners through the cache? Default: yes (lyrics are not personal); per-instance memory only.
4. Default model suggestion? Default: the model the listener already set for the DJ.
