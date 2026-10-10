# DJ redesign: to-do list

Started 2026-10-10. Source: the owner's external audit (pasted in chat, not in the repo), checked
against the real code on `codex/dj-companion` and [`docs/dj.md`](../../docs/dj.md).

## Ground rules

- **Keep the stage layout exactly as it is:** the S-curved stage flowing into the prompt tab
  (`djStageShape.ts`, `useDjStageShape.ts`). The audit's "simplify the shape" item is **not** done.
- **Keep the owner's taste** (memory `design-taste-clear-glass`): clear frosted glass, no dark veils,
  subtle glows, icon-only buttons where the action is obvious, no clutter. Where the audit says
  "reduce glass", the change is **hierarchy** (primary / secondary / quiet controls), not removing
  glass.
- **Nothing fake.** No BPM, energy or "audio features" the catalog doesn't return. A planned energy
  shape is labelled as a plan. No mock songs, no invented metrics.
- CLAUDE.md rules: transform/opacity only, motion tokens, reduced motion collapses to opacity, no
  `any`, `{ success, data, error }`, `docs/api-contract.md` updated before any shape change, one
  `<audio>` element, `requestPlayback` funnel.
- Code changes go through the Edit tool (Write for new files).
- **Who does what:** `[S]` = small, handed to a Sonnet sub-agent (medium effort), each on files no
  other agent touches at the same time. `[B]` = big or cross-cutting, done by the lead agent.
- After each phase: `npm run typecheck`, `npm run lint`, `npm test`, a browser check at 360 / 768 /
  1280 / 1920, and screenshots.

Status key: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (with reason)

---

## Phase 1 — Page composition and hierarchy (S-shape kept)

- [x] `[B]` **Stage height fills the screen.** Stage + console use the viewport height minus the dock,
  so there is no dead black band under the hero. Queue column matches the hero's height and scrolls
  on its own.
- [x] `[B]` **Queue beside the stage** once the page is ≥ 880 px wide (a 1280 px window now gets the
  column), as tall as the stage. The S-curve keeps its room. The now-playing buttons wrap under the
  song in a narrow column.
