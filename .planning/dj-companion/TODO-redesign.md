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

- [ ] `[B]` **Mascot 25% smaller on desktop** (stage size token), adjust after a look.
- [ ] `[S]` **Song notes off by default.** Remove the drifting ♪ ♫ from the stage mascot.
- [ ] `[B]` **Material refinement.** Softer specular highlight, less blush, lighter floor shadow,
  eyes as soft shapes rather than strong white glows.
- [ ] `[B]` **Behaviour hierarchy** (ambient → interactive → consequential): a consequential event
  (set applied, error) visibly overrides the groove; typing makes it look at the input instead of
  nodding on every key.
- [ ] `[B]` **Sleep after inactivity.** Nothing playing and no interaction for 90 s → `sleep` mode and
  `sleeping` face; any pointer, key or new song wakes it at once.
- [ ] `[B]` **Paused = quiet idle.** Groove only while audio actually plays (check the current rule).
- [ ] `[B]` **Short outcome replies.** After a set applies, the caption says what changed, from real
  numbers: "Updated the next 5 tracks. Your current song stays." The model's own sentence goes to
  history.
- [ ] `[B]` **Conversation drawer.** History (last 8 turns) behind a quiet icon on the stage; the
  caption only shows the latest line.
- [ ] `[B]` **Follow-up offers after a set:** Undo · Less like this · Even calmer / More hype (picked
  from the energy just used).
- [ ] `[B]` **Mic states that can't be missed:** ready → listening (ring + live transcript) →
  writing it down → working → done, on the mic button itself; the mascot's other motion dims while
  listening.
- [-] **Correct before acting** (spoken countdown). Owner: no countdown; Undo covers it.

## Phase 3 — Recommendations, queue safety and the agent

- [-] **"Basic" brain as the default.** Owner: keep the first-run question.
- [ ] `[B]` **Request lifecycle.** Every turn gets a `requestId`; a newer request aborts the older
  one; a stale result is dropped, never applied. A Stop button while it works.
- [ ] `[B]` **Queue revisions.** App counts queue changes; a plan remembers the revision it was made
  against; if the current song changed before it lands, it is re-applied against the new queue (or
  dropped with a message). Undo refuses when the queue moved on.
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
