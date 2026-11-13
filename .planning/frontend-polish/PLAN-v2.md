# Frontend polish plan v2 (2026-11-13)

Supersedes `PLAN-v1.md` (kept unchanged). Frontend only: `apps/web` and the `apps/mobile` UI layer. No API,
Convex, desktop or playback-engine changes. Desktop picks up web changes because it wraps the live site.

**Evidence base.** Web: local checkout `7c085d73` (its `apps/web` is identical to local `origin/main` `bf78a9a9`).
Mobile: local `origin/main` `bf78a9a9` (LuvLyrics **1.60.0**). The current branch still has 1.50.0, so do not read mobile
from the working tree. A dry-run fetch shows remote `main` is now at `cf662478`, which this review has not read. Counts
come from grep over source. They are proxies: "inferred" marks anything that comes from reasoning, not a run. No
server, emulator or browser was started.

---

## 1. Executive summary

**What v1 got wrong or left out**
- Mobile is not a blank slate. The 2026-11-04 mobile polish plan (`.planning/mobile-ui-review/FRONTEND-POLISH-PLAN.md`,
  Waves 1–7) is partly shipped. Wave 1 (physics, `TactileRow`, haptics vocabulary, `Sheet`) is done. Waves 3, 5, 6 and 7
  are partial, and the design guards track what remains. The 2026-11-13 handoff's items 2–5 (one song menu,
  pull-down playlist search, scan result card, finger-tracked cover flip) landed in `bf78a9a9` (1.60.0). PLAN-v2 picks up
  those plans where they stopped and does not restart them.
- Web carries most of the untracked debt. The web guard (`apps/web/src/lib/motionGuards.test.ts`) reads only
  `global.css`, which is inside `@layer legacy`. The live rules are in unlayered `app.css` (7,939 lines), `dj.css` and `blend.css`,
  and nothing checks them.
- Three web defects matter more than restyling:
  - (1) Inferred: the site-wide reduced-motion collapse sits inside `@layer legacy`, so every unlayered `animation` or
    `transition` overrides it.
  - (2) The web LuvLink page uses about a dozen custom properties that are never defined (`--text-primary`,
    `--motion-duration-fast`, …), so its colours and transitions are broken.
  - (3) `--transition-fast` and `--transition-base` animate `box-shadow`, which CLAUDE.md rule 5 bans.
- Phase 0 in v1 is not runnable as written:
  - `interface-craft` is not installed anywhere (checked `~/.claude/skills`, `~/.codex/skills` and `~/.agents/skills`).
  - The craft scripts have no `node_modules` and no Windows Chrome path.
  - `sim.sh` is iOS-only. The Android replacement is in §7.
  - No `OPENAI_API_KEY` or `FAL_KEY` is set (checked by name only, in the shell env, the user env and the repo `.env*` files).

**Recommendation**
1. Guards before restyling: build web CSS ratchets that mirror mobile's `designGuards`.
2. Web first for system fixes: tokens, reduced motion, LuvLink, hit areas.
3. Mobile in parallel, only in packages that own disjoint files. Player files go last, and the player probes run on them.
4. Keep every owner decision on the keep list in §3. Unslop only produces a list of candidates for the owner.
5. Run unreasonable-craft as "craft-lite" (its verification and critique method) on one web surface.
6. Drop the marketing phase.

**Top 5 risks** (full register in §10)
1. A stale base: mobile changes quickly, and remote main has moved past what was reviewed.
2. A skill default undoes an owner decision.
3. A polish edit regresses a playback invariant in a player file.
4. Consolidating CSS tokens or layers changes computed styles across the whole site.
5. Phone, low-end and TalkBack evidence stays pending, so "done" gets claimed early.

**First week** (detail in §12)
- Day 1: sync and the capture harness.
- Day 2: a read-only audit with captures.
- Day 3: guard PRs, web and mobile in parallel.
- Day 4: the web token consolidation PR, alone.
- Day 5: web reduced motion plus web AuthDialog focus, and mobile Settings started.

---

## 2. Reconciliation with existing plans

| Document | Status found | PLAN-v2 relation |
|---|---|---|
| `mobile-ui-review/FRONTEND-POLISH-PLAN.md` (11-04) | W1 done (`components/allegra/physics.ts`, `TactileRow` in `motion.tsx:137`, `utils/haptics.ts:34-42` tap/toggle/commit/success/refuse). W2 mostly done (bottomPad baseline 0; long press unified in 1.52/1.60). W3: 73 bare pressables left. W4: 1 slide modal, 3 Alert questions, `CustomAlert`/`ModernDeleteModal` still used. W5.10 not done (`TimelineScrubber.tsx:228-229`, `YtMiniPlayer.tsx:38-46`). W6: 18 candidate files with no reduced-motion reference. W7: colour/weight/tracking ratchets open | **Depends on and continues it.** M1–M9 below finish W3, W4, W5.10, W6 and W7 by file group. Its owner decisions §"Decisions for the owner" 1–5: check which were answered before touching DJ/LuvLink naming |
| `HANDOFF-2026-11-13-mobile-integration-and-playlist-polish.md` | Items 1–5 appear landed in `bf78a9a9` "one song menu, pull-down playlist search, scan result card, finger-tracked cover and native playback controls (1.60.0)". Not device-verified per its own §10 | Do not redo. Treat its §13 defaults as answered by what shipped. Device proof stays pending |
| `HANDOFF-2026-11-12-player-create-transition.md` | Superseded: PR 86 merged the player transition (1.52.1). `CoverGhost.test.ts` and `usePlayerSheetMotion.ts` exist on main | Player transition is out of scope except verification. Its open item 5 (CoverGhost layout animation versus rule 5) is checked in M2 |
| `.planning/web-player-ytm/HANDOFF-2026-11-11…` | Inferred landed: `feat/web-player-ytm-style` was merged into `chore/integrate-unfinished-work` (`4108e095`), and `a6e506be feat(web): simplify the player bar and cover atmosphere` is on main | Web player and listening room are owner-approved. Polish only, no redesign. Lyric line-wrapping stays untouched (owner rejected) |
| `IMPLEMENTATION-STATUS.md`, `VERIFICATION-MATRIX.md` | Physical phone, 200% text, TalkBack and frame timing all "Pending" | PLAN-v2 needs the same evidence and records it there, not in a new ledger |
| `audit/FIX-BACKLOG.md` frontend items | A11Y-001 open (`AuthDialog.tsx` has no focus handling). FE-006 open (`CollectionPage.tsx:122` "Loading…"). PERF-001 open (`App.tsx:19-54` static page imports). AND-006 and AND-007 open (native views). FE-001/002/003/005 appear fixed by #75/#82/#83 (inferred from commit subjects) | A11Y-001 → W7, FE-006 → W6, AND-007 → M10. PERF-001 and AND-006 are performance work: listed as dependencies, not done here |

---

## 3. Keep list (owner decisions a polish pass must not undo)

| # | Keep | Source |
|---|---|---|
| K1 | Clear frosted glass (backdrop blur showing the moving glow). Never a grey or black veil on cards. Dialogs keep a solid veil | memory `design-taste-clear-glass`; `docs/decisions.md` "Surfaces are clear frosted glass" |
| K2 | Ambient glow, shader wash and cover-colour atmosphere stay on web and mobile. On weak phones, cut pixels and fps, never switch it off | memory `low-end-perf-glow-decision`, `unslop-ui-polish-direction` |
| K3 | Web: chartreuse `--wave #d9e66a` is the action colour. Coral `--accent` is the documented supporting warmth (`DESIGN.md` §1). Lime was kept in the 11-01 unslop run | `DESIGN.md`; memory `unslop-ui-polish-direction` |
| K4 | Mobile: white is the only accent (`Signal.wave` is now `#F4F4F5`, `allegraTheme.ts:10`). No green anywhere | `apps/mobile/DESIGN.md` "Owner requests 2026-11-06" |
| K5 | Icon-only buttons where the action is obvious, with the words in `aria-label`/`accessibilityLabel` | `decisions.md` "Icon-only controls" |
| K6 | Home: a plain title ("For you", not a greeting), a top pick, a shortcut grid | `decisions.md`; memory `unslop-ui-polish-direction` |
| K7 | Android: neat and plain. One subtle glow, no stacked glows or blobs, idle loops, one-off palettes, mascot flourishes or cute copy | memory `unslop-ui-polish-direction` (11-05) |
| K8 | Mobile structure: Stream, Search, Library, Create. Profile menu top left. Spotify-position shell. Stream order (moods, Jump back in, Quick picks, one Made for you shelf) | `apps/mobile/DESIGN.md` 1.42–1.44; memory `mobile-redesign-direction-approved` |
| K9 | Player: Apple Music layout, Echo sheet physics, YouTube Music lyric glide (no per-line springs), the PR 86 transition, no vinyl, no live blur under the dragged sheet or on the tab bar | `apps/mobile/CLAUDE.md` Rules |
| K10 | Web player: the calm YouTube Music bar, karaoke in the bar, cover-colour wash. Do not touch lyric wrapping | memory `web-player-ytm-handoff` |
| K11 | DJ mascot as specified (glass orb). Blend orbs and member tones | `decisions.md` 10-09, 10-05 |
| K12 | Sentence case, no emoji, no sparkles or "magic", SF Pro via `fontWeight` only (mobile), 400/600/700 only | `apps/mobile/CLAUDE.md`; `DESIGN.md` §9 |
| K13 | No session replay SDKs | root `CLAUDE.md` |

**Unslop "direction" (five lines), from the 11-04 mobile plan, extended to web.** Product: plays your songs and the
catalog's, with lyrics that move with the voice, across your devices. Character: night-time, close, unhurried.
World: a dark room lit by the record that is playing. Moment: the cover (its wash, canvas, glow) and the sung line.
Signature: the cover's two tones tinting the glass it sits under. Concept check: every later choice must leave the cover
as the only light source.

---

## 4. Skill versus Allegra: resolution table

