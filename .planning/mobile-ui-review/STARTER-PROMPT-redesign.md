> Superseded for continuation: read `STARTER-PROMPT-v6-verification.md` and
> `HANDOFF-2026-11-06-v6-verification.md`. The redesign below has shipped as 1.37.1; do not repeat its old
> release steps. The new owner screenshots, UI/UX corrections and animated header requirement are in the new plan.

# Starter prompt for the next session (copy everything below the line)

---

Continue the LuvLyrics (Android, `apps/mobile` in `C:\dev\allegra`, branch `feat/mobile-frontend-polish`) redesign and
ship it. The V6 look is approved: finish the designs, then build it into the real app, bump the version, push, merge and
release it.

Read these first, in order, and don't assume anything from earlier conversations:
1. `.planning/mobile-ui-review/HANDOFF-2026-11-06-round6.md`: what's approved, where every design lives, the plan
2. `.planning/mobile-ui-review/REDESIGN-V6-NOTES.md` and `REDESIGN-V5-SPEC.md`: rationale, specs, research
3. `apps/mobile/DESIGN.md` (top section "Redesign direction"), `apps/mobile/CLAUDE.md`, repo `CLAUDE.md`
4. The designs: offline at `.planning/mobile-ui-review/design-gallery/index.html`; live on the Design canvas
   https://claude.ai/artifact/UGiYJ1UaRjWA66qTFjsmHT (read it with the Artifact tool, `project/canvas.json` first)

Approved by me: the V6 direction (neat, minimal, modern, frosted, with depth: near-black ground, the playing song's
glow across the top of every screen, frost only on the bottom shell and a few persistent surfaces, white as the only
accent, depth from the cover on Now playing), the Stream structure, and building it all into the app.

Do this:
1. **Finish the designs.** Start with the partial items in handoff §4a (the board-by-board hierarchy pass, the album and
   Blend pages in the new Playlist composition, the Up next empty state, a reduced-transparency frame), then bring every
   remaining board up to the V6 look (handoff §4) with the generator in
   `.planning/mobile-ui-review/design-drafts/` (`v5_kit.py`, `v5_round6.py`; `python v5_build.py ../design-gallery`;
   audit with `v5_audit.py`), check them side by side at phone scale and republish to the canvas (re-read it first so
   you never overwrite my edits). Ask me the open questions in handoff §6 once, up front; if I don't answer, use the
   recommended option in the handoff and say so.
2. **Build V6 into the app**, following handoff §5. Start with the pending uncommitted polish on this branch (device
   checks, bump `apps/mobile/app.json` `expo.version` to 1.36.0, commit, push, PR, merge when CI is green). Then: tokens
   → shared components → mini-player seek band and frosted shell (includes the Kotlin tab bar) → playback status →
   Library, Playlist (measure the loading suspects first, fix what the numbers show), Now playing, Stream → every
   other screen.
3. **Ship each step.** Small PRs from `feat/` branches. Each one: bump `expo.version` (minor for features, patch for
   fixes), `npm run mobile:check` green (typecheck, lint, tests), the three playback invariants intact, a regression
   test per fix, a check on a real phone (360 / 393 / 430 widths, 200% text, TalkBack basics), then push, open the PR,
   wait for CI (including the APK launch gate) and merge to `main` so the app updates through `apk-latest`. Tell me
   after each merge what shipped and which version it is.
4. **Keep the docs current**: move each shipped area's rules into `apps/mobile/DESIGN.md` (and delete the old ones they
   replace), and keep `.planning/mobile-ui-review/` updated so the next agent can continue.
