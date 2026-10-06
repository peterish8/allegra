# Handoff: cinematic Blend + Spotify import, and the classic player bar

Written 2026-10-06 by the laptop session, for a Claude Code cloud session driven from a phone.
Read `CLAUDE.md`, `docs/architecture.md` and `.planning/blend/cinematic-plan.md` first.

## Where things stand

| # | Work | Branch | PR | State |
| --- | --- | --- | --- | --- |
| 1 | Motion tokens + transform-only `ProgressBar` | `feat/cinematic-tokens-progress` | peterish8/allegra#5 | **Merged** to main (CI green) |
| 2 | Blend reveal plays inside the hero (no overlay) | `feat/blend-reveal-in-hero` | opened with this file | Open. Local typecheck + lint pass; full `npm test` was run before push (see PR body). Merge once CI is green |
| — | Android tab flicker fix (other laptop session), v1.1.1 | `fix/mobile-android-tab-flicker` | peterish8/allegra#6 | Open. Merge once CI is green (it rebuilds the APK) |
| 3 | Lens emphasis + track list swap | — | — | Not started |
| 4 | Spotify crate, cover flight, ticker (web, then mobile) | — | — | Not started |
| 5 | Completion arrival (Spotify + file import) | — | — | Not started |
| 6 | Blend share card | — | — | Not started (note `components/blend/shareCard.ts` already renders story cards: reuse it) |
| 7 | Waiting state around the ghost orb, leave sink, stale pulse | — | — | Not started |
| — | Classic mini player bar shape (user request) | — | — | Not started, see below |

The user asked for: implement every PR in the plan, commit properly, push, **merge when CI passes**
(squash, conventional commits, no AI footers in commit bodies beyond the Co-Authored-By line). The user
explicitly approved merging green PRs.

Repo has no branch protection and GitHub auto-merge is disabled, so merge by hand after CI:
`gh pr checks <n>` then `gh pr merge <n> --squash --delete-branch`.

## What PR 2 changed (so you can build on it)

- `apps/web/src/components/blend/BlendStage.tsx`: new `intro` / `onIntroDone` props. Orbs travel via a
  CSS custom property `--travel` (1 → 0) animated by `motion`, read inside the orb's own `transform`
  (`blend.css` `.blend-orb` and `@keyframes blend-drift`), so all orbs stay in one `mix-blend-mode: screen`
  group. Light pool `.blend-stage__glow` (opacity only). Skip button + Escape. 3s fallback
  (`revealTokens.maxMs`).
- `MatchNumber.tsx`: `delay` and `instant` props.
- `BlendReveal.tsx` → `blendReveal.ts` (helpers only: `revealKey`, `revealSeen`, `markRevealSeen`,
  `useBlendPalette`). The overlay and its `MusicFlowShader` are gone.
- `BlendPage.tsx`: `BlendView` gets `revealing` / `onRevealed`; `<BlendStage key={revealKey(detail)}>`;
  everything under the hero is wrapped in `motion.div.blend-body` that is `inert` and transparent until
  the reveal lands.
- Tokens in `apps/web/src/motion/index.ts`: `duration.flight` (0.28), `duration.deal` (0.32),
  `revealTokens`, `TICKER_PER_SECOND` (4), `LIVE_SUMMARY_MS` (2000). CSS: `--d-flight`, `--d-deal`.

**Not yet seen moving.** The in-app browser pane was hidden, so `requestAnimationFrame` never ran and the
reveal could not be watched. Static poses were checked (far-apart start transforms compute correctly,
settled stages render). First job if a browser is available: open a Blend that has not been revealed
(clear `localStorage` keys starting `blend-revealed:`) and confirm the orbs glide in, the glow rises,
the number counts, Skip/Escape land the same final frame, and reduced motion shows no travel.

## Remaining PRs (from the plan, section 8)

3. **Lens emphasis** (`BlendPage.tsx` `.blend-lens`): when a person is picked, their orb scales 1.06 and
   others dim to 0.5 opacity (pass `focus` userId into `BlendStage`); track rows not theirs exit with
   `exitUp`, theirs re-flow (`AnimatePresence mode="popLayout"`); last tap wins.
