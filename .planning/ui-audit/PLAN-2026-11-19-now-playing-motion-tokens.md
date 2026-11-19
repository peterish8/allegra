# Plan: now-playing screen, motion and colour-token fixes

**Date:** 2026-11-19 · **Scope:** `apps/web` (Phase 6 covers `apps/mobile`) · **Branch:** `fix/now-playing-motion-tokens`
**Source:** UI audit of 2026-11-19, using charles-ux-animation, charles-polish and WCAG 2.1 AA contrast checks.

Each item has a checklist, the files it touches and how to prove it is fixed. Work the phases in
order. Phases 1 and 2 are bugs. Phases 3–5 pay down token debt and depend on Phase 3's token decisions.

---

## Ground rules (from CLAUDE.md)

- [ ] Animate `transform` and `opacity` only, with every duration and easing taken from a token. Reduced motion collapses to opacity and never removes a feature.
- [ ] Don't regress the playback invariants: the single `<audio>` stays in the layout, play/pause goes through `requestPlayback`, and a seek resumes playback.
- [ ] One commit per item or small group, as a conventional commit (`fix(web): …`, `refactor(web): …`, `chore(web): …`).
- [ ] Re-grep before deleting anything; another task may have started using it.
- [ ] Before every push: `npm run typecheck`, `npm run lint` and `npm test` all exit 0.

---

## Phase 1 — Broken behaviour on the now-playing screen (P0)

### 1.1 Escape on the karaoke info popover closes the whole player
- **File:** `apps/web/src/components/PlayerPanel.tsx` (`KaraokeStatus`, the keydown effect at about line 1026)
- [x] Register the popover's `keydown` listener in the capture phase (`document.addEventListener('keydown', fn, true)`), copying the approach in `PlaylistMenu.tsx:37`.
- [x] On Escape, call `event.stopPropagation()` and `event.preventDefault()`, then `setOpen(false)`.
- [x] Return focus to the ⓘ button when the popover closes.
- [x] Remove the listener with the same `capture` flag in the cleanup.
- [x] Test: render the player with the karaoke popover open, press Escape, and assert the popover closed and `onCollapse` was **not** called.
  > Note: The suite has no DOM (node --test over src/lib), so the test drives the shared listener (lib/escapeLayer.ts) with a document and a window and checks the player's handler never runs, plus a source check that KaraokeStatus uses it and refocuses the button. A browser check is still worth doing in e2e.
- **Done when:** with the popover open, Escape closes only the popover, and a second Escape closes the player.

### 1.2 A CSS transition fights Motion on the phone cover
- **File:** `apps/web/src/styles/app.css:5452`
- [x] Delete `.listening-world .np-art { transition: opacity …, transform … }` inside `@media (max-width: 900px)`. Motion owns that element's opacity and transform.
- [x] Remove the dead `transform: none` on `.np-art` in the `max-width: 900px and reduced-motion` block (an inline Motion style always beats it).
- [x] Confirm the desktop `translate` transition (`app.css:7212`) stays. It's a separate property, so it doesn't clash.
- **Done when:** at 360px, a swipe on the cover tracks the finger with no lag. A Performance recording of a Next swipe shows no long transition tails on `.np-art`.

### 1.3 The cover slide is clipped into a square on phones
- **Files:** `apps/web/src/styles/app.css:5948`, `PlayerPanel.tsx` (`AppleMotionArtwork`)
- [x] Remove `overflow: hidden` and `isolation: isolate` from `.listening-world:not(.is-lyrics):not(.is-panel) .np-art`.
- [x] The video is already inside `.np-art__slide`, which clips and rounds it, so the frame doesn't need clipping. Check that `.np-art__canvas` gets the slide's corner radius.
- [x] If the video still overflows anywhere, add `.np-art:has(.np-art__canvas) { overflow: hidden }` instead of clipping every cover.
  > Note: Not needed: the slide clips and rounds the canvas, so no fallback rule was added.
- **Done when:** at 360 and 768px, Next/Prev covers slide past the frame edge with rounded corners and shadow intact, with and without a motion-video cover.