| Skill default (section) | Conflicts with | Resolution |
|---|---|---|
| unslop §Color "delete colored glows… blobs behind content"; signs.md "Glass cards… frosted glass over a flat background → plain surface" | K1, K2 | Glass and glow stay. Apply unslop's own test ("Materials must earn themselves": something meaningful behind) only to *produce a list* for owner review. Never delete without a yes |
| unslop §Color "one accent" | K3 (web has chartreuse plus coral) | Two documented roles stay. No *new* coral in chrome. Unused accent tokens (`--gradient-accent`, `--gradient-hero`: 0 uses) may be deleted |
| unslop §Run it step 4 "show audit and direction, wait" | Owner authorised integration and merges (11-13 handoff §4) | That authorisation covers mobile integration, not visual or copy changes. Copy rewrites (W5) and loop removals (W8) wait for a yes. Mechanical token and guard work does not |
| unslop §Type "mono for quiet labels" (signs.md Components) | Mobile rule "no monospace as decoration" | Mobile: no mono. Web: existing mono eyebrows stay, with no new ones |
| ux-animation §3 curves `cubic-bezier(0.32,0.72,0,1)` etc.; polish §Motion "spring duration 0.5 bounce 0" | Root rule 6: every duration and easing from a token | Use tokens only (`apps/web/src/motion/index.ts`, `tokens.css`, mobile `Motion`). If a skill curve is needed, add it as a named token in its own PR. Mobile already has `Motion.ease.morph` = that curve |
| ux-animation §3 "hover or color → ease 150ms"; polish details "Hover ~150ms" | Root rule 5 (transform/opacity only; bans width/top/height/box-shadow by name). `docs/motion-design-system.md` §1 says color is never animated, but `tokens.css:137-139` animates color, and `motionGuards.test.ts` allows it | **Proposed default (owner Q4):** web allows `color`, `background-color` and `border-color` at 100–160ms on hover and press. No `box-shadow` or `filter` transitions. Mobile animates no colour (overlay opacity, as `TactileRow` does). Record the result in `docs/decisions.md` |
| polish §Details "Press scale(0.96)"; ux-animation "rows change background" | Mobile `Tactile` 0.94 and `TactileRow` 0.985 + overlay | Keep the library values. Do not retune per screen |
| polish §Details "Hit area ≥44 touch / ≥40 desktop" | Mobile DESIGN §2: 48 dp. Web DESIGN §7: 44px | Mobile 48 dp (IconButton visual 36/40/44 inside 48). Web: 44px for touch, and the visual may be smaller via a `::after` extension |
| AGENTS.md "no new glass buttons" (mobile) | unslop or craft adding material | Mobile `Button` variants only (primary/secondary/plain/danger). Web glass buttons are the documented web recipe |
| unslop §9 "delete looping pulses, breathing glows, parallax" | K2 (ambient shader), DJ mascot breathing (K11) | Shader/aura and the mascot stay. Loops *not* on the keep list are candidates (W8: `app.css:2020-2046` four 42–80s orbit layers, `DjTour.tsx:134` floating notes). The owner decides |
| unslop §8 "the moment"; craft §1 "3+ directions, creative risk" | K7 "neat, cut over-creative extras" (Android); owner approval loops | No new moments on mobile. Web: craft-lite on one surface (P6), with directions shown to the owner as captures before any code |
| craft "Load interface-craft every time"; critique.md uses its `design-critique.md` | Not installed | Craft-lite: charles-polish (built partly from Interface Craft) and ux-animation, plus critique.md's own format ("what I see → why it hurts → what it could be"). The report says the letter of the skill was not met |
| craft §2 "generate assets with today's best models" | No keys, K7 | No generated assets in this plan |
| store-screenshots (iPhone 1320×2868, App Store) | LuvLyrics ships as a sideloaded APK; SF Pro is licensed for personal builds only (`apps/mobile/CLAUDE.md`) | Out of scope. No store listing exists, and showing SF Pro in marketing is a licensing question for the owner |
| ux-animation Q1 "no animation for 100+/day actions" | Owner-approved player motion | The player is exempt (K9). Apply the frequency test to new motion only |

---

## 4a. Skill locations (workers must read the named files, not rely on memory of the skill)

Roots: `S` = `C:/Users/nithy/.claude/skills`, `A` = `C:/Users/nithy/.agents/skills`. Copies of the Charles and T3 skills
also exist under `C:/Users/nithy/.codex/skills`; read the `S` copy. Skill names are not guaranteed to resolve in every
harness, so open the file by path. Sections cited elsewhere in this plan (`unslop §Color`, `ux-animation Q3`,
`polish §Details`) are headings inside the SKILL.md named here.

**Design and motion skills (what the polish work applies)**

