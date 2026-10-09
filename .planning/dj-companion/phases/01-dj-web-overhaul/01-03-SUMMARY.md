# Phase 01 Plan 03: Dark-glass stage and the shape-shifting mascot Summary

The /dj stage has no fill any more (the cream slab is gone), every DJ panel uses the Home cards' clear-glass recipe, and the mascot is a glass orb that becomes a slowly turning record while music plays, hops about the stage like a ball, and shows only the playing song's colours. Typecheck, lint and web tests are green; browser checks are left for the orchestrator.

Status: tasks 1, 2 and 3 done, plus three owner-requested changes made mid-plan (below).

## Commits

| Step | Commit | Subject |
|---|---|---|
| Task 1 | 1ce877d | feat(web): useDjPulse writes bass, energy and onset onto the DJ stage |
| Task 2 | 08ad443 | feat(web): DJ mascot as a glass orb that becomes a spinning record |
| Owner change A | 3d6395a | feat(web): DJ mascot wanders and dances by vibe, shows only the song's colours |
| Owner change B | a54e38e | feat(web): DJ mascot hops like a ball with squash, stretch and a landing wobble |
| Task 3 | 1e69376 | style(web): DJ stage has no fill and every DJ panel is clear glass |

(e087635 `fix(api): make Gemini keys work for the DJ` sits between them on the branch; it is not part of this plan.)

## What was built

- `useDjPulse(targetRef, analyser, active)` (components/dj/useDjPulse.ts): rAF loop writing `--dj-bass`, `--dj-energy`, `--dj-onset` (0..0.9, x0.91 decay) on the hero; holds the last band values when `readBands()` is null; skips frames while `document.hidden`; writes zeros on stop. No React state. The onset detector is the old one, exported as pure `createOnsetDetector`.
- `DjMascot` (components/dj/DjMascot.tsx): `<DjMascot size='stage'|'mini' emotion palette playing vibe? progress? />`. Layers: stage-glow pool, then roam > dance > kick > (glow, ring, orb glass, record glass with vinyl body and a spinning disc, label) with the eyes on a separate non-spinning layer. Emotions idle/listening/thinking/curious/happy/error plus `sleeping` (closed eyes, dim glow) for 01-07. `progress` fills the orb from the bottom.
- `useDjRoam` + `lib/djHop.ts` + `lib/djDance.ts`: the ball. `createHopper` is pure (crouch, arc, landing spring, rest, optional double hop); the hook writes `--dj-roam-x/-y`, `--dj-lift`, `--dj-squash`, `--dj-sway`. `djDanceVibe(tone, energy)` picks calm / steady / bouncy / dreamy; `djMotionFor(vibe, playing, mode)` sets rest range, flight range, height, reach and double-hop chance. Thinking holds it still, leaning; listening hops it down to the prompt and keeps it there. A beat adds a small in-place hop (`--dj-onset` on the dance layer) for steady and bouncy.
- Tokens: `--d-record-spin: 12s` (motionTokens `recordSpin: 12`); `motionTokens.duration` hop and rest values (`hopQuick/Easy/Lazy`, `crouch`, `restQuick/Easy/Lazy/Idle`) and `spring.bounce` (stiffness 700, damping 12). Colour cross-fade uses the existing `--d-atmosphere`.
- Stage and panels: `.dj-mascot-stage` has no background, border or shadow; `--dj-pale` and all `#fbf9f5` cream are removed; tone colours darkened (`--dj-core` / `--dj-soft`, mirrored by `djTonePalette`). The prompt pill, `.dj-current`, `.dj-queue-section` and `.dj-provider-panel` share one glass rule (14% white hairline, lit top edge, faint sheen, blur 22 px saturate 150%, copied from `.home-pick`). `.dj-input-wrap` no longer transitions `box-shadow`; focus is a `::after` ring whose opacity fades in (`--d-fast`). Send button is a quiet glass circle. The blanket `.dj-hero *` reduced-motion rule is replaced by targeted rules. All old `.dj-aura*`, `.dj-mascot-eye*`, `.dj-mascot` / halo / head / smile rules and their keyframes are deleted (only `.dj-mascot-stage`, the wrapper, remains in use). App passes `palette={playerSong ? palette : null}`.
- docs/decisions.md: "The DJ is an orb that becomes a record".

