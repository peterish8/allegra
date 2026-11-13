# Assignments: who does what, in what order

Models: **Luna** = GPT-6 Luna at xhigh. **Sonnet** = Claude Sonnet 5.5 at high. Max 3 workers at once (see `00-ORCHESTRATION.md` §2).
Merge: **AUTO** = worker runs `full-send` and merges at the merge gate. **HOLD** = worker runs `full-stop` and leaves the PR ready for the owner.
`council` = after Sol approves, also run the `council` skill. Card = `tasks/<ID>.md`. Spec = the section of `../PLAN-v2.md` the card points to.

## Why this split

- **Luna (xhigh)** takes the cards that need deep cross-file reasoning, tests-first guards, cascade or playback risk, native code, or an
  investigation that decides what to build: W0, M0, W1, W2, M1, M2, M10, M12, P5, P6.
- **Sonnet (high)** takes the well-specified, file-bounded UI packages: everything else.
- Review is always a different model family: the reviewer is GPT Sol (from `sol-loop`), and Sonnet cards get Sol review too. Sonnet cards that fail twice are
  re-run on Luna; Luna cards that fail twice are taken over (see `00-ORCHESTRATION.md` §4).

## Cards

| ID | Package | Model | Merge | Council | Depends on (merged) | Lane | Size | Branch |
|---|---|---|---|---|---|---|---|---|
| P1 | Baseline: re-count on fresh main, capture harness, audit (read-only, one docs PR) | Sonnet | AUTO | no | Step 0 | docs | M | `docs/frontend-polish-audit` |
| W0 | Web CSS ratchet guards and the 360 px e2e (W0 + W0b) | Luna | AUTO | no | Step 0 | Web A | M | `test/web-css-guards` |
| M0 | Mobile guard ratchets (5 new) | Luna | AUTO | no | Step 0 | Mobile B | M | `test/mobile-guard-ratchets` |
| W1 | One token source for web CSS | Luna | AUTO | yes | W0 | Web A (alone on CSS) | M | `refactor/web-tokens` |
| W7 | AuthDialog focus trap (A11Y-001) | Sonnet | AUTO | no | Step 0 | Web B (TSX only) | S | `fix/web-auth-dialog-focus` |
| M5 | Mobile Settings polish | Sonnet | AUTO | no | M0 | Mobile B | M | `fix/mobile-settings-polish` |
| W6 | Collection, Album and Quick Picks states (FE-006) | Sonnet | AUTO | no | W0 | Web B | M | `fix/web-collection-states` |
| M12 | Mobile Library: why Albums is empty, then keep-and-fix or remove | Luna | AUTO if evidence-gated, else HOLD | no | M0, M5 | Mobile B | M | `chore/mobile-library-drop-albums` |
| W2 | Web reduced-motion parity | Luna | AUTO | no | W1 | Web A | S | `fix/web-reduced-motion-layer` |
| W3 | Web LuvLink page on the system | Sonnet | AUTO | no | W1 | Web B | M | `fix/web-luvlink-polish` |
| M1 | Mobile mini-player family | Luna | AUTO | yes | M0 | Mobile A (player) | L | `fix/mobile-mini-player-polish` |
| M8 | Mobile Search, Artist, Stream, LyricsEditor colours | Sonnet | AUTO | no | M0 | Mobile B | S | `fix/mobile-screen-colours` |
| W4 | Web hit areas and hover gating | Sonnet | AUTO | no | W2, W3 | Web A | M | `fix/web-hit-areas` |
| M11 | Mobile Library: playlists grid or list toggle | Sonnet | AUTO | no | M12 | Mobile B | M | `feat/mobile-library-playlist-layout` |
| M7a | Mobile Blend screens | Sonnet | AUTO | no | M5 | Mobile B | M | `fix/mobile-blend-polish` |
| M7b | Mobile LuvLink and Import screens | Sonnet | AUTO | no | M5 | Mobile B | M | `fix/mobile-luvlink-import-polish` |
| M6 | Mobile Luvs motion tokens and reduced motion | Sonnet | AUTO | no | M0 | Mobile C (`allegraTheme.ts`) | M | `fix/mobile-luvs-motion` |
| M2 | Mobile player surfaces | Luna | AUTO | no | M1 | Mobile A (player) | M | `fix/mobile-player-reduce-motion` |
| W5 | Web Home states and skeletons (states only; no copy change) | Sonnet | AUTO | no | W1, W4 | Web B | M | `feat/web-home-polish` |
| W11 | Web Library: playlists grid or list toggle | Sonnet | AUTO | no | W1, W4 | Web B | M | `feat/web-library-playlist-layout` |
| M4 | Mobile one confirmation, retire legacy modals | Sonnet | AUTO | no | M5, M7a, M7b | Mobile B | M | `refactor/mobile-confirmations` |
| M9 | Mobile small copy and state fixes | Sonnet | AUTO | no | M6 | Mobile C | S | `fix/mobile-copy-states` |
| M3 | Mobile Connect surfaces | Sonnet | AUTO | no | M2 | Mobile A (player) | M | `fix/mobile-connect-presses` |
| M10 | Mobile nav label scaling (AND-007, native Kotlin) | Luna | AUTO | no | M0 | Mobile native | M | `fix/mobile-nav-label-scaling` |
| W8 | Web decorative loops and DJ nav timings (tokens only; loops stay) | Sonnet | AUTO | no | W2 | Web A | S | `chore/web-decorative-loops` |
| P5 | Motion and UX pass: findings table, then small fixes | Luna | AUTO | no | W3, W5, M1, M2 (or best effort) | docs + fixes | M | `docs/frontend-polish-ux-findings` |
| W9 | Web type floor and radius family (per file) | Sonnet | HOLD | no | all other web cards | Web A | L | `refactor/web-type-floor-<file>` |
| P6 | Craft-lite: web listening room signature (variations, critic) | Luna | HOLD | no | W5 | Web | M | `feat/web-listening-room-signature` |
| FINAL | Final verification and report | orchestrator | n/a | n/a | everything | n/a | S | n/a |

