# LEARNING LOG

> **Learning & Growth is a named judging criterion.** This file is scored material.
> Fill it in at every checkpoint. It cannot be honestly reconstructed the night before — and a reconstructed one reads exactly like a reconstructed one.

One entry per person per checkpoint. Two minutes each. Specific beats profound.

---

### Template
```
## T+__ — <name>
**Did:** 
**Learned:** (something you didn't know this morning)
**Stuck on:** 
**Would do differently:** 
```

---

## T+0 — kickoff

**P1:**
**P2:**
**P3:**
**P4:**

---

## 2026-09-21 — Sing / AWS Batch (team)

**Did:** Replaced Scarleta karaoke with AWS Batch Spot dual-stem Sing on `fe/karaoke-aws`; deleted `fe/karaoke-scarleta`; wrote decisions + deploy docs; updated `.planning` so “visual-only karaoke” is no longer the story.

**Learned:** Keeping `KaraokeService` + the claim/dedupe seam mattered more than swapping HTTP providers — concurrency safety and “generate once” live above Scarleta/Batch. Also: an infra test that bans `@aws-sdk/*` forced an explicit allowlist for Batch+S3 only, instead of silently violating the hand-rolled SigV4 rule elsewhere.

**Stuck on:** Live GPU E2E (quota + CFN deploy) — left as human follow-up; agent session was code+CFN only.

**Would do differently:** Encode job identity in Batch parameters from day one (not only an in-memory map) before the first restart during polling.

Canonical: `docs/karaoke-aws-decisions.md`.

## Next dev served 404 for every route, including `/`

**What happened:** after running `next build` to inspect the Vercel output, `next dev` in the same
directory answered `404` with an empty body for `/`, `/discover`, everything. The app directory was
intact and the build had just succeeded, so it read like a routing or config bug. It was neither:
`.next/` held production build artifacts, and dev mode read them instead of compiling.

**The fix:** `rm -rf apps/web/.next`. Two racing `next dev` processes (one left over from another
terminal, which had silently taken port 5174) made it look intermittent on top of that.

**What it cost:** most of an hour chasing `turbopack.root` and the optional catch-all route, both of
which were fine.

**Would do differently:** treat "every route 404s, including the root" as a stale-artifact symptom
rather than a routing one — a real routing bug almost always spares `/`. Clear `.next` and confirm
exactly one dev server before reading any config.

---

## 2026-10-05 — Blend, import and Spotify transfer: what went wrong

Each of these shipped, or nearly shipped, looking finished. Rules distilled from them are in
`CLAUDE.md` ("Before you call it done"); the choices they led to are in `docs/decisions.md`.

**1. A whole feature returned 404.** `routes/spotify.ts` was written, tested in isolation and
documented, but never mounted in `app.ts`. Nothing failed: unit tests called the service, not HTTP.
*Fix:* mounted it, plus a supertest that hits `/api/spotify/status` and expects 401, not 404.
*Rule:* a new router ships with one request-level test through `createApp`.

**2. The API would not compile on a clean checkout.** `apps/api/src/shared/spotify.ts` was missing:
the shared file existed in `packages/shared` but `npm run sync:shared` had not been run.
*Rule:* any edit under `packages/shared` is followed by `npm run sync:shared` and a root typecheck.

**3. Spotify's 2026 Web API is not the one in tutorials.** Three silent differences:
the playlist list no longer reliably carries `tracks.total` (renamed `items`, often missing), so every
playlist read "0"; the `/playlists/{id}/items` page has no `snapshot_id`, so "playlist edited mid-scan"
detection never fired; and in development mode a playlist you don't own answers 403.
*Fix:* counts from `/playlists/{id}/items?limit=1&fields=total`, snapshot from the playlist object,
a plain 403 message. PixelPlayer (`aclones/PixelPlayer/.../SpotifyApiClient.kt`) had already solved
the count; reading a working client first would have saved a round trip with the owner.