4. **Spotify crate** (`components/import/SpotifySyncPanel.tsx`): crate in `.spotify-sync__dock` showing
   up to 3 fanned selected covers + count badge. Selecting a row flies a cloned cover (FLIP, transform
   only, `--d-flight`) into the crate; unselect flies back; rapid toggles cancel and retarget, no orphan
   overlay nodes. During transfer the top sleeve lifts; a ticker shows real progress. The Spotify sync
   step (`SpotifySyncStep` in `packages/shared/spotify.ts`) only has counts (`added`, `skipped`,
   `reviewNeeded`), not song titles, so the ticker shows the playlist name and counts. Adding titles
   would change `docs/api-contract.md` (hard rule 1): propose first, do not slip it in. The **file**
   import's matching state does hold `results` (`MatchedTrack` with `track.title/artist`), so its ticker can show
   "Found · Title — Artist", throttled to `TICKER_PER_SECOND`, with `aria-hidden` on the visual ticker
   and the existing 2s live summary for screen readers.
   Mobile twin: `apps/mobile/src/components/import/SpotifySyncPanel.tsx` (Reanimated, `measure()` +
   absolute `Animated.Image`, `Haptics.selectionAsync` feature-safe). Any `apps/mobile/` change needs an
   `expo.version` bump in `apps/mobile/app.json` (1.1.1 is taken by PR #6, so use 1.2.0 for a feature).
5. **Completion arrival**: count up the total ("1,284 songs now in Allegra") reusing `MatchNumber`'s
   pattern, Open Library + Review skipped; file import `done` step gets the same treatment (it currently
   says "Done.").
6. **Share card**: a 1080×1920 match card (orbs, names, %, "brings you together" artist) via the
   existing `shareCard.ts` path; Web Share when available, download otherwise.
7. **Waiting / leave / stale**: put the "Waiting for a friend" headline and the invite button with the
   ghost orb; on successful leave, the viewer's orb sinks (`exitDown`) before navigating; while
   `stale`, orbs pulse once per poll (opacity).

Each PR: `npm run typecheck`, `npm run lint`, `npm test` (exit 0). Mobile: `npm.cmd run mobile:check`.

## Classic mini player bar (user request, not started)

User, verbatim intent: in the **classic** (bar) mini player, not the curved pill one, the bar is rounded
at the bottom and straight at the top; they want the opposite (straight bottom, smoothly rounded top),
or both straight like a classic bar.

What the laptop session saw on the Pixel 9 Pro emulator: the collapsed bar sat inset ~17px from both
screen edges with rounded bottom corners and a square top, just above a full-width black tab bar.
But `apps/mobile/src/components/MiniPlayer.tsx` on main (`animatedClassicShellStyle`, around line 414)
draws the classic shell full-width with **0 radius** when collapsed (`halfR` starts at 0 when not
`pillMode`); only `pillMode` (`navBarStyle === 'modern-pill'`) insets it (`left/right: side`) and rounds
the bottom (`bottomR`). The navigation audit notes the emulator had an old 1.0.7 APK installed at one
point, so the screenshot may not be current code. Before editing, confirm which path draws what the user
sees (ask them for a phone screenshot with Settings → nav bar style named). Then the change is in that
shell style: bottom corners 0, top corners a token radius (e.g. 16 collapsed), integer radii only (the
comment there explains Android clip-path rebuilds). Keep `TimelineScrubber` clear of the new top
corners (`styles.pillScrubber` shows how). Bump `expo.version`.

## Environment notes

- The laptop has other worktrees (`C:\dev\allegra` was in use by another session). A cloud session
  works from GitHub, so start from `origin/main` or the PR branches above.
- No Convex/Google sign-in is available to an agent: Blend pages need a signed-in user, so visual checks
  need a harness page (a throwaway `apps/web/app/dev-*/page.tsx` that renders `BlendStage` with fake
  members works; never commit it) or the user's own device.
