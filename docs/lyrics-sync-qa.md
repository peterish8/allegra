# Listener lyric sync verification — 2026-10-17

Branch: `feat/lyrics-sync-serve`, based on `10dfda4`. Existing implementation changes were
uncommitted when verification began. Other work in this checkout was preserved.

## Scope found

The checkout contains the first slice of the supplied brief: the verified-lyrics store,
read endpoint, JioSaavn fallback, and web/mobile consumers. Fetching origin found no separate
branch containing the remaining finder, forced aligner or sync screen.

The complete listener sync feature is **incomplete**, rather than awaiting manual tests alone.
Mozhiye still has no lyric candidates from the currently connected providers. No timing was
generated, previewed, approved or saved during this verification.

## Repairs

- Keep the desktop missing-lyrics panel and its recovery actions accessible after an empty lookup.
- Expose lyric lines and version choices as buttons rather than overriding them with list-item roles.
- Move focus into the version picker; Escape closes only the picker and returns focus to its opener.
- Use accurate copy when neither the current song nor the alternatives have lyrics.
- Make empty/error recovery content scroll when the picker leaves little room on small screens.
- Preserve case-sensitive Saavn IDs in the new lyrics cache. Two IDs differing only by case must
  never return each other's words. The cache namespace was bumped.
- Invalidate title/artist memo entries along with recording-ID entries after moderation; prevent
  an older pending read from refilling the new memo cache.

Both cache regressions failed before the repair and passed afterward.

## Manual browser evidence

Final checks used the Codex in-app browser at `http://localhost:5173` with Mozhiye (From "Baththa").
An earlier external-browser setup attempt was abandoned when the owner required in-app only.

- Mozhiye plays and pauses; the empty lookup no longer removes the recovery panel.
- Find another version opens the empty picker with correct copy.
- Escape closes the picker without dismissing the player and restores focus to the opener.
- Layout inspected at widths 360, 768, 1280 and 1920. At 360, keyboard navigation scrolls the
  recovery actions into view instead of leaving them clipped below the player controls.
- Captured browser error log was empty at the end. Viewport override was reset.

These checks cover missing-lyrics recovery. They do not prove alignment quality or native Android UI.

## Automated verification

- Root typecheck, lint and test gates passed.
- Mobile gate passed: 94 suites, 786 tests; lint has 77 warnings and no errors.
- Production build passed.
- `npx convex dev --once` passed against the configured development deployment.
- No production deployment, commit or push was performed.

## Found online fallback (second pass, 2026-10-17)

The owner asked for Mozhiye and Vaazhanum Baththa (both From "Baththa") to show the lyric-site words
automatically, without the site's name anywhere in the app.

- `packages/shared/lyricsText.ts` cleans site text: intro paragraph, credits, "Music : ……" breaks,
  part dividers and singer labels removed (English, Tamil, Telugu, Hindi, Malayalam, Kannada),
  `(x2)` / `{ … }(3)` / lone "Repeat" written out.
- `apps/api/src/providers/lyricsSites/`: a polite fetcher (honest User-Agent, one request a second per
  host, 8 s timeout) and the tamil2lyrics adapter. Pages are found by the likeliest slug, then the five
  `lyrics-sitemap*.xml` files (never `/?s=`), and accepted only when the film or credits match.
- `GET /api/lyrics` asks the site only for a song in a covered language whose providers have not
  answered within 3 s, after JioSaavn. Plain lyrics in hand end the wait then. `alternatives` lists every
  script the site has. Listeners see `Found online · English`; the response never names the site.
- Web sends `album` and `language`. `LYRIC_SITES=off` disables the fallback.

Live checks on :5173 (signed-out guest, narrow pane):

- Mozhiye (`B4-hLCKJ` and the soundtrack release `cSIMOwct`): 56 English lines, about 3.3 s.
- Vaazhanum Baththa (`ZSsrsQ2I` and `kRNFjEMy`): 28 English lines, all matching the page; about 3.3–4 s.
- Neither page has a Tamil-script panel, so both songs have English only.
- Source info reads "Found online · English / Plain text"; Other lyrics lists it as the one version.
- Songs with synced lyrics (Rowdy Baby) never ask the site.

Gates: root typecheck, lint and test exit 0. Not covered: the phone (it runs its own cascade and does
not call `/api/lyrics`, so it does not show Found online lyrics yet), and the plain-lyrics auto-scroll.

## Remaining brief

### Plain-lyrics reading mode (2026-10-17)

The Step 1 repair separates plain text from timed lyrics on web and phone. Plain words have no
active line, word sweep, timing nudge or line-seek action. The default-on device setting
"Auto-scroll lyrics without timing" and a pause/resume chip control proportional reading progress
after a ten-second intro. Manual interaction pauses following until three seconds after release;
seeking repositions the text even while audio is paused. No alignment is implied or generated.

