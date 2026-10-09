# DJ companion — context and locked decisions

Gathered 2026-10-09 from a live test of `/dj` at 1280×800 and the owner's answers.

## Where it stands (branch `codex/dj-companion`, uncommitted)

- `apps/web/src/components/DjPage.tsx` (452 lines) holds **all** DJ state locally: provider, model,
  key, prompt, session, goal, songLimit, draft, history, skipped, turn, reasons, emotion, status.
  Nothing outside the page can talk to the DJ.
- Styles: `apps/web/src/styles/app.css` from about line 7509 (`.dj-page`, `.dj-hero`, `.dj-aura*`,
  `.dj-mascot-*`, tones via `data-tone`). The hero is a cream/white radial slab
  (`--dj-pale` ≈ white) on a dark app: the single biggest mismatch with the rest of the site.
- Audio: `useAudioAnalyser(audioRef, isPlaying)` already gives `readLevel()` and `readBands()`
  (`lib/bands.ts`: bass / mid / treble with attack and release). DjPage writes `--dj-audio-energy` and
  `--dj-onset` per frame, but the CSS barely uses `--dj-onset`.
- Picks: local turns rank through `rankDjLocalCandidates` in `packages/shared/djLocal.ts`.
  `overlapScore` adds 2 points per query word found in title/artist, so a song *titled* "Late Night"
  beats a real late-night Tamil melody; and `languageMatch` gives the same reason to every pick.
- App wiring (`apps/web/src/App.tsx`): `applyDjPlan` / `startDjPlan` already apply a turn to the
  queue; ⌘K opens `CommandPalette` (keydown listener around line 666); the mini player is the
  `motion.div.mini-player` around line 1684; the playing cover's colours are `palette`
  (`lib/palette.ts`, `{ primary, secondary, tertiary }`) and `shaderPalette`.
- Live test 2026-10-09: the on-device Qwen3 model downloaded (~2–3 min), loaded and returned 8 real
  songs; the strict-parser error is fixed by `resolveDjLocalIntent`.

## Owner decisions (2026-10-09)

| Question | Decision |
|---|---|
| Mascot | **Both:** a clear-glass orb tinted by the playing cover while idle, which flattens into a spinning record (grooves, cover on the label, eyes on the label) while music plays. |
| Hover preview | **Out.** Keeps the one-`<audio>` rule. A tap on a crate card plays the song instead. |
| Platforms | **Website first.** Phone is phase 02, not planned yet. |
| Look | From memory `design-taste-clear-glass`: clear frosted glass, no dark or grey veils, subtle glows (owner said "too vibrant" twice), icon-only buttons where obvious, no clutter, distinctive rather than standard. |

## Rules that bind every plan

- `CLAUDE.md` hard rules 5–7: animate `transform`/`opacity` only; durations/easings from
  `apps/web/src/motion/index.ts`; CSS uses `--d-*` and `--ease-*` from `styles/tokens.css` (there are no `--motion-*` tokens);
  reduced motion collapses to opacity and never removes a feature.
- Playback invariants: `requestPlayback` only; no load effect depends on `isPlaying`; one `<audio>`
  in the layout.
- Truthfulness: the DJ never claims BPM, genre, mood or audio features that the catalog did not
  return. The energy arc (01-05) shows the *planned* shape, labelled as such, not measured energy.
- No `console.log`; TypeScript strict, no `any`.
- A control that does nothing is not shipped.

## Review fixes (2026-10-09, plan check by Opus)

All 30 findings applied except: network checks use the built-in browser pane (allowed), and floating
sheets (settings, Ctrl+J pill) keep a solid veil per docs/decisions.md. 01-05 splices on the client, so
the API contract does not change. DJ picks get their own `djPlannedRef`; web tests stay in `src/lib`.

## Out of scope

Hover preview, AI voice, generating music, phone UI, server-hosted model.