- [x] `[B]` **Restrained song colour.** (Stage and now-row washes done; the mascot's own halo is Phase 2.) The stage wash drops to a soft light behind the mascot. Panels
  are neutral glass; the song's colour lives in the mascot, one light pool and the now-playing row.
- [x] `[B]` **Control hierarchy.** Three tiers: primary (send, Start this set, Save playlist), secondary
  (mode switch, energy), quiet (chips, tools). Not every pill gets the same glass.
- [x] `[B]` **Mode switch: "Live DJ" / "Playlist".** (Hint is the option's tooltip and the queue
  box subtitle, not an extra line, to avoid clutter.) A visible two-option segmented switch with a one-line
  hint under the active option. Playlist mode changes the queue box title to "Your playlist draft"
  and its primary action to Save.
- [x] `[B]` **Energy control: labelled.** Five rising bars + the level's word. Replace the five tiny dots with a 5-step control labelled
  Calm · Easy · Balanced · Lively · Hype, showing the current word. Targets ≥ 24×24 px.
- [x] `[S→B]` **Typography and contrast.** (Done by the lead: same files as the layout work.) Artist names, reasons and labels in the queue and now-playing
  row reach 4.5:1 on the glass. Larger title sizes in the queue.
- [x] `[S→B]` **Microcopy pass** (exact strings; the greeting keeps to what is true: "Enjoying “X”?
  Ask for more like it, or something new." rather than promising an action that isn't happening):
  - "Ask your DJ anything" → "What should we play next?"
  - Greeting with a song → "Enjoying this? I'll keep the next tracks in a similar style."
  - "More like ⟨artist⟩" → "More from ⟨artist⟩"
  - "Mix" → "Live DJ"
  - "Coming up" → "Up next · n songs"
  - Working → "Finding tracks that match your request…"
  - Generic failure → "Couldn't update the queue. Your music is still playing."
- [x] `[B]` **Context-aware starter chips.** Two chips that say what they will do, built from the real
  state (playing song, set energy, language), e.g. "Calmer next", "More from ⟨artist⟩", "Keep it
  ⟨language⟩". No generic "Sing along" unless a song is playing and has lyrics.
- [x] `[B]` **Session strip.** Vibe · energy word · language at the top of the stage, and "DJ set
  playing" only while the song playing is one the DJ picked (radio and search plays don't count; the
  now-row "DJ" badge uses the same rule now).
- [x] **Owner fixes (2026-10-10, from an annotated screenshot):** no sparkle in the prompt; send is a
  plain arrow-up circle (also on the Ctrl+J pill); a clear gap between the console and the player
  bar; a compact now-playing row; the queue column lists up to 40 upcoming songs and scrolls.
- [ ] `[S]` **Player bar on /dj** shows the same DJ badge as the now-playing row while a DJ set plays,
  so the dock and the stage read as one system.

## Phase 2 — Mascot and conversation states

- [x] `[B]` **Mascot 25% smaller on desktop** (`--m-size` now ≤ 256 px, half the room's height).
- [x] `[S→B]` **Song notes removed** (component, CSS and their dead tokens; old hop/float tokens too).
- [x] `[B]` **Material refinement.** Softer highlight, lighter blush and floor shadow, solid soft eyes
  with no halo, a smaller stage light.
- [x] `[B]` **Behaviour hierarchy.** A joy hop or error shake stops beat nods for 0.9 s
  (`REACTION_FOCUS`, tested); typing no longer nods per key (focus already makes it look at the input).
- [x] `[B]` **Sleep after inactivity.** 90 s with nothing playing, no work, no listening and no
  pointer/key → `sleep` pose and `sleeping` face; any move wakes it.
- [x] `[B]` **Paused = quiet idle.** Already true: groove only while a song plays on this device.
- [x] `[B]` **Short outcome replies** (`djOutcome`, tested): "Updated the next 5 tracks. Your current
  song stays.", playlist counts, etc., from the songs App really placed (`applyDjPlan` now returns the
  count). The model's sentence goes to the conversation; the voice says the outcome.
- [x] `[B]` **Conversation drawer** (`DjHistory`): a quiet icon beside the "i", a solid-veil sheet.
- [x] `[B]` **Follow-up offers after a set** (`djOffersAfterSet`, tested): Undo · Less like this ·
  Even calmer / A bit calmer / Even more hype.
- [x] `[B]` **Mic states** on the button (`data-state`: ready / listening / writing with a spinner);
  the stage light dims while it listens. Send is a Stop square while the DJ works.
- [-] **Correct before acting** (spoken countdown). Owner: no countdown; Undo covers it.

## Phase 3 — Recommendations, queue safety and the agent

- [-] **"Basic" brain as the default.** Owner: keep the first-run question.
- [x] `[B]` **Request lifecycle.** Each turn has an id and an AbortController; a newer request aborts
  the older one; a stale or stopped result is dropped. Stop square while it works. App commands
  ("pause") run even mid-plan. Not exercised live with a cloud key (would send a key to a provider).
- [x] `[B]` **Queue safety.** A plan always lands on the live queue (`applyDjPlan` reads the player at
  apply time, protects the current song and the listener's own songs). Undo only runs while the
  upcoming list is exactly what the set made; an edited queue is left alone.
- [ ] `[B]` **Typed action validation.** One validator for every DJ action (from the parser or a
  model plan): catalog IDs only from this turn's searches, playable stream required, current song and
  the listener's own queued songs protected. Unit-tested.
- [ ] `[B]` **Hard filters in ranking:** no unplayable streams, no excluded artists, no duplicates,
  no songs that break explicit constraints ("no ⟨artist⟩", "not the same artist").
- [ ] `[B]` **Explicit request beats diversity.** "Only Anirudh", "all Arijit songs" lifts the
  two-per-artist cap.
- [ ] `[B]` **Sequencing.** No same artist back to back; the planned energy shape (below) orders the set.
- [ ] `[B]` **Set shape (plan 01-05).** Build up · Steady · Wind down · Dynamic. It shapes the searches
  per slot (calmer/livelier queries) and is labelled "planned shape", never "measured energy".
- [ ] `[B]` **Exploration control:** Familiar · Balanced · Discover, changing the taste weights
  (Discover lowers known-artist boosts and prefers artists not in recent/liked).
- [ ] `[B]` **Feedback that means different things:**
  - Skip = this song, right now (session only, as today).
  - Less like this = avoid this artist for the session.
  - Never play this artist = persistent exclusion (see memory below).
  - Queue row overflow menu: Play next · More like this · Less like this artist · Never play this
    artist. DJ-owned rows only for the removing actions.
- [ ] `[B]` **Long-term taste (opt-in).** Preferred languages, artists, exclusions, exploration level.
  Off until the listener turns it on; inspect, reset, export and delete in settings. (Where it is
  stored: owner decision Q1.)
- [ ] `[B]` **Cloud tools only where data is real.** Add `get_user_taste` (only when taste is on) and
  pass exclusions/shape to the model; no feature tools that would return nothing. Contract doc
  updated first.
- [ ] `[S]` **Playlist draft:** total duration ("about 42 min", from real `duration` seconds) and a
  per-row "Swap" that asks for one replacement.

## Phase 4 — Voice and playback hardening

- [x] `[S]` **Separate rate limits** for `/api/ai/dj/turn` (20/min), `/transcribe` and `/speak`
  (30/min each), not the shared discovery bucket. Contract doc updated; `app.djRateLimit.test.ts`.
- [ ] `[B]` **Ducking manager.** Ramps the music down and back smoothly; if the listener changes the
  volume while ducked, that becomes the volume to return to.
- [ ] `[B]` **AudioWorklet capture** (inline module via Blob URL), with ScriptProcessor kept only as a
  fallback when worklets are unavailable.
- [x] `[S]` **Fisher–Yates shuffle** in `playDjList` (`lib/shuffle.ts`, wired by the lead).
- [x] `[S]` **Byte-weighted download progress** (`lib/modelProgress.ts`) for Qwen, Moonshine/Whisper and Kokoro (sum of loaded /
  sum of total across files), so the % only moves forward smoothly. Plan 01-07.
- [ ] `[B]` **Listening language.** Settings: English · Tamil · Hindi (Web Speech `lang`), and an
  on-device "Multilingual" model (Whisper base) for non-English, since Moonshine and tiny.en are
  English-only.
- [x] `[S]` **How often it talks:** Silent (voice off) · "When I talk to it" (default) · "Every reply".
- [ ] `[B]` **Kokoro duplicate runtime.** Try making kokoro-js use the app's transformers v4 (npm
  `overrides`), prove a sample still generates in the browser; keep v3 if it breaks.
- [x] `[S]` **Settings label:** "On this device (Whisper)" → "On this device · free" with the right
  model named in the note.
- [x] `[S]` **Privacy copy fix** in `docs/dj.md` §13 and the settings sheet: on-device means inference
  and recordings stay local; catalog searches still use Allegra's service.
- [x] `[S]` **Contract note fix:** rate-limit wording in `docs/api-contract.md` for the DJ routes.
- [ ] `[B]` **Low-power mode.** `hardwareConcurrency ≤ 4` or `deviceMemory ≤ 4` → fewer blurred layers
  and no mascot drift; same features.

## Phase 5 — Tests, checks and docs

- [ ] `[S]` **100-request regression set** (`apps/web/src/lib/djRequests.test.ts`): playback commands,
  vibe changes, Tamil and Tanglish requests, conflicting constraints, playlist edits, "not the same
  artist", artist-only sets. Checks routing (action vs model) and heuristic intent.
- [ ] `[S]` **Unit tests** for the validator, ranking filters, sequencing, set shape, exploration,
  shuffle, progress aggregation and ducking maths.
- [ ] `[B]` **Playwright journeys** in `tests/e2e` (already set up): typed "play X", "play X next",
  set applies → Undo, playlist draft → save, mode switch, energy control, QR card. No microphone.
- [ ] `[B]` **Accessibility pass:** contrast, 24 px targets, focus order, live regions, reduced motion,
  reduced transparency.
- [ ] `[B]` **Widths:** 360 / 768 / 1280 / 1920 screenshots.
- [x] `[S]` **API logging:** one structured line per DJ turn/transcribe/speak (route, provider, goal,
  ms, status, songs) through `createLogger`, production only; never the key, message text or audio.
- [ ] `[B]` **Docs:** `docs/dj.md`, `docs/decisions.md`, handoff, STATE.md.

## Not doing, with reasons

- `[-]` **Simplify the S-curve stage.** Owner: keep the layout.
- `[-]` **Audio-feature analysis (Essentia / librosa, BPM, timbre, embeddings).** Needs licensed access
  to the audio for offline analysis; the catalog providers stream it, they don't license it for
  analysis. Until then ranking uses only real metadata and taste signals.
- `[-]` **Cloud tools with no data behind them** (`get_track_features` etc.). They would return
  "unknown" every time.

## Owner decisions (2026-10-10)

| Question | Answer | Effect on this list |
|---|---|---|
| Long-term taste: where? | **Account (Convex)**, opt-in | New Convex table + functions; `npx convex dev --once`; privacy note; export/delete in settings. Touches `convex/_generated` → bump `expo.version` in `apps/mobile/app.json` (CLAUDE.md). |
| First-run default brain | **Ask first, like today** | "Basic brain as default" dropped. |
| Commits | **Per phase** | Step 0 commits the existing work in logical pieces; each phase ends in commits after checks. Not pushed. |
| Voice countdown | **None** | "Correct before acting" dropped; Undo is the safety net. |

## Step 0 — Commit the existing work

- [x] `[B]` Run checks, then commit the uncommitted DJ work in logical conventional commits (no
  `apps/desktop/`, no AI footers). `f310519`…`2881876`.