Web consumes the existing payload `type` and song duration; the API contract and existing plain
payload timestamps remain unchanged. Mobile's plain parser now retains zero timestamps, and the
Now Playing hook no longer manufactures replacements. `SynchronizedLyrics` owns scrolling in
the player, mini player and remote player. Phone version: 1.9.0.

In-app-browser checks on :5173 covered Mozhiye (56 lines) and Vaazhanum Baththa (28 lines) at
360 / 768 / 1280 / 1920 pixels, with no plain line buttons or active markers. Mozhiye checks also
covered pause/resume, manual-scroll timeout and seek-to-start/end while paused. Captured error
log: empty. Temporary viewport overrides were reset.

Regression coverage checks plain rendering, reading-progress arithmetic, setting defaults and
persistence, and mobile plain/timed parsing. The mobile worklet checker now resolves `@shared/`
to `packages/shared`, matching Metro, TypeScript and Jest, so it can inspect the new shared worklet.

Limitations: native Android UI was not exercised. Previously saved mobile lyrics with synthetic
nonzero timestamps are indistinguishable from real line timing in the old stored format; fetching
those lyrics again uses the new parser. Actual word alignment, preview and save remain separate work.

Final checks: root typecheck, lint, tests and production build passed; web regressions passed
(258 tests). Mobile secret scan, lint (79 warnings, no errors), typecheck and all 94 suites /
789 tests passed after the worklet-path and union-type repairs. No commit, push or deployment.

The remaining slices are lyric-site discovery and server-held candidates,
validated times-only submissions, the MMS worker/romanizer/alignment pipeline, the sync/preview/save
screen, moderation UI, and song share links. They still need implementation and their own acceptance
checks, including real WebGPU/WASM runs and web-to-phone verification after saving.

## Finder and timing-submission API (2026-10-17)

The API slice is implemented: signed-in `GET /api/lyrics/sources`, `POST /api/lyrics/sync` and
`POST /api/lyrics/report`, mounted through `createApp`, each with its own rate-limit bucket.
Catalog metadata supplies the recording and duration. Provider candidates precede site candidates;
exact LRCLIB results are included, instrumental markers are excluded from alignment words, and
already timed versions are marked. Shared request/response types live in `packages/shared/lyricSync.ts`.

Candidates use SHA-256 IDs bound to the ref, cleaned words, script and private provenance. A cold
instance re-fetches canonical candidates before matching the ID; the 24-hour memory cache is an
optimization, not a required cross-request session. Public candidates show "Found online" and no
source URL. Submission accepts times only, checks exact word count, finite monotonic times within
the catalog duration, confidence >= 0.7 and >= 70% completely non-filler lines. All selected versions
are validated before writes. Enhanced LRC preserves word starts and ends; existing higher-confidence
versions survive. Three distinct reports hide a script; duplicate reports do not count again.

Owner clarification during implementation: retain scraped words as the plain Now Playing fallback
so Mozhiye does not become empty while alignment is being built. Unsynced site words are excluded
from Other lyrics. The normal live fallback was rechecked: Mozhiye returns 56 lines.

Additional owner corrections:

- Plain auto-scroll resumes from the position the listener scrolled to, at the same reading speed;
  seeking explicitly resets that reading anchor. Implemented on web and phone. A further owner
  correction removes the original three-second hold: web resumes on scroll-end (120 ms idle
  fallback), and phone resumes after drag/fling settles. An explicit pause-chip choice stays paused.
- Player title and artist credits each remain one line. Overflow loops left to right; reduced
  motion keeps a static ellipsis. Existing artist links stay usable.

Verification: root typecheck, lint, test and production build passed. The new API/service regressions
passed (31 tests across the focused files before the final bounded-lookup adjustment; its affected
route/service files were rerun afterward, 26 passing). Mobile secret scan, lint (79 warnings, no
errors), typecheck and 94 suites / 790 tests passed. Browser checks covered all four required widths,
one-line credits, restored scraped words, manual-scroll continuation and seek reset; captured error
log was empty and viewport overrides were reset. No native Android UI proof, production deployment,
real alignment run, commit or push was performed.

Still pending: MMS download/cache and worker, romanization/CTC, the sync/preview/approval screen,
owner moderation UI and song share links. API tests use synthetic timing; they do not prove real
song alignment or live Convex persistence through the future sync screen.

The immediate-resume correction was checked in the in-app browser: after Page Down, the chip
returned to following in 649 ms including the native page-scroll animation, and a later observation
showed continued movement from the new position instead of returning to the proportional target.