## Owner feedback applied during the plan (2026-10-09, relayed by the coordinator)

1. Roam and dance by vibe was requested first (3d6395a), then corrected to a bouncing ball (a54e38e): quick hops with squash and stretch, rests, a new random spot each time, sometimes a double hop, a small landing wobble; pace and reach follow the vibe, never a glide. Only the record's rotation is slow.
2. Spin very slow: 12 s per turn.
3. No artwork anywhere on the mascot. The label is a gradient of palette primary / secondary / tertiary; `DjMascot` therefore takes `palette` (always concrete) and no `cover` prop. This differs from the plan's `<DjMascot ... cover>` signature, so 01-06 and 01-07 must not pass a cover.
4. The vinyl body is a dark shade of the palette primary with grooves as faint lighter rings of the same hue.
5. The stage gets a large soft pool of the same colour behind the mascot, breathing and drifting by opacity and transform only, low intensity (the app's DynamicAura still shows through).
6. Colour follows the vibe: every coloured layer exists twice (colour slots) and a new palette cross-fades by opacity over `--d-atmosphere` (1300 ms). With nothing playing the mascot uses `djTonePalette(tone)`.
7. Eyes are centred over the label, scaled to 72% while a record, white with a faint dark shadow for contrast, still follow the pointer and still show the emotions.
Reduced motion: no hop, squash, wobble, spin, blink or drift; the mascot stays centred; beats lift glow opacity; the vibe shows in the glow level and colour; colour changes and the orb/record swap are opacity cross-fades.

## Deviations from the plan

1. **[Scope] Extra commits.** The roam/dance request and the hop correction arrived mid-plan, so the work is five commits instead of three. Task 2's acceptance in the plan file was extended with the owner's measurable checks.
2. **[Design] `DjMascot` takes `palette` (non-null) and no `cover`** (owner item 3). The null fallback to tone colours happens in DjPage via `djTonePalette`.
3. **[Design] Extra layers and files** beyond `files_modified`: `useDjRoam.ts`, `lib/djHop.ts`, `lib/djDance.ts` and their tests (tests live in `src/lib`, per CONTEXT.md). Roam is a JS loop writing custom properties rather than CSS keyframes, so changing vibe, play state or mode eases instead of snapping.
4. **[Plan said keyframes for the spin; tokens]** `--d-record-spin` is 12 s as the owner asked (plan said 1800 ms). `--d-roam-slow/-fast` were added for the first roam version and removed again when it became hops.
5. The first-task commit does not touch App; `palette` is an optional DjPage prop until Task 3 passes it.
6. Dead rules unrelated to the mascot (`.dj-hero-copy`, `.dj-goal-tabs`, `.dj-vibe-chips`, `.dj-status-line`, `.dj-compose-footer`, ...) were left alone: they are not in the DjPage markup but 01-04 may reuse some. Their colours are cream-ish but nothing renders them.
7. `.dj-primary` (Start this set, the lime accent button) and the mic button's listening state are accent controls, not surfaces, and were not turned into glass. The mascot's eyes and rim hairlines are white by design.

## Gates

| Command | Result |
|---|---|
| `node --import tsx --test src/lib/djDance.test.ts src/lib/djHop.test.ts` (apps/web) | 15 tests, pass 15, fail 0 |
| `npm run typecheck` (root) | exit 0 |
| `npm run lint` (root) | exit 0 |
| `npm test --workspace apps/web` | tests 151, pass 151, fail 0 |
| `npm test` (root) | exit 1, only the known failure: api `app.profile.test.ts` "Gaana plays keep their provider ref ..." (api 315/316); connect 81/81, shared 198/198, web 151/151 |

Grep acceptance for new CSS: no `transition` / `animation` names width, height, top, left or box-shadow inside the mascot block (`none-banned`). The `.dj-input-wrap` transition is `opacity` on `::after`. Mobile `connectRouting.test.ts` was not run (untouched, known failure).

The pure hopper tests stand in for the motion acceptance checks: in 6 s of bouncy music the position spans more than 0.3 of the roam box, squash reaches below -0.15 and above +0.1, hops stay inside the box and above the floor, bouncy hops more often than calm (and calm still hops), thinking holds position and leans, listening parks at the prompt.

## For the orchestrator to verify live (not run here)

On http://localhost:5173/dj, a song playing, DevTools console:

1. Hop and squash (1280x800, normal motion, music playing):
```js
const m = document.querySelector('.dj-m'); const d = m.querySelector('.dj-m-dance');
const c = () => { const r = m.querySelector('.dj-m-kick').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
const a = c(); const sy = new Set(); const t0 = performance.now();
await new Promise(res => { const f = () => { sy.add(getComputedStyle(d).scale); performance.now() - t0 < 6000 ? requestAnimationFrame(f) : res(); }; f(); });
const b = c(); console.log('moved', Math.hypot(b[0]-a[0], b[1]-a[1]), 'scale values', sy.size, [...sy].slice(0, 4));
```
Expect moved > 40 and many distinct scale values (squash and stretch). Reduced motion (DevTools > Rendering > emulate prefers-reduced-motion: reduce): moved 0, `scale` is `none`.
2. Pulse: `const s=document.querySelector('.dj-hero'); const v=new Set(); for(let i=0;i<30;i++){ v.add(s.style.getPropertyValue('--dj-onset')); await new Promise(r=>setTimeout(r,100)); } console.log(v.size)` expect at least 3 distinct values playing, only `0.000` after pause.
3. Reduced motion animations: `document.querySelector('.dj-m').getAnimations({subtree:true}).map(a=>a.animationName||a.transitionProperty)` should list only opacity (and the thinking ring, which animates opacity).
4. No artwork and slow spin: `document.querySelectorAll('.dj-m img').length` is 0; `getComputedStyle(document.querySelector('.dj-m-disc')).animationDuration` is `12s`.
5. Glass check: over `.dj-page *`, no computed `background-color`/`background-image` lighter than the Home card (alpha-white <= 0.08), apart from the intentional exceptions (`.dj-primary`, `.dj-m-eye`, `.dj-m-label`, mic listening state).
6. Colour cross-fade: change the vibe (e.g. ask for "hype workout" then "late night dreamy") and play a different song; colours dissolve over about 1.3 s, no snap.
7. Pause and play from the mini player while on /dj: pause works on the first press; the record fades back to the orb within about 0.5 s; /dj to Home and back keeps music playing.
8. Visual: screenshots at 360, 768, 1280, 1920, idle and playing; stage is transparent so the app glow shows through; the mascot stays clear of the prompt pill; the hop arc is not clipped at the top of the stage; the 28cqw / cqh roam box looks right at 360 wide.
9. Reduced transparency (emulate prefers-reduced-transparency) falls back to solid dark panels (intended).

Unverified assumptions worth a look: `cqw` / `cqh` custom-property math inside `translate` (written for the stage as a size container), and that backdrop-filter on the orb/record circles composites correctly inside the transformed layers.

## Known Stubs

None. `DjMascot` `progress` and `sleeping` have no caller until 01-07; `size='mini'` has none until 01-06 (intended).

## Self-Check: PASSED

Commits 1ce877d, 08ad443, 3d6395a, a54e38e, 1e69376 exist on `codex/dj-companion`; DjMascot.tsx, useDjPulse.ts, useDjRoam.ts, djHop.ts, djDance.ts and tests exist; `apps/desktop/` left untracked.