| Skill | Path | Read | Used by |
|---|---|---|---|
| charles-unslop | `S/charles-unslop/SKILL.md` | `references/signs.md`, `tokens.md`, `visuals.md`, `effects.md` | P1, W3, W5, W8, M5, M7, M8, M9, M11 |
| charles-polish | `S/charles-polish/SKILL.md` | Details table, Motion trees, Verify frame by frame | every package; P5 |
| charles-ux-animation | `S/charles-ux-animation/SKILL.md` | `references/recipes.md`, `techniques.md` (sections the rules point to) | P5, W11, M11, M1, M2, M3, M6 |
| charles-unreasonable-craft | `S/charles-unreasonable-craft/SKILL.md` | `references/verification.md`, `critique.md`; scripts `web-frames.mjs`, `sheet.mjs`, `edges.mjs`, `lib.mjs` (craft-lite only, §4) | P1, P6 |
| unslop-ui | `S/unslop-ui/SKILL.md` | `references/` | P1, W5, M5 (owner's own earlier unslop rules) |
| design-taste-frontend | `A/design-taste-frontend/SKILL.md` | whole | W3, W5, W11 |
| minimalist-ui | `A/minimalist-ui/SKILL.md` | whole | W3, W11, M11 |
| cinematic-ui-motion | `S/cinematic-ui-motion/SKILL.md` | whole | P5, P6 |
| motion-animate-ux-stack | `S/motion-animate-ux-stack/SKILL.md` | whole | P5, W2, M1, M2 |
| micro-interactions | `A/micro-interactions/SKILL.md` | whole | W4, M5, M11 |
| web-animation-design | `A/web-animation-design/SKILL.md` | whole | W2, W8, P5 |
| frontend-design-fidelity | `S/frontend-design-fidelity/SKILL.md` | responsive, long text, loading, errors | W5, W6, W11, M5, P1 |
| curiosity-driven-ux | `S/curiosity-driven-ux/SKILL.md` | whole | P5 (flows only) |
| web-design-guidelines | `A/web-design-guidelines/SKILL.md` | whole | W0, W3, W4, W9 |
| vercel-react-best-practices | `A/vercel-react-best-practices/SKILL.md` | rendering, re-render rules | W5, W6, W11 |
| tailwindcss-mobile-first | `A/tailwindcss-mobile-first/SKILL.md` | whole | W4, W9 |
| accessibility-tester | `S/accessibility-tester/SKILL.md` | focus, names, contrast, targets | W7, W4, M5, M10, P1 |
| expo-react-native-expert | `S/expo-react-native-expert/SKILL.md` | whole | all M packages |
| building-native-ui | `A/building-native-ui/SKILL.md` | whole | M3, M4, M5, M11 |
| vercel-react-native-skills | `A/vercel-react-native-skills/SKILL.md` | list, animation, perf rules | M1, M2, M6, M11 |

**Engineering method skills (how the work is done; the T3 set)**

| Skill | Path | Purpose |
|---|---|---|
| full-send | `S/full-send/SKILL.md` | Autonomous end to end: change, proof, sol-loop, file-pr, babysit, merge at the gate |
| full-stop | `S/full-stop/SKILL.md` | Same work, stop with the PR ready; never merge |
| sol-loop | `S/sol-loop/SKILL.md` | Review the diff with GPT Sol in a bounded loop before filing |
| council | `S/council/SKILL.md` | Three-provider review for the riskiest packages (W1, W2, M1, M2) |
| file-pr | `S/file-pr/SKILL.md` | Concise PR title and body |
| babysit-pr | `S/babysit-pr/SKILL.md` (+ `scripts/pr-wait`) | Watch CI and reviews, fix findings, rebase, report ready |
| leaving-pr-comments | `S/leaving-pr-comments/SKILL.md` | Required attribution format for every PR comment |
| modernize | `S/modernize/SKILL.md` | Rebase an old branch and re-check the idea still belongs |
| takeover | `S/takeover/SKILL.md` | Take over a stalled or failed package, preserving authorship |
| cook | `S/cook/SKILL.md` | Autonomous build-render-critique loop (P6 only) |
| tdd | `A/tdd/SKILL.md` | Test first for guards and logic |
| systematic-debugging, diagnosing-bugs | `A/systematic-debugging/SKILL.md`, `A/diagnosing-bugs/SKILL.md` | Unexplained failures (M12 investigation, flaky e2e) |
| code-review | `A/code-review/SKILL.md` | Local review before filing |
| verifying-agent-work, cross-checking-agent-work | `S/verifying-agent-work/SKILL.md`, `S/cross-checking-agent-work/SKILL.md` | Orchestrator checks a worker's claim against the diff |
| decomposing / parallelizing / executing-agent-work | `S/decomposing-agent-work/SKILL.md`, `S/parallelizing-agent-work/SKILL.md`, `S/executing-agent-work/SKILL.md` | Orchestrator planning and dispatch |
| escalating-agent-models, recovering-agent-failures | `S/escalating-agent-models/SKILL.md`, `S/recovering-agent-failures/SKILL.md` | When a card fails twice |
| resolving-merge-conflicts, git-guardrails-claude-code | `A/resolving-merge-conflicts/SKILL.md`, `A/git-guardrails-claude-code/SKILL.md` | Conflicts and destructive-git protection |
| unslop, writing-guidelines | `S/unslop/SKILL.md`, `A/writing-guidelines/SKILL.md` | PR text, docs and report writing |
| charles-storage-cleanup (Windows port) | `S/charles-storage-cleanup/SKILL.md` | Only if the drive runs low during Android or Gradle work |

Not used by this plan: charles-accent-heroes, charles-store-screenshots, charles-arcade-motion, charles-claude-editing
(marketing and video; §11 D3).

**Run state for the autonomous execution** lives in `.planning/frontend-polish/run/` (orchestration, task cards, ledger).

---

## 5. Surface inventory and first-pass scores

Scores use charles-polish anchors (3 works but generic, 5 designed at rest but states or motion default, 7 every state
designed and motion correct, 8 has one screenshot-worthy thing, 9 holds in every state). They come from reading the code
(states present, token use, guards), **not from renders**, and Phase 1 must confirm them with captures.

### 5a. Web (`apps/web`; one route shell, views from `src/lib/routes.ts`)

| Surface | Main files (lines) | Score | Notes |
|---|---|---|---|
| Shell: rail, header, mini bar, `<audio>` owner | `app/layout.tsx` (51), `app/ClientShell.tsx`, `src/App.tsx` (2443), `styles/app.css` (7939) | 7 | Owner-approved. Seven `:root` blocks across 4 CSS files (`app.css:19`, `components.css:11,2046`, `global.css:1728,1861,2115,2915`) redefine fonts (`tokens.css:148` DM Sans versus `app.css:20` Geist) and `--wave`. Both font families load (`layout.tsx:39`) |
| Home / Discover | `components/HomePage.tsx` (624) | 5 | No shelf skeletons. Copy tells (§6a). **Highest leverage** (first screen) |
| Listening room: player + lyrics | `PlayerPanel.tsx` (1121), `LyricsPanel.tsx` (1167), `PlayheadViews.tsx` | 8 | Signature surface (cover wash, YTM bar). Tabular time present (`app.css:2332`) |
| Search | `SearchResults.tsx` (465), `CommandPalette.tsx` (453) | 7 | Skeleton, empty and error states present. Palette has a focus trap |
| Library | `LibraryPage.tsx` (189) | 7 | |
| Playlist / liked / shared collection | `CollectionPage.tsx` (180) | 5 | FE-006: indefinite "Loading…" (`:122`, `:151`). No error state. No reduced-motion reference |
| Album | `AlbumPage.tsx` (145) | 5 | No empty or error state |
| Artist | `ArtistPage.tsx` (342), `ArtistPreviewCard.tsx`, `ArtistAbout.tsx` | 7 | |
| Settings | `SettingsPage.tsx` (555) | 7 | |
| DJ | `DjPage.tsx` (599), `components/dj/*` (11 files), `styles/dj.css` (1065) | 7 | 17 infinite loops in `dj.css`. `DjTour.tsx:134` floating ♪♫ notes (decisions.md says notes were removed from the DJ) |
| Import / Spotify | `import/ImportPage.tsx` (545), `SpotifySyncPanel.tsx` (329) | 5 | Many error paths, no skeleton |
| Blend | `blend/*` (12 files), `styles/blend.css` (685) | 7 | Documented in decisions.md |
| **LuvLink** | `luvLink/LuvLinkPage.tsx` (137), `LuvLinkSession.tsx` (488), `app.css:7717-7786` | **3** | **Weakest.** Undefined tokens, unicode glyph icons (`LuvLinkPage.tsx:129,133` ↑ ♡ ♪), 38px controls, off-grid values, filler copy ("keep the vibe going") |
| Quick picks preview | `QuickPicksPreviewPage.tsx` (180) | 5 | No empty state, no reduced-motion reference |
| Taste onboarding | `TasteOnboarding.tsx` (324) | 7 | |
| Auth dialog | `AuthDialog.tsx` (234) | 5 | A11Y-001: no initial focus, trap or restore |
| Connect picker | `ConnectPicker.tsx` (352) | 7 | |
| Song share / shared report / legal | `SongSharePage.tsx` (68), `SharedPlaylistReport.tsx`, `LegalPage.tsx` (303) | 5 | Low traffic |
| Info tours | `InfoTour.tsx`, `infoScenes.tsx` | 7 | Audited by `motionGuards.test.ts` |

### 5b. Mobile (`apps/mobile/src` at `bf78a9a9`, 1.60.0)

Signals: `ui` = imports `src/ui`; colour, duration and pressable counts are per file.

| Surface | Main files (lines) | V6 | Score | Notes |
|---|---|---|---|---|
| Now Playing, pill, Up next, lyrics | `screens/NowPlayingScreen.tsx` (1123), `PillPlayer.tsx` (293), `NowPlayingControls.tsx` (738), `NowPlayingLyricsArea.tsx` (404), `player/UpNextPanel.tsx` (499), `SynchronizedLyrics.tsx` (1003) | yes (own system) | 8 | Reference-grade. `UpNextPanel` has no reduced-motion reference. Elapsed/length text has no `tabular` (`NowPlayingControls.tsx:159`) |
| Mini player family | `MiniPlayer.tsx` (1140), `YtMiniPlayer.tsx` (176), `TimelineScrubber.tsx` (381), `MiniScrubber.tsx` | partial | 7 / 3 (Yt) | 34 raw colours and 6 pressables in MiniPlayer. `YtMiniPlayer` springs width/height on the JS thread (`:38-46`, `useNativeDriver: false`). `TimelineScrubber.tsx:228-229` animates height/radius |
| Stream | `StreamScreen.tsx` (579), `stream/StreamHome.tsx` (197), `DiscoveryCollection.tsx` | yes | 7 | |
| Search + scan | `SearchScreen.tsx` (740), `search/*`, `ScanCodeScreen.tsx` (191), `share/ScanResultCard.tsx`, `ScanFrame.tsx` | yes | 7 | 16 raw colours in Search (not in the guard baseline, which counts `color:` keys only). Scan flow not device-verified |
| Library, Playlists, Playlist detail | `LibraryScreen.tsx` (141), `PlaylistsScreen.tsx` (264), `PlaylistDetailScreen.tsx` (667), `playlist/*` | yes | 7 | `PlaylistItem` duration text without `tabular` |
| Create sheet, profile menu, tab bar | `nav/CreateSheet.tsx`, `V6TabBar.tsx`, Kotlin `NativeTabBarView.kt` | yes | 7 | AND-007: labels capped at 130% text |
| Artist, album, releases, collection | `ArtistScreen.tsx` (221), `CatalogAlbumScreen.tsx`, `ArtistReleasesScreen.tsx`, `CollectionScreen.tsx` | yes | 7 (unverified) | Artist has 8 raw colours (guard baseline) |
| **Settings** | `SettingsScreen.tsx` (716), `settings/SettingsKit.tsx` (297), 6 of 7 `settings/*` not on `ui` | partial | **5** | 12 colour baseline, 17 raw colours, SettingsKit 14 colours and 7 font sizes, `letterSpacing` (`:268`), chips 36–42 dp (`:288-295`), no reduced-motion reference |
| Luvs | `LuvsScreen.tsx` (534), `luvs/*` (4 files, none on `ui`) | partial | 5 | `LuvControls.tsx` has 16 raw durations (`:40-165`) |
| Blend | `BlendScreen.tsx` (302), `BlendsScreen.tsx`, `BlendJoinScreen.tsx`, `blend/*` | partial | 5 | Weight baseline 11, `BlendStoryPlayer` 3 pressables |
| **LuvLink** | `LuvLinkScreen.tsx`, `luvLink/LuvLinkPanel.tsx`, `LuvLinkLegacyPanel.tsx`, `LuvLinkHost.tsx` | no | **3** | 9 pressables, `letterSpacing` ×2, 42 dp button |
| Listening stats | `ListeningStatsScreen.tsx` (154), `StatsTop`, `StatsInsights`, `stats/*` | yes | 7 | |
| Lyrics editor | `LyricsEditorScreen.tsx` (441) | no | 5 | `minHeight: 38` (`:406`) |
| Import, cover search, shared playlist | `ImportScreen.tsx`, `CoverArtSearchScreen.tsx`, `SharedPlaylistScreen.tsx` | yes | 5–7 | |
| About / updates | `about/AboutSheet.tsx` (225), `UpdatePanel.tsx` | partial | 5 | Emoji in copy (`AboutSheet.tsx:113` "😉"). 9 font-size literals |
| Legacy modals | `CustomAlert`, `ModernDeleteModal`, `LibraryEditModal`, `LrcSearchModal` (slide, `:117`), `CreatePlaylistModal`, `DownloadQueueModal`, `PlaylistSelectionModal`, `AddToPlaylistModal`, `LanguagePickerModal`, `SongVersionSearchModal`, `LuvsVaultModal` | no | 3–5 | Three confirmation systems still live (`ConfirmSheet`, `CustomAlert`, `ModernDeleteModal`) |
| Widget | `src/widget/*` | yes | n/a | RemoteViews. Out of the polish passes except copy |

**Highest leverage:** web Home, web listening room (already 8, so it is the craft-lite target), mobile mini-player family
(seen on every screen), mobile Settings, web token/reduced-motion system. **Weakest:** web LuvLink (3), mobile LuvLink (3),
`YtMiniPlayer` (3), legacy mobile modals, web Collection/Album unhappy states.

---

## 6. Findings: slop and gaps, with counts

### 6a. Web (`apps/web/src`)

| Finding | Count | Examples |
|---|---|---|
| Rules in `@layer legacy` lose to unlayered `app.css`/`dj.css`/`blend.css`. The reduced-motion blanket is in the legacy layer (inferred cascade bug) | 1 rule, about 120 unlayered transition lines | `global.css:1712-1718` inside `@layer legacy` (`global.css:1`); `app.css:7` comment confirms the layering |
| Infinite loops with no matching reduced-motion override (heuristic selector match) | 6 of 51 | `app.css:2026,2032,2038,2044` (artwork-bg layers, 42–80s), `dj.css:173,462` |
| Custom properties used but never defined | ~11 genuine (plus runtime-set ones still to confirm) | `--text-primary/secondary`, `--surface-base` (`app.css:7717-7783`), `--motion-duration-fast/instant`, `--motion-ease-standard` (`app.css:7728,7786`), `--danger`, `--ease-in-out` (`app.css:1021`), `--music-*` (never set in TSX: verify) |
| Transition tokens include `box-shadow` (rule 5) | 2 tokens, 8 uses | `tokens.css:137-138`; uses in `components.css` |
| `filter` transitions (DESIGN §6: no animated blur) | 4 | `app.css:3140,7793,7809` |
| Raw durations in `transition`/`animation` | 37 | `app.css:93,1723,2001,4245,4255,7793-7809`, `components.css:170` |
| Raw `cubic-bezier` outside tokens | 8 | `app.css:1723,1727,7793,7804,7809`, `components.css:1876` |
| Hover scale not gated by `(hover: hover)` | 29 rules in app.css (16 gates in total) | `app.css:520,808,1691,2318,2788,3501,3646` |
| Icon controls below 44px with no hit extension | ~30 rules | `app.css:1148` (34), `1627` (30), `2302` (38), `2563` (30), `2813` (34), `6387` (26), `7731` (38), `blend.css:525` (24) |
| Font size under 12px | 111 declarations; 32 distinct px sizes | `app.css:1169,1206,2604,2794` (10px) |
| Radius family drift | 31 distinct px radii (DESIGN §4 names about 8) | 2, 3, 5, 7, 9, 11, 15, 23, 25px all present |
| Stacking without a scale | `9999` ×3, `10050`, `1000` | `components.css:123,726,1258,1420`, `app.css:5466` |
| Hex / rgba literals in CSS | 658 / 1,563 | Mostly legacy layers |
| Unicode glyphs as icons, filler copy | 5 | `LuvLinkPage.tsx:129,133`; `DjTour.tsx:134` |
| Charming or duplicated copy | ~6 | `HomePage.tsx:382` "Shaped by what you love", `:460` "What everyone has on", `:463` "Somewhere new to wander", `:268-269` eyebrow "Picked for you by …" over "Made for you" |
| Docs drift | 3 | `tokens.css:5,33` ("aqua accent" is coral); `app.css:1-3` ("white rounded panel, coral banner"); `docs/motion-design-system.md` §1 "cool blue studio" and different token values |
| Guard coverage | `motionGuards.test.ts` checks only `global.css` and 8 TSX files | No CSS ratchet. No 360px e2e (the `mobile` project matches `mobile.spec.ts`, which does not exist) |

TSX is disciplined: 4 duration literals (all `duration: 0` under reduced motion), and 40 of 42 Motion files reference reduced
motion (missing: `blend/BlendsPage.tsx`, `LegalPage.tsx`).

### 6b. Mobile (`apps/mobile/src`, outside `ui/` and `components/allegra/`)

| Finding | Count | Tracked by guard? |
|---|---|---|
| Bare `Pressable`/`Touchable*` | 73 in 33 files | yes (`pressable` baseline) |
| Slide modal | 1 (`LrcSearchModal.tsx:117`) | yes |
| Weights 500/800/900 | 16 in 7 files | yes |
| `letterSpacing` | 3 (`LuvLinkPanel.tsx:181,190`, `SettingsKit.tsx:268`) | yes |
| Alert with buttons | 3 (SpotifySyncPanel, BlendScreen, SearchScreen); 11 `Alert.alert` in total | yes (buttons only) |
| Raw colours, `screens/` `color:` keys | 29 in 7 files | yes |
| Raw colour literals anywhere outside the library | 395 | **no** |
| `fontSize` literals in components | 260 | **no** (the guard covers screens only, baseline empty) |
| Duration/stiffness/damping literals | 63 | **no** (MiniPlayer only) |
| Animated files with no reduced-motion reference | 18 (list in Appendix A) | **no** |
| Layout-property animation | 2 files (`TimelineScrubber.tsx:228-229`, `YtMiniPlayer.tsx:38-46`) | **no** |
| `tabular-nums` | 10 uses; missing on `NowPlayingControls` time and `PlaylistItem` | **no** |
| Touch targets under 48 dp | `SettingsKit.tsx:288,289,295` (38/42/36), `LuvLinkPanel.tsx:183` (42), `LyricsEditorScreen.tsx:406` (38) | **no** |
| Files not on `src/ui` | 77 of 145 (player 17/22, settings 6/7, luvs 4/4, connect 4/5) | n/a (player exempt by K9) |

---

## 7. Phase 0 prerequisites, resolved

| Item | Finding | Resolution |
|---|---|---|
| `interface-craft` skill | Not on disk anywhere. `design-an-interface` and `syncvas-frontend-craft` are different skills. `apple-design`, `animate` and `emil-design-eng` are also absent | Owner Q5. Default is craft-lite (§4) |
| Craft scripts (`charles-unreasonable-craft/scripts`) | `package.json`: `playwright-core 1.63.0`, `sharp 0.35.5`. No `node_modules`. Node 24.18 OK. ffmpeg present (WinGet). `lib.mjs:40-47` lists only macOS/Linux Chrome paths | With owner OK: `npm install --prefix "C:\Users\nithy\.claude\skills\charles-unreasonable-craft\scripts"` (writes outside the repo). Set `CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"`, or Edge at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| Edge versus bundled Chromium crash (memory `worktree-junction-gotchas`) | `web-frames.mjs` launches `executablePath`, so with `CHROME_PATH` set it never uses bundled Chromium. Its SwiftShader flags (`lib.mjs:54-57`) make the WebGL shader render in software: slow, still correct for stills | Always set `CHROME_PATH`. For e2e, `E2E_CHANNEL=msedge` (or `chrome`) as `tests/e2e/playwright.config.ts:13-16` documents |
| Web capture target | Must be `http://localhost:5173`, never `:8080` (CSP). `next dev` cannot run from a junction worktree | Capture from the main checkout `C:\dev\allegra`, or widen the Turbopack root locally and never commit it (memory). Use `--scheme dark` (the app is dark-only) at `--widths 360,768,1280,1920`, then again with `--reduced-motion`. Unverified: `page.clock.install()` may interfere with audio and Convex sockets, so use `--trigger click:<selector>` for player motion |
| `sim.sh` (iOS only) | adb at `...\WinGet\Packages\Google.PlatformTools...\adb` and `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`. scrcpy absent. mobile-mcp tools available | **Android equivalent:** still: `adb exec-out screencap -p > shot.png`. Motion: `adb shell screenrecord --bit-rate 20000000 /sdcard/rec.mp4` (stop with `adb shell pkill -INT screenrecord`, max 180s), then `adb pull /sdcard/rec.mp4`, then `node <skill>/scripts/sheet.mjs rec.mp4 sheet.png --auto --fps 60` (screenrecord is variable-rate; sheet.mjs resamples). Measure with `edges.mjs --scale <density/160>`, using `adb shell wm density` (e.g. 420 → 2.625). States: `adb shell settings put system font_scale 2.0` (200% text), `adb shell settings put global animator_duration_scale 0` plus transition and window scales (Remove animations). Restore to 1.0 afterwards. TalkBack on the owner's phone is switched on by the owner. Emulator cannot decode HEVC canvas video |
| Accent heroes / store screenshots | No `OPENAI_API_KEY` or `FAL_KEY` found. Python numpy/requests/Pillow/playwright present. `heroes.py` word check needs macOS (`ocr.swift`). On Windows use `python -I`, not the `python3` stub | Phase dropped (§11 D3) |
| Repo gates | Root: `npm run typecheck`, `npm run lint`, `npm test` (includes `convex:test`; never overlap with `npm run mobile:check`). Web unit tests: `npm test --workspace apps/web` (`src/lib/*.test.ts` only, so web guards must live in `src/lib`). E2E: `npm run e2e` (starts or reuses `npm run dev`). Mobile: `npm run mobile:check`; CI builds the APK and runs the launch gate and player probe | Per package in §8 |
| Worktrees | Junction `node_modules`; `git worktree remove` once wiped the main checkout | One worktree per package if parallel. `cmd /c rmdir` the junctions before removal. Never run two Gradle builds at once |

---

## 8. Work breakdown

Packages own **file sets**, so two writers never touch the same file. Each one applies every rule (pressable,
tokens, reduced motion, transform-only, targets, tabular, copy) to the files it owns. Size: S < 1h, M about half a day, L a day or more.
Every PR: conventional commit, no AI footer, regression test, and root gates green. Mobile PRs bump `expo.version` patch
(feature: minor) **at merge time**, after a rebase, because parallel bumps collide. Desktop untouched.

### Phase 0: sync and setup (S, owner present)
- **P0.1 Rebase target.** Fetch. Diff `bf78a9a9..origin/main` for `apps/mobile/src` and `apps/web`. Re-run the counts in
  Appendix B. Update §5 and §6 if anything moved. Ask who is working on mobile now (Q7). Done when the counts are
  re-recorded against the fresh main SHA.
- **P0.2 Capture harness** (§7). Done when one web still at 360 and one Android still exist in
  `.planning/frontend-polish/captures/` (gitignore the PNGs or keep them small).
- **P0.3 Owner questions** Q1–Q7 sent once. Defaults apply if there is no answer.

### Phase 1: baseline audit, read-only (M)
- Capture every web view (routes in §5a, including signed-out, empty library, error by going offline) at
  360/768/1280/1920, plus reduced motion. Capture Android Stream, Search, Library, Playlist, Now Playing (cover, lyrics,
  Up next), Settings, Luvs, LuvLink, Create, profile menu, at 1.0 and 2.0 font scale.
- For each surface: unslop audit (`signs.md`, one line per sign), polish score with the weakest thing named, and the
  ux-animation interaction list (trigger, frequency, what it tells).
- Lighthouse on the **Vercel preview of `main`** (no local server): Home at mobile and desktop, recording Performance,
  LCP, CLS, INP and accessibility.
- **Output:** `.planning/frontend-polish/AUDIT-<date>.md` with the confirmed scores and a ranked list. No code.

### Phase 2: guards first (no visual change)

**W0 Web CSS ratchet** (M). Branch `test/web-css-guards`. Files: `apps/web/src/lib/motionGuards.test.ts`, new
`apps/web/src/lib/cssGuards.test.ts`, new `cssGuards.baseline.json`.
- Rules per CSS file: raw ms/s in `transition`/`animation`; raw `cubic-bezier`; `transition` on
  `box-shadow|filter|width|height|top|left|margin|padding`; `:hover` with a transform outside `(hover: hover)`;
  `font-size` under 12px; `z-index` of 1000 or more; hex/rgba outside `tokens.css`.
- Hard zero, no baseline: custom properties used but never defined (allowlist the runtime-set ones by name with a reason).
- Also point `motionGuards` at `app.css`, `dj.css`, `blend.css` and `components.css`, not only `global.css`.
- Mobile-style ratchet: a file may not rise, the baseline only falls, and `UPDATE_CSS_BASELINE=1` rewrites it.
- Skills: polish §Details (Hover, Stacking, Contrast), ux-animation §Verify "Properties".
- Verify: `npm test --workspace apps/web`, `npm run lint`, `npm run typecheck`.
- Test: the guard must fail on a scratch rule `transition: box-shadow 200ms` and on an undefined var.
- Parallel: yes, with M0.

**W0b 360px e2e** (S). Same PR or `test/web-mobile-e2e`. New `tests/e2e/mobile.spec.ts`. The config already
routes it to the Pixel 7 project at 375×812. Asserts:
- each top route renders without a page error;
- the mini bar does not cover the last row;
- no horizontal scroll (`scrollWidth <= innerWidth`).

Verify: `npx playwright test -c tests/e2e/playwright.config.ts --project mobile` with `E2E_CHANNEL=msedge`.

**M0 Mobile guard extension** (M). Branch `test/mobile-guard-ratchets`. Files: `apps/mobile/src/designGuards.test.ts`,
`designGuards.baseline.json`. Add ratchets:
- `componentColor`: colour literals outside screens;
- `componentTypeSize`;
- `motionLiteral`: `(duration|stiffness|damping):\s*\d` outside `constants/`, `ui/`, `allegra/`;
- `reduceMotion`: a file that uses `withTiming`/`withSpring`/`withRepeat`/`entering`/`Animated.timing` must reference
  `useReducedMotion` or a project equivalent, with allowlist and reason;
- `layoutAnim`: `height|width|borderRadius|top|left` returned from `useAnimatedStyle`, or `useNativeDriver: false` with size.

Skills: unslop §Passes 2/5, ux-animation §Verify. Verify: `cd apps/mobile && npx jest src/designGuards.test.ts`, then
`npm run mobile:check`. No APK change (test-only): check `.github/workflows/mobile-apk.yml` paths. If tests trigger the
APK, bump patch. Parallel: yes.

### Phase 3: web system and weakest surfaces

**W1 One token source** (M). Branch `refactor/web-tokens`. Files: `styles/tokens.css`, the `:root` blocks in
`app.css:19-28`, `components.css:11,2046`, `global.css:1728,1861,2115,2915`. **Must run alone** (it touches every CSS
file). Steps:
1. Make `tokens.css` the only `:root` for design tokens.
2. Resolve the font: Geist or DM Sans, whichever renders today, so there is no visual change (verify computed `font-family` on Home).
   Drop the unused family from `layout.tsx:39`.
3. Drop `box-shadow` from `--transition-fast/base`.
4. Add the missing vars (or alias `--text-*` to `--ink*`, `--motion-*` to `--d-*`/`--ease-*`).
5. Delete the 0-use `--gradient-accent` and `--gradient-hero`. Fix the misleading comments.

Skills: unslop §Color, polish §Details "Style". Verify: before/after captures of every route at 4 widths, pixel-diffed. Any
diff larger than anti-aliasing must be explained. Then the W0 guard baseline falls, and `npm test`, `npm run e2e` (app,
player) pass. Test: the undefined-var zero rule (W0) now passes without an allowlist for these names.

**W2 Reduced-motion parity** (S). Branch `fix/web-reduced-motion-layer`. Files: `global.css:1712-1720` (move out), the end
of `app.css` (an unlayered blanket plus overrides for `app.css:2026-2044` and `dj.css:173,462`), and `dj.css`.
- Keep "collapses to opacity, never disables": a spinner may still turn (ux-animation §Verify).
- Test: a new e2e in `mobile.spec.ts` or `app.spec.ts`, `test.use({ reducedMotion: 'reduce' })`, asserting that
  `document.getAnimations()` on Home and the listening room has no running infinite animation outside an allowlist.
  It must fail before the fix.
- Skills: ux-animation §Verify "Reduced motion", polish §Verify.
- Captures `--reduced-motion` at 360 and 1280.
- Conflicts: `dj.css` with W8. Run W2 first.

**W3 LuvLink page rebuild on the system** (M). Branch `fix/web-luvlink-polish`. Files: `luvLink/LuvLinkPage.tsx`,
`LuvLinkSession.tsx`, `app.css:7717-7786` (LuvLink block only).
- Tokens only. `IconButton`/`TactileButton` from `components/ui.tsx`. Lucide icons in place of the ↑ ♡ ♪ glyphs. 44px targets.
- 4px grid (now 7, 9, 11, 17, 19px). Plain copy (no "vibe").
- Keep the `aria-label`s (`LuvLinkPage.tsx:129`).
- Skills: unslop §Subtract, Passes 1–4, 7; polish §Details (Hit area, Forms); ux-animation Q4 (Fitts, Hit area) and Q5
  (errors keep input).
- Do not change Convex calls or the queue semantics.
- Verify: captures at 4 widths, signed in with an empty and a full room; `npm run e2e` app spec.
- Test: extend `tests/e2e/app.spec.ts` to open `/luvlink` and assert no element under 44×44 among
  `button` or `[role=button]` (bounding box including `::after` via `elementFromPoint` sampling), and no unicode glyph button labels.
- Conflicts: `app.css` lines owned exclusively. W4 must exclude the `.luvlink-*` selectors.

**W4 Hit areas and hover gating** (M). Branch `fix/web-hit-areas`. Files: `app.css` (selectors in §6a except `.luvlink-*`),
`dj.css` (13 small controls), `blend.css:525,538`, `components/ui.tsx` (one `.hit-44` utility via `::after`).
- Wrap the 29 hover-scale rules in `@media (hover: hover) and (pointer: fine)`.
- Give hover-revealed actions (`app.css:1627-1632`) a keyboard and touch path. They already show on `:focus-within`;
  check touch at 360.
- Skills: polish §Details Hit area and Hover; ux-animation Q3 Anticipation (hover gating), Q4 Hit area.
- Verify: the W0 guard falls; Playwright at 375 taps each icon control's edge; captures.
- Test: a guard rule that a `.tactile-icon-control` width under 44px requires `.hit-44`.
- Conflicts: `app.css` with W5, W6, W8. Region-disjoint (a line-range map is kept in the PR description). Merge in order.

**W5 Home unslop, polish mode** (M, needs owner yes on copy, Q3). Branch `feat/web-home-polish`. Files: `HomePage.tsx` and
the home regions of `app.css` (`.home-pick*`, `.shelf*`, `.hero-banner*`).
- Copy (unslop §Copy): remove hints that restate the title or try to sound charming (`:382,:460,:463`). Merge the
  eyebrow and title at `:268-269` into one line that says why ("Because you play <artist>" only if `picksReason` is real).
- States: shelf skeletons shaped like the tiles (polish §Details "Layout shift"; ux-animation Q1 Doherty "skeleton the size
  of the content"). An error per shelf with Retry. Keep K6 (title "For you", top pick, grid) and the glass/glow.
- Motion: no entrance on things at rest at first paint (ux-animation Q1).
- Verify: captures at 4 widths, signed out and signed in, slow network (DevTools 3G in Playwright);
  `app.spec.ts` "every section renders"; Lighthouse CLS on the preview no worse than the Phase 1 baseline.
- Test: e2e asserting the shelf skeleton has the same box as the loaded shelf (CLS guard).

**W6 Collection, album and quick-picks states** (M). Branch `fix/web-collection-states`. Files: `CollectionPage.tsx`,
`AlbumPage.tsx`, `QuickPicksPreviewPage.tsx`, `hooks/usePlaylists.ts:177-226`, `lib/libraryRows.ts:33-45`.
- FE-006 fix as specified in the backlog: hydration completion separate from row count, unavailable rows, settled message
  with Retry.
- Empty and error states for Album.
- Skills: polish §Run it step 4 (States); ux-animation Q5 (Errors).
- Test: unit test in `lib/library-loading.test.ts` (exists) for "settled with missing rows is not loading", failing
  first; e2e for an all-missing playlist.
- Conflicts: none with other packages. `App.tsx:1121-1125` is read-only here, and if it must change, that is one line,
  reviewed for playback impact.

**W7 AuthDialog focus (A11Y-001)** (S). Branch `fix/web-auth-dialog-focus`. Files: `AuthDialog.tsx`; reuse
`hooks/useFocusTrap.ts`.
- Test: the backlog's e2e in `tests/e2e/app.spec.ts` (initial focus, containment both ways, restore on close).
- Skills: polish §Details "Focus". Parallel with anything.

**W8 Decorative loops and DJ nav timings** (S, owner Q2). Branch `chore/web-decorative-loops`. Files:
`app.css:2017-2046,7788-7812`, `DjTour.tsx:134`.
- Move the DJ nav icon's raw 380–620ms and cubic-beziers onto tokens.
- Remove or keep the orbit layers and floating notes per the owner's answer.
- Skills: unslop §9 Motion, signs.md Motion.
- Test: the W0 baseline falls; reduced-motion e2e (W2) still green.

**W9 Type floor and radius family** (L, split per file). Branches `refactor/web-type-floor-<file>`.
- Move 10–11px text people must read to 12px or more (polish §Details "Contrast… nothing under 12px"). Captions may stay at 11px if the owner agrees.
- Snap radii to the `DESIGN.md` §4 family.
- Last on web: largest visual risk. Verify: captures at 4 widths per file, owner screenshot review.

### Phase 4: mobile, file-owned packages (all after M0; check `git log origin/main -- <files>` first)

**M1 Mini-player family** (L, playback-sensitive). Branch `fix/mobile-mini-player-polish`.
- Files: `MiniPlayer.tsx`, `YtMiniPlayer.tsx`, `TimelineScrubber.tsx`, `MiniScrubber.tsx`, `LyricsResumePill.tsx`.
- 10 pressables go to `Tactile`/`TactileRow`.
- `TimelineScrubber` track becomes `scaleY` (port `AppleSlider`, 11-04 plan 5.10).
- `YtMiniPlayer`: Reanimated plus transforms, or delete it if Q1 says the style is retired.
- Reduced-motion branches. 34 raw colours go to `OnMedia`/`Glass`/`ShellFrost`. Keep `MiniPlayerGlow` (K2; `round7.test.ts` guards it).
- No change to load ownership, `beginAudioLoad`, `requestPlayback`, or any effect deps (invariants 1–2).
- Skills: polish §Details Press and Hit area; ux-animation Q3 Interruptible and Properties.
- Verify: `npm run mobile:check`; `workletSafety`, `miniPlayerSurface`, `round7` and `fluidPlayerGuard` tests; CI APK +
  launch gate + `mobile-player-probe.sh`; emulator scrub at 1.0/2.0 font scale; owner M31 frame readout (Settings → About).
- Test: the M0 `layoutAnim` ratchet goes to 0 for these files.
- Bump patch.

**M2 Player surfaces, reduced motion and presses** (M, playback-sensitive). Branch `fix/mobile-player-reduce-motion`.
- Files: `player/AppleBackdrop.tsx`, `AppleSlider.tsx`, `GlowBackground.tsx`, `YouTubeBackdrop.tsx`,
  `NowPlayingBackground.tsx`, `AmbientMode.tsx`, `UpNextPanel.tsx`, `InstrumentalWaveform.tsx`, `PlayerExtras.tsx`,
  `LyricsPicker.tsx`, `NowPlayingLyricsArea.tsx`, `SynchronizedLyrics.tsx` (pressables only), `NowPlayingControls.tsx`
  (`tabular` on the time only).
- Glows hold still under Reduce Motion and never switch off (K2).
- Check `CoverGhost.tsx` against rule 5 (11-12 handoff item 5). If it animates bounds, record a decision or convert it.
- Do not touch lyric glide maths or sheet physics (K9).
- Verify: as M1, plus emulator with Remove animations (CI emulators already run with animations off, so check probe screenshots
  for half-moved states).
- Test: the `reduceMotion` ratchet goes to 0 for these files.
- Conflicts: none with M1 (disjoint files).

**M3 Connect surfaces** (M). Branch `fix/mobile-connect-presses`. Files: `connect/ConnectRemotePlayer.tsx`,
`ConnectDeviceSheet.tsx`, `ConnectNoticeHost.tsx` (13 pressables).
- Keep the sheet physics identical to the local player.
- Verify: `connectRouting.test.ts`, `mobile:check`, emulator with a Connect session if available, else mark pending.

**M4 One confirmation and legacy modals** (M). Branch `refactor/mobile-confirmations`.
- Files: `CustomAlert.tsx`, `ModernDeleteModal.tsx`, `LibraryEditModal.tsx`, `LrcSearchModal.tsx`,
  `CreatePlaylistModal.tsx`, `library/useSongActions.tsx`, `settings/AllegraAccountSettings.tsx`.
- Questions go to `ConfirmSheet`; slide modal to `Sheet` (keyboard prop); 14 pressables.
- Delete `CustomAlert`/`ModernDeleteModal` once no importer is left (SettingsScreen's import moves in M5, LuvLinkPanel's in M7).
- Skills: ux-animation Q5 (prevent then recover: Undo over confirm where reversible), Fitts (Cancel default focus).
- Test: `slideModal` and `pressable` baselines fall; a source guard that fails on importing the deleted components.
- Conflicts: sequence after M5 and M7, or leave those callers to them.

**M5 Settings** (M). Branch `fix/mobile-settings-polish`. Files: `SettingsScreen.tsx`, `settings/*` (`SettingsKit`,
`SettingsGlow`, ListenTogether, DynamicIsland, …).
- 12 colour baseline goes to 0. SettingsKit colours and type go to `Text` roles and `Glass`.
- Chips to 48 dp targets (`:288-295`). Drop the `letterSpacing` at `:268`. Reduced motion for `SettingsGlow`/`SettingsScreen`.
- The `Alert.alert('Error'…` cases become plain copy (DESIGN §9).
- Keep the glow behind Settings (K2) and the one-page structure.
- Skills: unslop polish mode (pass 2, 5, 7 only), polish §Details.
- Verify: `mobile:check`, emulator at 1.0/2.0 font scale, TalkBack names via `accessibilityNames.test.ts`.

**M6 Luvs** (M). Branch `fix/mobile-luvs-motion`. Files: `LuvsScreen.tsx`, `luvs/*`.
- 16 raw durations go to `Motion` tokens (add named tokens where none fit, in `allegraTheme.ts`, owned by this PR only).
- Reduced motion. Equaliser loops stop under Reduce Motion.
- The heart pop may keep overshoot (DESIGN §7 exception).
- Do not touch `luvsBufferManager` or the native player.
- Verify: `mobile:check`; emulator lanes swipe.
- Conflicts: `allegraTheme.ts` is shared. Only M6 and M9 may add tokens; serialise them.

**M7 Social: Blend, LuvLink, Import** (M, split M7a Blend / M7b LuvLink and Import). Files: `BlendScreen.tsx`,
`BlendsScreen.tsx`, `BlendJoinScreen.tsx`, `blend/*`, `LuvLinkScreen.tsx`, `luvLink/*`, `ImportScreen.tsx`, `import/*`.
- Weight 16 to 0, tracking (the room code may keep one justified exception, documented), 16 pressables, 2 Alert questions.
- Naming ("LuvLink" versus "Listening together") per the 11-04 owner question 3. If unanswered, change no strings.

**M8 Search, Artist, Stream screen colours** (S). Branch `fix/mobile-screen-colours`. Files: `SearchScreen.tsx`,
`ArtistScreen.tsx`, `StreamScreen.tsx`, `LyricsEditorScreen.tsx`.
- Colour baseline to 0, the Search Alert to `ConfirmSheet`, LyricsEditor `minHeight: 38` to 48 plus 1 pressable.
- Keep the `StreamScreen.layout.test.ts` guards green (FlashList header rule).

**M9 Small copy and state fixes** (S). Branch `fix/mobile-copy-states`. Files: `about/AboutSheet.tsx` (emoji at `:113`,
type literals), `Toast.tsx`, `stream/DownloadButton.tsx`, `stream/SavedBadge.tsx`, `VoiceMicButton.tsx`,
`VoiceSearchCard.tsx`, `MoreMenu.tsx`, `settings/AccountConsentSheet.tsx`, `App.tsx` (backdrops may be allowlisted),
`PlaylistItem.tsx` (`tabular`).
- Skills: unslop §Copy; DESIGN §9.
- Test: a copy guard fails on emoji in `.tsx` string literals (11-04 plan 7.4).

**M10 AND-007 nav label scaling** (M, native UI). Branch `fix/mobile-nav-label-scaling`. Files: `NativeTabBarView.kt`,
`V6TabBar.tsx`, `navigation/TabNavigator.tsx:161-178`.
- As specified in the backlog.
- Verify: CI Kotlin build, emulator at font_scale 2.0, the launch gate (it reaches About through the profile menu, so it must still pass).

### Phase 5: motion and UX pass (M, after Phases 3–4 per surface)
Walk ux-animation's five questions (§Run it steps 2–5) on: web sheets and dialogs (Auth, Connect, Karaoke, Blend,
Command palette), web like and add-to-playlist (optimistic, Q1 Doherty), web queue remove (Undo, Q5),
mobile Up next shuffle Undo (11-04 plan 5.12: verify it exists) and mobile sheet close velocity (DESIGN §7).
Output: a findings table in the ux-animation review format. Fixes go back into the owning package's files as follow-up
PRs. No new motion on high-frequency actions.

### Phase 6: signature, craft-lite (M, web only)
Target the web listening room first screen (cover wash + bar), or Home first screen after W5 if the owner prefers.
- Render 2–3 *variations within the system* as captures and show the owner before coding (craft §1, adapted to K7 and the approval loop).
- Verify frame by frame with `web-frames.mjs --motion` on open/close and song change. Measure with `edges.mjs --scale 2`.
- One fresh-critic round (critique.md prompt, Awwwards rubric), then fix the top findings.
- Mobile player: verification only (captures, frame sheets, M31 readout). No redesign (K9).

### Phase 7: marketing. Dropped from this plan (§11 D3).

### Phase 8: release and proof (per PR, then once at the end)
- Web: Vercel preview, open the changed routes, `vercel build` and inspect `.vercel/output/config.json` only if routing
  was touched (none planned).
- Mobile: CI APK, launch gate, player probe and smoke screenshots green before merge. Physical phone evidence goes into
  `IMPLEMENTATION-STATUS.md`.

### Parallel lanes and conflicts

| Lane | Packages (in order) | Shared-file conflicts to watch |
|---|---|---|
| Web A (CSS system) | W0 → W1 → W2 → W4 → W8 → W9 | All touch CSS: strictly serial |
| Web B (components) | W7, W6, W3, W5 | W3 and W5 touch `app.css` regions: merge after W1, rebase on W4 |
| Mobile A (player) | M1 → M2 → M3 | Different files, but all playback-sensitive: one at a time through the CI probe |
| Mobile B (rest) | M0 → M5 → M7 → M4 → M8 → M9 | M4 after M5 and M7 (callers). `allegraTheme.ts` only in M6 and M9 |
| Mobile C (native) | M10, M6 | Gradle: one build at a time |

---

## 9. Verification and definition of done

### Success criteria per phase
| Phase | Measurable result |
|---|---|
| 0 | Counts re-recorded on fresh main. Harness produces one still per platform |
| 1 | Every surface in §5 has a capture-confirmed score and a named weakest thing. Lighthouse baseline recorded from the preview |
| 2 | Web CSS baseline recorded. Undefined-var rule at 0 or allowlisted with reasons. Mobile gains 5 ratchets. A 360/375 e2e runs |
| 3 | Undefined custom properties 0. `--transition-*` without `box-shadow`. Raw transition/animation durations 37 → 0 and raw `cubic-bezier` 8 → 0 in touched files. Ungated hover-scale 29 → 0. Icon controls under 44px with no hit extension → 0. Reduced-motion e2e green. LuvLink web 3 → 7. Home 5 → 7. Collection/Album 5 → 7. A11Y-001 and FE-006 closed. Lighthouse CLS and accessibility no worse than baseline (target CLS < 0.1, accessibility ≥ 95, performance ≥ 90 per `motion-design-system.md` §11, if the baseline allows) |
| 4 | `pressable` 73 → 0 (documented backdrops allowlisted). `slideModal` 1 → 0. `alert` 3 → 0. `weight` 16 → 0. `tracking` 3 → ≤1. Screen `color` 29 → 0. `reduceMotion` 18 → 0. `layoutAnim` 2 → 0. Motion literals 63 → ≤10. Component colour literals 395 → ≤200. All touch targets ≥ 48 dp in touched files. Settings and LuvLink (mobile) 5/3 → 7 |
| 5 | Every interaction in scope has a frequency class and passes ux-animation §Verify. Undo exists where removal is reversible |
| 6 | The critic's weighted score is recorded honestly (no self-award). Top 3 findings fixed and re-verified |

### Definition of done, per surface (check in the PR)
- [ ] Owner keep list (§3) intact: glass, glow, accent, layout, copy rules.
- [ ] Tokens only: no raw colour, duration, easing or font size in touched files (guards prove it).
- [ ] Transform/opacity motion only, with a reduced-motion branch (opacity), and no feature removed.
- [ ] Targets: 48 dp mobile, 44px web touch (visual may be smaller with an extension); no overlap.
- [ ] `tabular` / `tabular-nums` on every changing number.
- [ ] Loading, empty, error and offline states designed, with no layout shift between loading and loaded.
- [ ] Contrast: body and labels ≥ 4.5:1 and icons ≥ 3:1, measured on captures over the real background.
- [ ] Copy: sentence case, no emoji, no restating subtitle, errors in plain words.
- [ ] Captures attached: web 360/768/1280/1920 plus reduced motion; Android 1.0 and 2.0 font scale.
- [ ] Playback invariants untouched (grep the diff for `setIsPlaying`, `.play(`, `requestPlayback`, effect deps on
  `isPlaying`), and player e2e (`pause stays paused`, `music keeps playing across page navigation`, `seeking moves the
  playhead`) or the mobile player probe green.
- [ ] Regression test added and failing on the old code.
- [ ] Mobile: `expo.version` bumped. Physical-phone items recorded as evidence or explicitly "pending".

---

## 10. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Stale base: remote main (`cf662478`) is ahead of what was reviewed, and 4 sibling worktrees are open | High | Rework, merge conflicts | P0.1 re-count. File-owned packages. `git log origin/main -- <files>` before each package. Ask Q7 |
| R2 | A skill default undoes an owner decision (glass, glow, lime, notes, copy) | Medium | Owner trust, rework | §3 and §4 as the first read of every package prompt. Owner screenshot review for anything visible. No deletion without a yes |
| R3 | A polish edit regresses a playback invariant in a player file (`MiniPlayer.tsx` 1140 lines, `PlayerPanel.tsx`) | Medium | Silent production bug (the history in CLAUDE.md) | Player packages serial. Invariant diff grep. Web player e2e and mobile player probe required. No effect-dependency edits in polish PRs |
| R4 | The CSS cascade shifts: token consolidation or moving the reduced-motion rule out of the legacy layer changes computed styles site-wide | Medium | Visual regressions on unvisited routes | W1 alone, with full-route pixel diffs at 4 widths. W2 small and verified with emulated reduced motion |
| R5 | Evidence gaps: no phone, emulator HEVC, low-end frame rate, TalkBack, 200% text, Windows tooling | High | "Done" claimed early | Batch owner M31 sessions. §7 Android recipe. Mark pending in `IMPLEMENTATION-STATUS.md`. Never promote emulator results to phone proof |
| R6 | Ratchets get raised by running `UPDATE_*_BASELINE` to make room | Low | Debt returns | Reviewers check that the baseline only falls. CI diff on the baseline JSON |
| R7 | Mobile version-bump collisions between parallel PRs | Medium | CI or merge failures | Bump at merge time after a rebase |
| R8 | Glow cost on low-end phones gets "fixed" by turning glow off | Low | Owner decision broken | K2: cut pixels and fps via `utils/visualBudget` only |
| R9 | Worktree removal wipes the main checkout (junctions) | Low | Data loss | `rmdir` junctions first. Back up `.env` files |

## Do-not-do list
- Do not delete or flatten glass, glow, shader, cover wash, the DJ mascot or Blend orbs. Do not add a dark veil.
- Do not introduce a new accent, a mono label on mobile, uppercase or tracked labels, emoji, or sparkle/"magic" copy.
- Do not type a duration, easing, colour or font size into a component. Add a token in its own change.
- Do not animate width, height, top, left, border-radius, box-shadow, filter or backgroundColor.
- Do not touch `useAudioPlayer`, `requestPlayback`, load effects, queue code, the lyric glide maths or sheet physics in a polish PR.
- Do not change lyric line wrapping (owner rejected).
- Do not add a dependency (Gorhom, new icon sets) or generated imagery, and do not install anything without the owner.
- Do not edit `apps/desktop`, `apps/api` or `convex/`, or change any API response shape.
- Do not run unreasonable-craft's "creative risk" exploration on Android.
- Do not claim device, TalkBack, performance or HEVC results from CI or the emulator.
- Do not raise a guard baseline. Do not weaken a source-pattern guard when code moves; move the guard.
- Do not merge to main (it publishes the APK) without green CI, the launch gate and the probe.

---

## 11. Decisions on v1's open questions

**D1 Surfaces order.** Both, in parallel lanes, but not "web Home and mobile Stream first".
- Web goes first for system work (W0, W1, W2): it has the largest untracked debt and no competing branch.
- Its first visible PRs are LuvLink (weakest, 3) and Home (highest leverage).
- Mobile Stream is already V6 at 7 with recent owner-driven changes, so its marginal value is low.
- Mobile starts with guards (M0) and Settings (M5, weakest high-traffic). The mini-player family (M1) follows once fresh
  main is confirmed.
- Assumption: no other agent is editing those mobile files (Q7).

**D2 Glass and glow.** Keep everything on the keep list. Unslop runs in polish mode and only produces a review list. Three
candidates go to the owner: the 4 artwork-bg orbit loops (`app.css:2020-2046`), the DJ tour notes (`DjTour.tsx:134`),
and the template-looking tokens `--shadow-glow` (sky blue, 1 use) and `--glass-surface` (slate `rgba(15,23,42)`, 4 uses).
Coral keeps its documented supporting role. Nothing is removed without a yes.

**D3 OpenAI key / marketing.** No key was found by name, and nothing in the plan depends on one. Phase 6 of v1 is
dropped: store screenshots have no store (sideloaded APK), the SF Pro licence restricts marketing use, and generated heroes
conflict with K7. If the owner wants one website hero later, it goes in its own plan with real captures for `AndroidAppCard.tsx`.

### Questions that need the owner (defaults in brackets)
- Q1 Is the YouTube-style mini player (`YtMiniPlayer`, rendered at `MiniPlayer.tsx:981`) still a choice? [Keep and fix it in M1]
- Q2 Remove the orbit loops and the DJ tour notes? [Keep both, still under reduced motion]
- Q3 Approve the Home copy direction (plain hints or none)? [No copy change in W5, states only]
- Q4 Colour transitions on web hover (100–160ms)? [Allow color/background-color/border-color, never box-shadow/filter, and record it in decisions.md]
- Q5 Can you provide the `interface-craft` skill? [No: craft-lite]
- Q6 When can you run M31 sessions (frame readout, TalkBack, 200% text)? [Batch after M1 and after M5]
- Q7 Is anyone else working on mobile right now (remote main moved)? [Assume yes and re-check before each mobile package]

---

## 12. First week

| Day | Work | Output |
|---|---|---|
| 1 | P0.1 fetch and re-count (Appendix B commands). P0.2 harness (owner OK for `npm install --prefix …/scripts`, `CHROME_PATH`). P0.3 send Q1–Q7 | Updated §5/§6 numbers; one web and one Android still |
| 2 | Phase 1: web captures (all routes, 4 widths, reduced motion) from the main checkout on :5173; Android emulator captures at 1.0/2.0; Lighthouse on the preview | `AUDIT-2026-11-xx.md` |
| 3 | W0 + W0b (web guards, 360 e2e) and M0 (mobile ratchets), two branches in parallel | 2 PRs, no visual change |
| 4 | W1 token consolidation (alone on web CSS), with full pixel diffs. W7 AuthDialog focus in parallel (TSX only) | 2 PRs |
| 5 | W2 reduced-motion layer fix. M5 Settings starts. Owner answers folded in | 1 PR merged, 1 in review |

---

## Addendum A: owner requests, 2026-11-13 (Library layout toggle and the Albums tab)

Added after the v2 review, from the owner. Three work packages; facts below were read from `origin/main` `cf662478`
(`LibraryScreen.tsx`, `PlaylistsScreen.tsx`, `libraryCollections.ts`, `LibraryPage.tsx`, `app.css:1219`). Anything marked
"hypothesis" must be verified by the package before acting on it.

### A.1 W11 Web Library: playlists as grid or list (S-M)

Branch `feat/web-library-playlist-layout`. Today `PlaylistsSection` in `apps/web/src/components/LibraryPage.tsx` (lines
~104-135) renders only the folder grid (`.playlist-grid`, `app.css:1219`, `PlaylistFolder` fan of three covers).
- Add an icon-only two-button toggle (lucide `LayoutGrid` / `List`) at the right of the Playlists section header, exposed as
  a radio group or two `aria-pressed` buttons with names "Show as grid" and "Show as list". 40x40 minimum hit area.
- List mode: one row per playlist, 56 px cover (the first available cover, else the existing fallback), name, song count in
  `tabular-nums`, round play button at the right, whole row opens the playlist. Reuse the folder's existing open and play
  handlers, so behaviour is identical in both modes. No nested containers; spacing separates rows (no dividers).
- Remember the choice in `localStorage` (guarded by try/catch; the page must render correctly without it). Default: grid.
  Resolve it before first paint so there is no grid-to-list flash (polish "First paint").
- Switching mode: no animated layout properties. A short opacity cross-fade using the existing motion tokens, collapsing to
  opacity under reduced motion. Cutting animation entirely is acceptable (rare action, no question it answers).
- CSS goes in the file that owns `.playlist-grid` after W1 has landed (tokens first, no new `:root` blocks, no raw colours).
- Skills: ux-animation Q1 (should it move) and Q4 (Hit area, Fitts); polish Details (Hit area, tabular-nums, First paint);
  unslop Subtract (no extra chrome).
- Test: an e2e in `app.spec.ts` that toggles to list, reloads, and sees list still selected; plus keyboard operation of the
  toggle. Capture 360/768/1280/1920 in both modes.
- Conflicts: `app.css` (W1, W3, W5), `LibraryPage.tsx` (no other package owns it). Run after W1.

### A.2 M11 Mobile Library: playlists as grid or list (M)

Branch `feat/mobile-library-playlist-layout`. Today `PlaylistsScreen.tsx` is a two-column `FlatList` of folders, one column
only when `fontScale >= 1.6`; there is no choice. A pattern already exists in this app to reuse:
`components/AddToPlaylistModal.tsx:75` (`viewMode: 'list' | 'grid'`, an icon button with labels "Show as list" and
"Show as grid", line ~256). Do not invent a second pattern.
- Add a tools row to the Playlists tab (same row shape as the Songs tab's sort row in `LibraryScreen.tsx`): the playlist
  count on the left, the toggle on the right (one 48 dp icon button that flips the mode; label names the mode you will get).
- List mode uses the shared `ListRow` from `src/ui` (artwork, title, "N songs" subtitle, chevron), keeping the long-press menu,
  pinning, "Liked songs" first row, and the downloaded/pinned badges that the grid cards have today. Grid mode is unchanged.
- Persist the choice like the existing sort key (`SORT_KEY` + `AsyncStorage` in `LibraryScreen.tsx`) unless a settings store
  field is clearly better; default grid; at `fontScale >= 1.6` keep the one-column behaviour for grid and let the list win.
- No raw colours, sizes or durations (designGuards); no new glass; `Tactile` presses; accessible role, name and state
  ("Show as list, button"); scalable text.
- Component-boundary test for: default grid, toggle to list, persistence round trip, Liked songs stays first in both modes.
- Verify: `npm run mobile:check`; emulator screenshots at 1.0 and 2.0 font scale in both modes; real-phone check pending.
- Bump `expo.version` (minor: a feature).
- Conflicts: `LibraryScreen.tsx`, `PlaylistsScreen.tsx`; run after M0 (guards) and M5 (Settings), in the Mobile B lane.

### A.3 M12 Mobile Library: why Albums is always empty, and whether to keep it (M)

Branch `chore/mobile-library-drop-albums` (or `fix/mobile-library-albums` if the investigation finds a cheap fix).

Facts (verified by reading): the Albums tab exists only on mobile (`LibraryScreen.tsx` `TABS`). It lists groups of the songs
saved on the phone, keyed by `song.album` via `indexLibraryCollections` (`libraryCollections.ts`), which skips any song whose
`album` is empty. The empty state says "Songs saved on this phone appear here." The web Library has no Albums tab; web
`AlbumPage` browses catalog albums and is unrelated. `album` is optional everywhere (`Song.album?`, `UnifiedSong.album?`).

Hypothesis (unverified): few or no saved songs have an album. `DownloadManager.ts` writes `staging.album` (optional, from the
catalog result), `mediaScanner.ts:45` reads `(asset as any).album` (often undefined), so the index comes out empty.

Steps:
1. Investigate first, read-only. Trace where `album` is set on each path that creates a library `Song` (catalog download,
   phone import, Spotify import, YouTube Music) and where `database/queries.ts` (lines ~72, 123, 193) reads `row.album`.
   Report, per path, whether the field is populated. If a seeded or emulator DB is available, report the real count of
   songs with and without an album.
2. Decide. Recommended default: remove the Albums tab, because it is empty for the owner, the owner direction is "neat, cut
   over-creative extras", and Artists plus Playlists already cover browsing. Keep it only if the investigation shows album is
   populated for most downloads and a one-line fix makes it useful; in that case fix the data path and keep the tab. State
   the decision and the evidence in the PR.
3. If removing, scope exactly (and nothing wider):
   - `LibraryScreen.tsx`: `Tab`/`TABS`, the `'Albums'` collection type, the `albumCell` grid, `columns`/`cardSize`, and the
     `CollectionCard` album branch if it becomes unused (check other callers before deleting from `src/ui`).
   - `libraryCollections.ts`: the album index, plus its test.
   - `settingsStore.ts:44-45`: remove `'Albums'` from `LibraryStartTab` and `LIBRARY_START_TABS`. Users who saved `'Albums'`
     must load as `'Songs'`: extend `normalizeLibraryStartTab` and add a test (persisted state, line ~423).
   - `ShortcutSettings.tsx` (the start-tab picker) and the `SettingsScreen.tsx:232` summary text.
   - Update `accessibilityNames` and `designGuards.baseline.json` entries that mention these files.
   - Do not touch `Song.album`, provider types, queue, lyrics, Connect or LuvLink; they use the field for other purposes.
4. Tests: normalization test for the persisted `'Albums'` value; the Library tab list; `npm run mobile:check`.
5. Bump `expo.version` (patch for a fix, minor if a visible feature is removed; use minor).
- Conflicts: same files as M11 and `settingsStore.ts`/`ShortcutSettings.tsx` (M5). Run M12 before M11 so M11 builds on
  the final tab set, or merge them into one branch if the orchestrator prefers; never two writers on `LibraryScreen.tsx`.

### A.4 Lane placement

| Lane | Add | Order note |
|---|---|---|
| Web B (components) | W11 | after W1 (CSS) |
| Mobile B (rest) | M12, then M11 | after M0 and M5; one writer on `LibraryScreen.tsx` and `PlaylistsScreen.tsx` |

Success criteria: the toggle persists across reloads on web and restarts on mobile; both layouts pass the a11y and
tap-target checks; an Albums decision with evidence is recorded in the PR; no regression in the start-tab setting.

---

## Appendix A: evidence (file:line)

**Web**
- `apps/web/src/lib/motionGuards.test.ts:21` reads only `styles/global.css`.
- `apps/web/src/styles/global.css:1` opens `@layer legacy {`; `:1712-1718` is the blanket reduced-motion rule inside it.
- `tailwind.css:2` sets the layer order.
- `app.css:7` describes app.css as unlayered.
- `tokens.css:137-139` (transitions with box-shadow); `:148-150` (DM Sans) versus `app.css:20-22` (Geist); `:33` comment "aqua"
  on coral `#ee6b5f`.
- `app/layout.tsx:39` loads Geist and DM Sans.
- `app.css:7717-7786` LuvLink block using undefined `--text-*`, `--surface-base`, `--motion-*`.
- `app.css:2017-2046` artwork-bg loops; `:7788-7812` DJ nav icon raw timings and filter transitions; `:3140` filter
  transition; `:1148,1627,2302,2563,2813,6387,6998,7731` icon controls under 44px; `:600` and `:5918` show the 44px pattern
  done right.
- `components/ui.tsx:52` `IconButton` is 44px (`w-11 h-11`).
- `components.css:123,726,1258` `z-index: 9999`; `:1420` `10050`.
- `HomePage.tsx:166,268-269,382,415-416,460,463`.
- `LuvLinkPage.tsx:129,133`; `DjTour.tsx:134`.
- `CollectionPage.tsx:122,151` (FE-006).
- `AuthDialog.tsx` has no `useFocusTrap` (A11Y-001).
- `App.tsx:19-54` static page imports (PERF-001).
- `tests/e2e/playwright.config.ts` `mobile` project matches a spec that does not exist.

**Mobile** (at `bf78a9a9`)
- `designGuards.baseline.json` totals: pressable 73/33 files, slideModal 1, weight 16, tracking 3, alert 3, color 29, bottomPad 0, typeSize 0.
- `TimelineScrubber.tsx:228-229`; `YtMiniPlayer.tsx:32-46`; `MiniPlayer.tsx:31,981`.
- `LuvControls.tsx:40,66,68-71,95,98,163-165`.
- `SettingsKit.tsx:268,288,289,295`; `LuvLinkPanel.tsx:181,183,190`; `LyricsEditorScreen.tsx:406`; `LrcSearchModal.tsx:117`.
- `AboutSheet.tsx:113`; `NowPlayingControls.tsx:159`.
- `ui/Text.tsx:52` (`tabular` style exists); `utils/haptics.ts:34-42`; `components/allegra/motion.tsx:137` (`TactileRow`); `allegraTheme.ts:10-14` (white accent).
- Animated files with no reduced-motion reference (heuristic: some may inherit a still state from a parent or the visual budget, so confirm each):
  - `InstrumentalWaveform`, `luvLink/LuvLinkHost`, `MiniScrubber`, `NowPlayingBackground`;
  - `player/AmbientMode`, `player/AppleBackdrop`, `player/AppleSlider`, `player/GlowBackground`, `player/UpNextPanel`, `player/YouTubeBackdrop`;
  - `settings/SettingsGlow`, `stream/DownloadButton`, `stream/SavedBadge`;
  - `TimelineScrubber`, `Toast`, `YtMiniPlayer`;
  - `screens/LuvsScreen`, `screens/SettingsScreen`.

## Appendix B: how the counts were taken (re-run in P0.1)
- Mobile tree: `git archive origin/main apps/mobile/src | tar -x -C <scratch>` (read-only), then grep.
- Web: `grep -cE "^\s*transition\s*:"`, `grep -c "cubic-bezier"`, `grep -cE ":hover[^{]*\{[^}]*scale\("`,
  `grep -oE "font-size:\s*(9|10|10\.5|11)px"`, and the used-versus-defined custom-property comparison (`var(--x` minus
  `--x:` definitions minus names set from TSX).
- Mobile: colour literals `['"](#hex|rgba?\()`; `fontSize:\s*[0-9]`; `(duration|stiffness|damping|delay)\s*:\s*[0-9]`;
  animated files lacking `useReducedMotion|reduceMotion|ReduceMotion|reducedMotion`.

## Appendix C: not inspected or not verified
- Remote main `cf662478` contents. No renders of any surface, so every score is code-derived.
- Runtime confirmation of the layer-cascade reduced-motion bug. Whether `--music-*` variables are set at runtime.
- Whether the YTM web branch fully landed (inferred from merge commits).
- Device behaviour of the 1.60.0 features. `.github/workflows/mobile-apk.yml` path filters (whether test-only mobile PRs rebuild the APK).
- The full text of `audit/CODEBASE-KNOWLEDGE.md` (only the backlog was filtered) and `.planning/LEARNING-LOG.md`.
- Whether 11-04 plan items 5.7 (scroll-to-top registry) and 5.12 (shuffle Undo) shipped.
- The `charles-unslop/references/tokens.md` values (headings only).