## Dispatch order (rolling, three slots)

Start the first three; whenever a slot frees, start the first queued card whose dependencies are merged and that overlaps no running card's files.

1. **Wave 1:** P1, W0, M0
2. W1 (when W0 merges), W7, M5 (when M0 merges), W6, M12 (after M5)
3. W2 (after W1), W3 (after W1), M1, M8
4. W4 (after W2 and W3), M11 (after M12), M7a, M7b, M6
5. M2 (after M1), W5, W11, M4, M9
6. M3 (after M2), M10, W8, P5
7. W9, P6
8. FINAL

If a card's dependency is blocked, skip ahead to the next eligible card instead of idling a slot.

## Conflict map (only one writer per row at a time)

| Shared surface | Cards | Rule |
|---|---|---|
| `apps/web/src/styles/*.css` | W0 (tests only), W1, W2, W3, W4, W5, W8, W9, W11 | W1 alone; others one at a time or on disjoint regions with a line-range map in the PR; merge in dispatch order and rebase on the previous |
| `apps/web/src/components/ui.tsx` | W4 | W4 only |
| `apps/web/src/components/LibraryPage.tsx` | W11 | W11 only |
| `apps/mobile/src/screens/LibraryScreen.tsx`, `PlaylistsScreen.tsx`, `libraryCollections*` | M12 then M11 | serial |
| `apps/mobile/src/store/settingsStore.ts`, `components/settings/ShortcutSettings.tsx`, `SettingsScreen.tsx` | M5 then M12 | serial |
| `apps/mobile/src/constants/allegraTheme.ts` | M6, M9 | serial; only these two add tokens |
| Player files (`MiniPlayer*`, `player/*`, `connect/*`) | M1, M2, M3 | serial; each passes the CI launch gate and player probe |
| `apps/mobile/app.json` (`expo.version`) | every mobile card | bumped at merge time after a rebase; one mobile merge at a time |
| `docs/decisions.md` | W0 (colour-transition note) | W0 only |
