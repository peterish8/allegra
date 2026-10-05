# Decisions

Choices that are easy to undo by accident. Each says what was decided, why, and what would change
it. Newest first. Mistakes that led to some of these are in `.planning/LEARNING-LOG.md`.

## 2026-10-05

### Spotify transfer uses PKCE and no client secret
**Decided:** OAuth Authorization Code with PKCE; only the public `SPOTIFY_CLIENT_ID` is configured.
The client secret is never stored anywhere.
**Why:** PKCE replaces the secret with a one-time proof per sign-in, so there is no long-lived
credential to leak. Refresh tokens work the same.
**Changes if:** Spotify stops issuing refresh tokens to PKCE clients.

### Spotify sync adds exact matches only; daily runs are bounded and resumable
**Decided:** a sync step reads 50 rows, adds exact catalog matches, records a receipt per Spotify
track and checkpoints after the library write is acknowledged. The daily job (Convex cron → API)
works until a 45 s budget, answers `{ more }`, and Convex calls again up to 40 times. A playlist whose
`snapshot_id` has not changed since its last finished scan is skipped.
**Why:** receipts make retries and overlapping runs safe; the budget keeps each call well inside the
function limit; the snapshot check makes an idle daily run nearly free.
**Changes if:** a review screen for "close" matches is added to sync.

### "Exact" means same title, a shared artist and a matching length
**Decided:** same normalised title, an artist credited on both sides, length within 5 s, the same
release kind (live, remix…) and albums that agree (equal, or one name contained in the other).
The same lead artist alone also counts when no length is known.
**Why:** Spotify credits composers first, Saavn often only the singer; requiring the same lead
dropped most Indian film songs. Length is what tells two recordings apart.
**Rule:** any change to scoring bumps the cache key in `importMatch.ts` (now `import-match-v3`).

### Import review starts with only exact matches ticked
**Decided:** "close" matches start unticked; a "Tick all" button covers bulk acceptance.
**Why:** a pre-ticked close match imports a different recording unless someone notices.

### Surfaces are clear frosted glass
**Decided:** cards on Home, Import, Spotify and Blend are clear glass: a 16% white hairline, a lit
top edge, `backdrop-filter: blur(22–26px) saturate(150%)`, and at most a faint white sheen. No dark
veil, no grey fill. Floating sheets (dialogs) keep a solid veil so text over anything stays readable.
**Why:** the owner wants the moving background glow visible through the surface.

### Home opens with a greeting, a top pick and a shortcut grid
**Decided:** a short greeting (no marketing headline or paragraph), one large "Top pick for you"
card beside a 2×4 grid of cover tiles. The cover under the pointer faintly tints the glow behind
(`HOVER_GLOW_OPACITY` in `HomePage.tsx`, 0.14).
**Why:** Spotify's shortcut grid and Apple Music's top-pick card are what listeners recognise; the
old hero repeated the featured song and filled the space with copy.

### Blend is drawn as overlapping lights
**Decided:** one glowing orb per member, overlapping more the higher the match (`BlendStage.tsx`),
the match number inside the overlap; a dashed empty orb while waiting for a friend; songs carry a
stripe in the colour of whose taste they came from; a sliding lens filters by member.
**Why:** it shows what a Blend is (two tastes meeting) instead of a standard header and list.
Orbs move by transform only and stand still under reduced motion.

### Members get distinct, bright colours inside a Blend
**Decided:** six bright tokens (`--wave`, `--tone-sky`, `--tone-coral`, `--tone-lilac`,
`--tone-mint`, `--tone-amber`). A member keeps the colour their id hashes to unless someone who joined
earlier has it (`lib/blendTones.ts`), shared through `BlendTones` context so discs, orbs and stripes agree.
**Why:** the old set included near-black tokens under dark initials, and two members could match.

### Icon-only controls where the action is obvious
**Decided:** the Spotify panel's Sync and Refresh, and Blend's Play / Invite / Leave, are round icon
buttons. The words stay in `aria-label` (and `title` on web).

### Every phone build gets a new version number
**Decided:** anything reaching `main` that rebuilds the APK bumps `expo.version` in
`apps/mobile/app.json` in the same change. See `CLAUDE.md` → Commits.
