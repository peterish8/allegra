# Milestone: DJ companion

Context and locked decisions: [CONTEXT.md](CONTEXT.md). Progress: [STATE.md](STATE.md).
Plans: `phases/NN-slug/NN-MM-PLAN.md`, in GSD `execute` format. Paths inside plans are relative to
the repo root. This milestone lives in `.planning/dj-companion/` so it does not disturb the
hand-written `.planning/ROADMAP.md`.

## How to execute a plan

1. Read the plan top to bottom, then every file in the task's `<read_first>`. Line numbers move;
   confirm them before editing.
2. Do the tasks in order. A task is done when its `<verify>` commands and `<acceptance_criteria>` pass.
3. If the plan contradicts the code, stop and write what you found in the plan's SUMMARY. Do not
   improvise another design.
4. One commit per task, conventional subject (`feat(web): …`), no AI attribution lines.
5. At the end, run `<verification>`, write `NN-MM-SUMMARY.md`, update STATE.md.

Global gates (from `CLAUDE.md`): `npm run typecheck`, `npm run lint`, `npm test` exit 0. Web work is
checked at 360 / 768 / 1280 / 1920 on http://localhost:5173 (never :8080), and with
`prefers-reduced-motion: reduce`.

## Phases

| # | Phase | Goal | Depends on |
|---|---|---|---|
| 01 | DJ web overhaul | The DJ page feels like part of Allegra: dark glass, a living mascot, honest picks, a crate of results, and a DJ you can reach from any page. | none |
| 02 | DJ phone | The same experience on LuvLyrics (not planned yet; reuses 01-01's shared ranking, which already reaches the phone). | 01 |

### Phase 01: DJ web overhaul

Plans:
- [ ] 01-01 Honest picks: ranking and per-song reasons (wave 1)
- [ ] 01-02 One DJ session for the whole app (wave 1)
- [ ] 01-03 Dark-glass stage and the shape-shifting mascot (wave 2)
- [ ] 01-04 The crate: results, session chips, glass settings (wave 3)
- [ ] 01-05 Set shape: the energy arc you can drag (wave 4)
- [ ] 01-06 The DJ everywhere: mini mascot and ⌘J prompt (wave 3)
- [ ] 01-07 Waking the local model (wave 4)
- [ ] 01-08 Checkpoint: owner review at four widths (wave 5)

Waves: 01 and 02 run in parallel. 03 needs 02. 04 and 06 need 03. 05 and 07 need 04.
08 needs everything.

Success criteria:
1. "Late night Tamil melodies" with the local model returns no song chosen only because its title
   contains "late" or "night", and no two adjacent picks share the same reason text.
2. The DJ page has no surface lighter than the Home cards: every panel follows the clear-glass
   recipe in `docs/decisions.md` ("Surfaces are clear frosted glass").
3. While music plays, the mascot reacts to onsets from `useAudioAnalyser` (measurable: the
   `--dj-onset` custom property changes on beats), and under reduced motion only opacity changes.
4. After a turn returns songs, the first pick is visible without scrolling at 1280×800 and 360×740.
5. From Home, ⌘J (Ctrl+J) opens the DJ prompt; a request sent there changes the same session the
   DJ page shows (vibe, chips, history), without navigating.
6. The local model never starts a 390 MB download without a press on an explicit download button.
7. Playback invariants hold: one `<audio>` element, play/pause only through `requestPlayback`,
   music keeps playing across navigation to and from `/dj`.