### 1.4 The reduced-motion rule for the play button and scrubber thumb never applies
- **File:** `apps/web/src/styles/app.css:~4596`
- [x] Split the selector list into three rules: `::-webkit-slider-thumb {}`, `::-moz-range-thumb {}` and `.ctrl-play {}`. Each browser drops a whole selector list that contains a pseudo-element it doesn't know.
- [x] Per hard rule 7, keep opacity changes and remove only the scale: under reduced motion, `.ctrl-play:active, .ctrl-play[data-pressed='true'] { transform: none; opacity: 0.8; }`.
- [x] Do the same for `.tactile-icon-control:active` in the player (`app.css:5226`): no scale under reduced motion, just an opacity dip.
- **Done when:** in Chrome and Firefox with "reduce motion" on, DevTools shows the rule applied, and a press dims the button without scaling it.

---

## Phase 2 — Friction and polish on the now-playing screen (P1)

### 2.1 Perspective sits on the wrong element
- **File:** `PlayerPanel.tsx:453`, `components.css` (`.now-playing`)
- [x] Move `perspective: 900` from `.np-art`'s inline style to `.now-playing` (desktop and phone).
- [x] Keep `perspective` on `.np-art` as well, so the cover deck inside it keeps its depth. Turn the number into a token (`--perspective-cover: 900px`).
  > Note: --perspective-cover is set on .now-playing, on .np-art and, on desktop where .now-playing is display: contents, on .listening-body.
- **Done when:** at 1280px, the lyrics-focus move shows the sleeve turning away in 3D instead of squashing flat.

### 2.2 The active lyric line snaps its scale and scales off-centre
- **File:** `apps/web/src/styles/components.css:~1855`
- [x] Change the line transition to `opacity var(--d-base) var(--ease-standard), transform var(--d-base) var(--ease-decelerate)` (this also removes the hard-coded `0.35s cubic-bezier`).
- [x] Keep `!important` only where the comment explains the `@layer legacy` reason, and note the reason beside each one.
- [x] Add `.listening-world.is-lyrics-full .ytm-lyrics__line.is-active { transform-origin: center; }`.
- [x] Reduced motion: no scale on the active line, opacity only.
- **Done when:** at 1280px and 360px, the line change eases both opacity and scale, and centred lines grow from their centre.

### 2.3 Title and artist marquee: hold, pause, and a reduced-motion ellipsis
- **Files:** `PlayerPanel.tsx` (`MarqueeText`), `app.css:4807–4846`, `motion/index.ts`
- [x] Add `motionTokens.marquee.holdSeconds` (about 1.5) and use it as `animation-delay` before the first lap.
- [x] Pause on `:hover` and `:focus-within` (`animation-play-state: paused`). This covers WCAG 2.2.2.
- [x] Reduced motion: don't render the second `aria-hidden` copy. Put `overflow: hidden; text-overflow: ellipsis; max-width: 100%` on `.np-marquee__item` so the ellipsis actually shows.
- [x] When the duration changes on resize, keep the animation in step (key the track on the rounded duration) so it doesn't jump.
- **Done when:** a long title waits, then scrolls; hovering stops it; reduced motion shows `Title…` with a visible ellipsis.

### 2.4 Sheet exit: shorter, and the right height on phones
- **Files:** `PlayerPanel.tsx:337–339`, `motion/index.ts`
- [x] Use `y: '100%'` instead of `'100vh'` for `initial` and `exit` (`100vh` is wrong on phones with dynamic browser toolbars).
- [x] Add `motionTokens.duration.sheetExit` (about 0.22) with `ease.accelerate`. Keep `spring.sheet` for opening and for a drag-release snap.
- [x] A swipe-dismiss that releases with speed keeps the spring, so the motion continues the throw.
- **Done when:** the player opens with the spring and closes faster with ease-in, and on a phone nothing shows below the sheet while it moves.

### 2.5 Press scale floors
- **File:** `app.css:4570` (`.ctrl-play` 0.94 → 0.96) and `app.css:5226` (icons 0.92 → 0.95)
- [x] Add a `--press-scale: 0.96` token (and `--press-scale-small: 0.95`) and use it in both places.

