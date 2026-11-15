# P2-4 Shared track-version rules for lyric and provider matching

Draft id: P2-8 (metadata cleaner), narrowed after an audit. Priority: P2, prerequisite of P2-5. Branch:
`feat/shared-track-version`. Touches `packages/shared` (sync:shared; APK rebuild path -> mobile `expo.version` patch bump)
and `apps/api`. Cache-key bump: only in the consumer (P2-5). No contract change.

## 1. Goal and user-visible outcome

When a lyric provider offers several recordings of a song, the matcher prefers the one whose version matches the song
playing (a live version gets live lyrics, the studio song does not get the slowed + reverb upload's timing). One shared
rule decides what "a version" is, instead of three slightly different word lists.

Non-goals: a general title cleaner (Allegra already has `cleanLyricsQuery`, `leadArtist`, `lrclibAttempts`,
`titlesAlike`); YouTube channel suffixes ("- Topic", "VEVO"): the API never sees YouTube metadata; rewriting
mobile matching (adoption there is optional, open question 1).

## 2. Evidence (audit result: most of the draft item already exists)

| Existing behaviour | Where |
| --- | --- |
| API lyric query cleaning: drops (Lyrics), (Official...), (MP3_320K), (Audio), (From ...), (Original ...), (Remaster...), (feat ...), language tags, all `[...]`, " - From ..." suffixes; splits "Artist - Title" when artist is missing | `apps/api/src/services/lyrics.ts:520-546` |
| Lead artist split on `,`, `&`, `feat`, `ft`, ` x ` | `apps/api/src/services/lyrics.ts:549-551`; shared `creditedArtists` in `packages/shared/identity.ts` |
| Looser LRCLIB attempts (lead artist, short title, co-artists) and a title-similarity guard | `apps/api/src/services/lyrics.ts:554-583` |
| Lyric scoring: title token overlap, synced bonus, duration within 2 s / 10 s | `apps/api/src/lib/matcher.ts:8-30` |
| Identity keeps live/remix/acoustic labels as part of the recording identity | `packages/shared/identity.ts:8-13` |
| Radio folds "(Lofi Flip)", "- Slowed" onto the base title | `packages/shared/radio.ts:99-122` |
| Phone resolver rejects cover/karaoke/instrumental/lofi/slowed/reverb/sped-up variants unless asked | `apps/mobile/src/services/ytmusic/resolver.ts:20-35` |
| Phone lyric cascade cleans file extensions and (official/lyrics/audio/video/...) tags | `apps/mobile/src/services/lyrics/EchoLyricsCascade.ts:109-117` |
| Missing: a shared, tested notion of version tags that a scorer can compare between request and candidate | none |

Behavioural reference: `Echo-Music/metadata/src/main/kotlin/com/music/echo/metadata/cleaner/MetadataCleaner.kt` and
`CleanerRules.kt` (bracket tags classified as featuring, version or junk; version kinds remix, live, acoustic, remaster,
instrumental, cover, radio edit, extended, slowed, sped up) and the Paxsenix scorer's penalties for a "remix"/"mixed"
result when the request is not one (`Echo-Music/paxsenixlyrics/.../Paxsenix.kt:187-214`).

## 3. Design decisions

| Decision | Rationale |
| --- | --- |
| New pure module `packages/shared/trackVersion.ts`, added to `SHARED_COPIES` | One rule for API, web and phone; API needs a generated copy |
| Version tags detected only inside brackets or after a ` - ` separator, matched on whole words | "Live Wire" or "Acoustic Soul" are song names, not versions |
| Tags: `remix`, `live`, `acoustic`, `instrumental`, `karaoke`, `cover`, `slowed`, `reverb`, `sped-up`, `lofi`, `extended`, `radio-edit`, `remaster`, `unplugged`, `reprise` | The union of the three existing lists and Echo's kinds, Allegra's own grouping |
| `versionPenalty(requested, candidate)` returns 0 when tag sets are equal; -60 per tag the candidate has and the request lacks; -30 per tag the request has and the candidate lacks; `remaster` differences count -5 | A wrong version is worse than a missing label; remasters share lyrics and timing |
| Do not change `cleanLyricsQuery`, `identityKey` or the radio rules in this PR | Avoids cache-key and identity churn |

## 4. Exact change list

### 4.1 Create `packages/shared/trackVersion.ts`

```ts
export type VersionTag =
  | 'remix' | 'live' | 'acoustic' | 'instrumental' | 'karaoke' | 'cover' | 'slowed' | 'reverb'
  | 'sped-up' | 'lofi' | 'extended' | 'radio-edit' | 'remaster' | 'unplugged' | 'reprise';

const PATTERNS: ReadonlyArray<readonly [VersionTag, RegExp]> = [
  ['remix', /\b(?:remix|rmx|re-?edit|bootleg|flip|club mix|dub mix)\b/i],
  ['live', /\b(?:live|live at|live from|in concert|session)\b/i],
  ['acoustic', /\bacoustic\b/i],
  ['unplugged', /\bunplugged\b/i],
  ['instrumental', /\binstrumental\b/i],
  ['karaoke', /\bkaraoke\b/i],
  ['cover', /\bcover\b/i],
  ['slowed', /\bslowed\b/i],
  ['reverb', /\breverb\b/i],
  ['sped-up', /\b(?:sped[ -]?up|nightcore)\b/i],
  ['lofi', /\blo-?fi\b/i],
  ['extended', /\bextended\b/i],
  ['radio-edit', /\bradio (?:edit|version)\b/i],
  ['remaster', /\bremaster(?:ed)?\b/i],
  ['reprise', /\breprise\b/i]
];

/** The parts of a title that can carry a version: bracketed groups and text after " - ". */
export function versionSegments(title: string): string[];

export function versionTags(title: string): ReadonlySet<VersionTag>;

export const VERSION_PENALTY = { extra: -60, missing: -30, remaster: -5 } as const;

export function versionPenalty(requestedTitle: string, candidateTitle: string): number;
```

`versionSegments` pseudocode: collect every `(...)`, `[...]`, `{...}`, `（...）` group content; then, on the title with
those groups removed, every piece after the first `/\s[-–—|]\s/` separator; return trimmed non-empty strings.
`versionTags` = tags whose pattern matches any segment.
`versionPenalty`: `req = versionTags(requested)`, `cand = versionTags(candidate)`; sum over `cand \ req` (remaster -> -5,
else -60) plus over `req \ cand` (remaster -> -5, else -30).

Worked examples (test vectors):
- `versionTags('Kesariya (Lofi Flip)')` = {lofi, remix} ("flip" -> remix).
- `versionTags('Kesariya - Slowed + Reverb')` = {slowed, reverb}.
- `versionTags('Live Wire')` = {} (no bracket or separator).
- `versionTags('Tum Hi Ho (From "Aashiqui 2")')` = {}.
- `versionTags('Yellow (Live at Glastonbury 2016)')` = {live}.
- `versionTags('Bohemian Rhapsody - Remastered 2011')` = {remaster}.
- `versionPenalty('Blinding Lights', 'Blinding Lights (Slowed + Reverb)')` = -120.
- `versionPenalty('Yellow (Live)', 'Yellow')` = -30.
- `versionPenalty('Song', 'Song - 2015 Remaster')` = -5.
- `versionPenalty('Song (Acoustic)', 'Song (Acoustic Version)')` = 0.

### 4.2 Modify `scripts/sync-shared.mjs:12-33`

Add `'trackVersion.ts'` to `SHARED_COPIES`; run `npm run sync:shared` to create `apps/api/src/shared/trackVersion.ts`.

### 4.3 Optional adoption in the existing API scorer

`apps/api/src/lib/matcher.ts`: not changed in this PR (changing a scorer requires a lyrics cache-key bump; do it only
together with P2-5's bump, open question 2).

## 5. Implementation order

1. Module + `packages/shared/trackVersion.test.ts`. Verify `npm test --workspace packages/shared` (or `cd packages/shared && npm test`).
2. `sync:shared`. Verify `npm run infra:test` (parity) and `npm run typecheck`.
3. Bump `apps/mobile/app.json` `expo.version` (patch): `packages/**` is an APK path (`.github/workflows/mobile-apk.yml:12-17`).

## 6. Edge cases

| Input | Behaviour |
| --- | --- |
| Nested brackets `Song (feat. A (B))` | Outer and inner both scanned; no version tag |
| Unicode brackets `（Live）` | Scanned |
| Title with `-` inside words (`Lo-Fi`) without spaces | Not a separator; `lo-?fi` still matches only inside a segment |
| Empty title | Empty set, penalty 0 |
| Same tag twice | Set semantics, counted once |

## 7. Test plan

`packages/shared/trackVersion.test.ts` (node:test): every vector in 4.1 as its own test named after the input, plus
`segments ignore plain words`, `unicode brackets are scanned`. Existing parity test `tests/infra/infra-files.test.mjs:108`
("the API copies of the shared sync rules match their source") must pass.

## 8. Security, privacy and cost

None (pure functions).

## 9. Rollout and rollback

Inert until P2-5 uses it. Rollback: remove the module and its copy entry.

## 10. Acceptance checklist

- [ ] Pure module, no imports outside `packages/shared` (infra test "shared packages import no npm packages").
- [ ] `sync:shared` run; generated copy committed, not hand-edited.
- [ ] Mobile version bumped because `packages/**` changed.

Common mistakes: matching version words anywhere in the title; editing `apps/api/src/shared/trackVersion.ts` by hand.

## 11. Open questions (defaults)

1. Replace the phone resolver's `VARIANT_MARKERS` with this module? Default: later, in its own mobile PR.
2. Apply `versionPenalty` inside `matcher.ts` for LRCLIB? Default: only if P2-5 measurements show wrong-version picks; bump `lyrics` and `lyrics-alternatives` cache keys then.