**4. "Daily sync" synced 50 songs a day.** The daily hook ran one 50-row step per playlist, so a
500-song playlist took ten days and new songs waited for the scan to wrap.
*Fix:* steps run until a 45 s budget, the API answers `{ more }`, Convex calls again (max 40 rounds),
and an unchanged `snapshot_id` costs nothing.

**5. The daily switch looked broken.** It only re-checks playlists synced once; the owner turned it
on without syncing anything, and nothing happened. Production logs (`vercel logs`) showed no
`/api/spotify/sync` call at all, which settled it in one query.
*Rule:* read the production logs before theorising about a user-reported failure.

**6. Matching rejected most Indian film songs.** "Exact" required the same *lead* artist; Spotify
lists the composer first ("Mithoon, Arijit Singh"), Saavn often only the singer. Sync auto-adds only
exact matches and has no review screen, so those songs were silently dropped.
*Fix:* same title + a shared artist + a length within 5 s is exact. The match cache key was bumped
(`import-match-v3`), otherwise 30 days of old "close" results would have survived the fix.
*Rule:* changing a scorer means bumping its cache key.

**7. Hard-coded production URLs.** The OAuth callback redirected to `allegravibe.vercel.app/import`
even in local dev. *Fix:* derive the return page from `SPOTIFY_REDIRECT_URI`'s origin.

**8. Sign-in lost the page you were on.** `signIn('google')` had no `redirectTo`, so following an
invite link while signed out ended on the home page and the invite was gone.
*Fix:* pass the current path; Convex's redirect allow-list already accepted same-site paths.

**9. A message that never showed.** The web panel set "Spotify is connected" from `?spotify=` and the
account effect cleared it in the same render, because `refresh()` calls `setMessage('')`
synchronously. *Fix:* declare the URL-result effect after the account effect and gate it on the account.

**10. Convex was quietly behind the code.** The local site threw `Could not find public function for
'connect:disconnect'`: the dev deployment had never been pushed, and `_generated/api.d.ts` had been
hand-edited to make types pass. *Fix:* `npx convex dev --once` (pushes and regenerates).
*Rule:* never hand-edit `convex/_generated`; push dev after any `convex/` change.

**11. A glow that ignored its opacity.** The hovered-cover glow had `opacity: 0.18` in CSS, but
`motion`'s `animate={{ opacity: 1 }}` writes an inline style that wins, so every "tone it down" edit
did nothing. *Fix:* the target opacity lives in `animate`.

**12. Unreadable member discs.** Three of the six disc colours were near-black tokens
(`--accent-deep`, `--field-*`) under dark initials, and two members could hash to the same colour.
*Fix:* six bright tones and per-Blend assignment (`lib/blendTones.ts`).

**13. A lonely Blend deleted on schedule.** The sweep timed "nobody joined" from `createdAt`, so a
months-old pair that dropped to one member was deleted the next night.
*Fix:* `waitingSince`, set when a Blend becomes (or is re-invited as) one member.

**14. "Close" import matches were pre-ticked**, so a different recording imported unless someone
noticed. Only exact matches start ticked now; a "Tick all" button keeps bulk review fast.

**15. A phone release that looked like no release.** `apps/mobile/app.json` stayed `1.0.7`, so
About → Updates offered "1.0.7" to people on 1.0.7. Now a rule in both CLAUDE.md files.

**16. Design misreads cost three rounds.** "Frosted glass" meant *clear* glass showing the moving
backdrop, not a dark veil; "less vibrant" needed a real opacity change (see 11). Asking which
element, or sharing a screenshot before polishing, would have been faster.

**Would do differently:** before reporting a feature finished, hit it live: the route, the
deployment, the device. Every item above passed unit tests.

---

---

> **Good entry:** "Learned that a proxy returning 200 instead of 206 makes an audio element unable to seek at all — the browser needs a byte-range to seek within. Took two hours to find because playback itself looked perfect."
>
> **Weak entry:** "Learned a lot about AWS today."
>
> The good one is a story you can tell on camera. The weak one is filler.