### 2.6 Hard-coded numbers in PlayerPanel
- [x] `PlayerPanel.tsx:207`: replace `1600` with `motionTokens.hold.note` (a new token group `hold`, in ms or s, documented).
- [x] `PlayerPanel.tsx:527`: use `motionTokens.delay.scene` (or a new `delay.meta`), not `duration.fast`, for the delay.
- [x] `PlayerPanel.tsx:174`: simplify `useState<ListeningTab>(mode === 'workspace' ? 'lyrics' : 'lyrics')` to `useState<ListeningTab>('lyrics')`.

### 2.7 Readability on pale covers
- **Files:** `apps/web/src/lib/playerWash.ts`, `playerWash.test.ts`
- [x] Add a helper that lowers the main-glow alpha (layer 2) until white text over the brightest point of the wash is at least **4.5:1** (use `palette.ts`'s luminance function).
- [x] Unit tests with pale yellow `#fff25c`, white `#ffffff` and a mid grey: assert the top-right composite is ≥ 4.5:1 against `#fff`.
- [x] Keep the function pure. No animation changes.
- **Done when:** the tests pass, and at 1280px the lyrics over a white or yellow album cover stay readable.

### 2.8 Lighter paint cost for player icons
- **File:** `app.css:5153–5160, 5192–5208`
- [x] Replace the per-icon `filter: drop-shadow` with a single soft scrim behind the controls row (a static gradient, never animated), or drop it where the wash is already dark.
  > Note: Dropped the per-icon drop-shadow rather than adding a scrim: the controls sit on the lower half of the wash, which fades to near-black.
- [x] Delete the glass-card declarations for `.np-controls` (`app.css:5101–5111`) that `5182–5191` immediately undoes.

### 2.9 Merge the now-playing CSS into one place
- [x] Create `apps/web/src/styles/player.css`, imported once after `app.css`.
- [x] Move every `.listening-world`, `.np-*`, `.ctrl-play`, `.listening-progress`, `.player-tabs`/`.ptab` and `.player-sidepanel` rule there, from `app.css`, `components.css` and `global.css`.
- [ ] Collapse rules that are set more than once (`.np-controls`, `.np-actions`, blob opacity and duration) into one declaration each.
  > Note: Partly done. Declarations a later rule of the same selector overrides are gone (44 removed), and the dead legacy `.mini-player` rule and its `border-color` are deleted. The remaining same-selector rules each carry different properties; merging them moves declarations past other rules of equal specificity (a first attempt changed `.np-meta` to 380px and the phone bar's grid), so they stay as separate rules. Blob rules went with 5.1.
- [x] Do the same for `.mini-player` (4 definitions: `app.css:2318, 2738, 4858`, `components.css:1232`).
- **Done when:** `grep -c "listening-world" styles/app.css` is 0, and the visual check at 360/768/1280/1920 matches before/after screenshots.

---

## Phase 3 — Motion tokens: one source of truth (P1)

### 3.1 Make the JS and CSS tokens match
- **Files:** `apps/web/src/motion/index.ts`, `apps/web/src/styles/tokens.css`, `styles/tailwind.css`
- [x] Pick one value for each token: `panel` 0.24 vs 300ms, `slow` 0.4 vs 420ms. The skill's table puts sheets and modals at 200–300ms, so a 300ms panel and 400ms slow are a reasonable choice.
  > Note: `panel` is 300ms and `slow` 400ms in both places. JS `duration.panel` went from 0.24 to 0.3 and CSS `--d-slow` from 420ms to 400ms.
- [x] Make `ease.tactile` and `--ease-tactile` the same curve.
  > Note: Both are `cubic-bezier(0.2, 0, 0, 1)`; `--ease-tactile` is an alias of `--ease-press`.
- [x] Generate the CSS tokens from `motion/index.ts`, or add a test (`motion/tokens.test.ts`) that parses `tokens.css` and fails when the two sets disagree.
  > Note: The parity test is `src/lib/motionTokens.test.ts` (the web test glob only covers `src/lib`). It covers durations, eases and `--delay-scene`, and it runs from `npm run lint` as well as `npm test`.
- [x] Replace `--ease-in-out: ease-in-out` with a real curve (`cubic-bezier(0.77, 0, 0.175, 1)` for moving and resizing on screen).
  > Note: JS has the same curve as `ease.inOut`.
- [x] Remove `duration.micro: 0.01` if nothing uses it (reduced motion has its own `--d-reduced`).
  > Note: Kept: `InfoTour.tsx` still uses `duration.micro`.

### 3.2 One timing for the song-change crossfade
- [x] Add a single `--d-song-change` (CSS) and `duration.songChange` (JS). Suggested: 900ms, `--ease-standard`.
- [x] Apply it to the player wash (`PlayerPanel.tsx`, now `cinematic`), `.app-shell` and the aura (`app.css:82, 455`), and `.fluid__scene` (`app.css:5365`).
  > Note: `.fluid__scene` was part of the unused fluid backdrop deleted in 5.1.
- [x] Rename or remove `--d-atmosphere` once nothing else uses it (it's also used by `apk-float` and the reduced-motion DJ loops, so give those their own token).
  > Note: Gone. The DJ loops use `--d-loop-live`, the apk card float `--d-loop-float`, and the DJ backdrop crossfade `--d-song-change`.

### 3.3 Replace hard-coded durations and easings in CSS
- [x] Re-run the audit script (save it as `scripts/audit-motion-css.py` or as a lint test) and clear its list: **83 hard-coded durations, 19 bare `ease*` keywords, 3 one-off `cubic-bezier`s**.
  > Note: The audit is the existing ratchet in `src/lib/cssGuards.test.ts` (baseline file next to it), extended with a `bareEase` rule. The 83 durations, 19 bare easings and 3 one-off curves it counted are all at zero, apart from what 5.1 deleted. Two dead reduced-motion durations (`.cmdk-spinner`, `.ctrl-play-wait`) were removed because the global block overrides them.
- [x] Loops and ambient motion: add named loop tokens (`--d-loop-wave`, `--d-loop-pulse`, `--d-loop-orbit`, …) and don't inline numbers.
  > Note: New tokens: `--d-loop-*`, `--delay-scene` and `--d-step`; bar delays are multiples of `--d-step`.
- [x] Use `--ease-standard` for loops that breathe and `linear` for spinners and marquees.
- [x] Add a check to `npm run lint` (Stylelint `declaration-property-value-disallowed-list`, or the script) that fails on a new `\d+m?s` or bare `ease` inside `transition` or `animation`.
  > Note: `npm run lint` in `apps/web` now runs `eslint` and then `cssGuards.test.ts` and `motionTokens.test.ts`. CI runs both lint and test.

### 3.4 Replace `filter` transitions
- [x] `app.css:259, 3208, 3989, 3998, 8182, 8198`, `components.css:2079`, `global.css:2951`: replace brightness or drop-shadow transitions with an opacity crossfade of an overlay (`::after`) layer.
  > Note: `.btn-primary` and the karaoke model button now lift on hover with a white layer fading in behind the label. The two DJ nav icons use their existing glow layer. `.auth-submit` and `.auth-google` only listed `filter` in their transitions, so it was dropped. `.mood-pill` lost its brightness hover (its border, background and lift remain).

### 3.5 Reduced motion collapses to opacity
- **File:** `app.css:8344` (the global `*` block)
- [x] Stop forcing `transition-duration: 0.01ms` on everything. Instead, remove transform movement under reduced motion and keep opacity transitions at `--d-instant` (100ms), matching `reducedTransition` in `motion/index.ts`.
  > Note: The global block now keeps only fades (opacity and colour) in `transition-property` at `--d-instant`, so movement jumps to its end.
- [x] Keep the exemptions for loading indicators (spinners must keep moving).
- [ ] Spot-check: modal, sheet, toast, tabs, lyrics and the player all fade (rather than snap) under reduced motion, with no movement.
  > Note: Checked in the player only (computed styles under reduced motion: only opacity and colour transition, at `--d-instant`; movement jumps). Modal, sheet, toast and tabs elsewhere were not opened in a browser.

---

## Phase 4 — Colour tokens (P1)

### 4.1 Contrast of the active icon colour
- **Files:** `components/ui.tsx:52`, `tokens.css`
- [x] Add `--icon-active` (and Tailwind's `--color-icon-active`) with at least **3:1** contrast on `--surface-raised`. `--accent` (#ee6b5f, about 6:1) or `--accent-bright` both work.
  > Note: `--icon-active` is `--accent`, 5.2:1 on `--surface-raised`.
- [x] Use it in `IconButton` instead of `text-accent-deep`. Delete the player-only override at `app.css:5175`, or point it at the same token.
  > Note: The player-only override was deleted, so active player icons are coral like everywhere else.
- [x] Add a contrast test (`lib/tokens.contrast.test.ts`) that reads `tokens.css` and checks text tokens ≥ 4.5:1 and icon/border tokens ≥ 3:1 on `--bg` and `--surface-raised`.
  > Note: Borders are left out: `--border` and `--border-strong` are decorative hairlines at 1.5:1 and 2.3:1. Raising them is a visible design change and is a follow-up.

### 4.2 Text steps that differ
- [x] Make `--ink-faint` visibly weaker than `--ink-muted` but still ≥ 4.5:1 on `--bg` (about `#7b8288`). Recheck every place `--ink-faint` is used.
  > Note: `--ink-faint` is #828a8f (4.5:1 on a raised surface). `--ink-muted` went to #99a0a4 so the two steps differ.

### 4.3 Names that match their colours
- [x] `--accent-soft` / `--accent-border` (blue) → `--stage-blue-soft` / `--stage-blue-line` (these already exist), then delete the old names.
- [x] `--shadow-glow` (sky blue) → derive it from `--accent-glow`, or rename it `--shadow-glow-blue`.
  > Note: Renamed `--shadow-glow-blue`.
- [x] `--glass-surface` / `--glass-strong` (Tailwind slate) → derive them from `--surface-glass` / `--surface-glass-heavy`.
- [x] `--listen-surface-soft` (58% white): find what uses it, then fix or delete it.
  > Note: Its only user was `.motion-toggle`, whose earlier rule already gives it a dark glass fill; the 58% white declaration was dropped.

### 4.4 Remove duplicate tokens
- [x] `--tone-sky` = `--stage-blue`, `--accent-cobalt` = `--stage-cobalt`, `--accent-violet` ≈ `--stage-violet`, `--shadow-button` ≈ `--tactile-shadow`: keep one name for each, alias it for one release, then delete the alias.
  > Note: `--tone-sky`, `--accent-cobalt` and `--shadow-button` stay as aliases for one release; the unused `--accent-violet` went with 4.7.

### 4.5 Accent roles
- [x] Write the roles in `docs/` (design tokens section): **coral** = brand/primary action, **chartreuse `--wave`** = playback state and focus inside the player, **blue `--stage-*`** = Connect/stage only, **violet** = Blend only.
  > Note: Written in `DESIGN.md` (Accent roles), next to the colour architecture. `.btn-primary` still fills with `--wave`, which the plan's roles do not match; flagged there as an open design call.
- [x] Use one focus-ring token: `--focus-ring`. Point `tailwind.css:95` and the player's `color-mix(… --wave …)` rings at it, and drop the `#d9e66a` fallbacks.
  > Note: `--focus-ring` is coral by default and chartreuse inside `.listening-world`.

### 4.6 Replace hard-coded colours, the player first
- [x] Player: add `--on-art` (#fff), `--on-art-muted` (rgba 255/255/255 0.9), `--on-art-faint` (0.66), `--on-art-track-rest`, `--on-art-track-done` and `--on-art-shadow`, and replace every `#fff` / `rgba(255,255,255,…)` in `player.css`.
  > Note: The player has no colour literals left. Translucent whites and blacks are `color-mix(in srgb, var(--on-art) N%, transparent)`.
- [x] `--primary-fill` for the play disc gradient (`app.css:5132`) instead of `#fffefb` / `#e2e5ec`.
  > Note: Named `--play-disc-fill` (the existing `--primary-fill` is a flat cream, not this gradient).
- [ ] Then work through the rest by file: `app.css` (344 hex / 784 rgba), `global.css` (146/298), `dj.css`, `components.css`, `blend.css`. Track the remaining counts in this plan.
  > Note: Remaining colour literals (CSS guard baseline), from 2088 at the start: `app.css` 181, `global.css` 238, `dj.css` 50, `components.css` 49, `blend.css` 12, `player.css` 0 (530 in all). Every translucent white or black and the colours that already have a token were converted (1166 declarations), checked by a computed-style diff of seven routes at 360 and 1280 and of the player at all four widths. What is left are one-off hexes and rgba values with no token (about 5 of them repeat more than 5 times: `#050608`, `#f5f2eb`, `#15170c`, `#07121c`); they need design decisions before they get names. `--ink` and `--bg` are redefined locally in a few scopes, so their literals were not mapped.
- [x] TS/TSX: `blend/shareCard.ts` (canvas drawing, so it may keep literals but should import them from one `lib/colors.ts`), `TasteOnboarding.tsx`, `dj/DjTour.tsx`, `lib/djDance.ts`, `infoScenes.tsx`.
  > Note: `lib/colors.ts` holds the brand colours, the tour cover gradients and the share-card colours (a test keeps the brand colours equal to tokens.css); `shareCard.ts`, `TasteOnboarding.tsx`, `infoScenes.tsx` and `DjTour.tsx` use it. `lib/djDance.ts` is mood palette data and is unchanged.
- [x] Add a lint check: no new hex or `rgba(` literal in `styles/*.css` outside `tokens.css` (allowlist the existing ones and shrink it over time).
  > Note: This was already in place: the `rawColor` ratchet in `src/lib/cssGuards.test.ts`. Its baseline now only allows existing literals per file, and `player.css` is at zero.

### 4.7 Unused tokens
- [x] Delete them after a final grep (and ignore `--tone-*`, which `blendTones.ts` builds in code): `--accent-blue`, `--accent-green`, `--accent-violet`, `--edge-glow`, `--gradient-glass`, `--gradient-glow`, `--listen-rail`, `--listen-surface-raised`, `--motion-duration-instant`, `--primary-edge`, `--space-2xl`, `--stage-violet`, `--surface-inverse`, `--transition-smooth`, `--vibe-blue`, `--workspace-line-strong`, `--workspace-soft`, `--d-flight`, `--d-deal` (CSS copies only; the JS ones are used).

---

## Phase 5 — Dead CSS and `!important` (P2)

### 5.1 The old music-background system
- [x] Re-grep `ambient-blob|blob-[1-5]|music-bg|music-background|listening-world__glow|lyric-drift` across `apps/web/src` and `apps/web/app`. As of 2026-11-19, no markup uses these classes.
- [x] Delete `app.css` ~1774–2050 (`.music-background`, `.music-bg-*`, `.ambient-blob`, `.blob-*`, the `music-bg-fade-in` keyframes and their phone media block) and ~5249–5350 (the `.listening-world` overrides and the `lyric-drift-1..5` keyframes).
- [x] Delete `--d-lyric-drift-1..5`, and `--music-*-rgb` if nothing else reads them (check `DynamicAura`, `MusicFlowShader` and `palette.ts` first).
  > Note: Grep found three more unused systems with no markup anywhere in `apps/web/src` or `apps/web/app`: `.fluid*` (and its `fluid-in`/`fluid-turn` keyframes), `.artwork-bg*` (with `artwork-fade-in`, `artwork-spin-*`, `artwork-orbit-*`) and the `--fluid-*`, `--artwork-bg-*`, `--music-*` tokens. They went in the same commit. A computed-style diff of every element in the player (bar, player, queue, lyrics-full) at 360/768/1280/1920, with and without reduced motion, matched before and after.
- **Done when:** the build passes, and screenshots at 360/768/1280/1920 match before and after.

### 5.2 `!important`
- [ ] 37 in `app.css`, 13 in `components.css`, 2 in `dj.css`: keep the ones explained by `@layer legacy` and the global reduced-motion block, and remove the rest by fixing specificity or layer order.
  > Note: Partly done. Six `!important` in `player.css` were dropped after a computed-style diff showed no change at 360, 768, 1280 and 1920 (a seventh, `.ytm-lyrics__edge { display: none }`, is needed and stays). The rest were left: those in `components.css` are the documented `@layer legacy` ones, and `app.css` has 13 in the reduced-motion block plus about 16 on lyric-sync, LuvLink and lyric rules that I could not exercise in a browser state by state.
- [x] `app.css` `.np-actions > :not(...) { display: none !important }`: replace with a data attribute on the actions row.
  > Note: Dropped the `!important` instead of adding a data attribute: its specificity already beats every rule that sets `display` on those buttons. Verified with a computed-style diff of the player, queue and lyrics views at 360, 768, 1280 and 1920.

---

## Phase 6 — Mobile (LuvLyrics) motion tokens (P2)

**Read `apps/mobile/CLAUDE.md`, `DESIGN.md` and `src/ui/AGENTS.md` first. A change here rebuilds the APK, so bump `expo.version` (patch) in `apps/mobile/app.json` and add a plain-English line to `update-history.json`.**

- [x] `AppleBackdrop.tsx:213` (500), `SeekRipple.tsx:41` (90/180), `InstrumentalWaveform.tsx:31–35, 68`, `InfoTour.tsx:163,165`, `infoTours.tsx:305`, `SavedBadge.tsx:25`, `DownloadButton.tsx:83,92`, `VoiceMicButton.tsx:94`: move these into the shared `Motion` tokens.
  > Note: Used existing tokens where they were within about 10% (`slow`, `instant`, `fast`, `base`, `drift`, `cinematic`); new ones are `Motion.duration.spin`, `pulse` and `waveBars`, and `Motion.delay.waveBars`.
- [x] Replace `Easing.out(Easing.quad)` with the `Motion.ease.*` curves.
- [x] Confirm each of these respects reduce-motion (fade only).
  > Note: SeekRipple drops its nudge, AppleBackdrop's hero fade and the info tour use reduce-motion branches, and the waveform shows a still bar. The download ring's progress ease and the waiting arc (a spinner) are not gated, as with web spinners.
- [ ] `npm run mobile:check`. Record any physical-phone evidence in `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md`.

---

## Verification (every phase)

- [ ] `npm run typecheck` → exit 0
- [ ] `npm run lint` → exit 0, including the new motion and colour checks
- [ ] `npm test` → all green, including the new tests for Escape, wash contrast, token parity and token contrast
- [ ] Browser on **:5173** (not :8080) at **360 / 768 / 1280 / 1920**, for each of:
  - [ ] open and close the player (button, swipe down, Escape)
  - [ ] Next/Prev by button and by swipe, including rapid skipping (5 taps)
  - [ ] lyrics tab, lyrics focus (double-click the cover), hiding the lyrics
  - [ ] karaoke popover and Escape
  - [ ] a long title (marquee), with hover pausing it
  - [ ] a pale cover and a dark cover (contrast)
  - [ ] all of the above again with OS **reduce motion** on
- [ ] Playback survives: music keeps playing through every route change, pause stays paused, and seeking resumes.
- [ ] Profile the cover swipe and the player open on a **real phone** (CLAUDE.md requires a real device for hero transitions).
- [ ] Run `/ponytail-session-allegra level=full` at the end, and put its one-line result in the PR.

## Suggested PR split

| PR | Phases | Risk |
|---|---|---|
| 1 `fix(web): now-playing escape, cover motion and reduced-motion bugs` | 1 | Low; small and urgent |
| 2 `fix(web): now-playing polish and readable wash` | 2.1–2.8 | Low |
| 3 `refactor(web): move player styles into player.css` | 2.9 | Medium; visual diff needed |
| 4 `refactor(web): single source for motion tokens` | 3 | Medium |
| 5 `fix(web): colour token contrast and naming` | 4.1–4.5, 4.7 | Medium |
| 6 `refactor(web): tokenise player and app colours` | 4.6 | High churn; split by file |
| 7 `chore(web): remove dead background CSS and !important` | 5 | Low with screenshots |
| 8 `refactor(mobile): motion tokens` + version bump | 6 | Low |
