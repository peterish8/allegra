# Frontend enhancement plan v1 (draft, 2026-11-13)

Status: first draft written in a chat session. To be reviewed and enhanced by a deeper pass (see PLAN-v2.md).
Scope: frontend only (web and mobile UI). Nothing here changes the API, Convex or desktop wrapper.

## Skills available (installed in ~/.claude/skills, ~/.codex/skills, ~/.agents/skills)

| Skill | What it does | Intended use in Allegra |
|---|---|---|
| charles-unslop | Audits the generic AI look (emoji icons, uneven spacing, filler copy, hedged borders). Subtract first, then fix spacing, colour, icons, copy, type, layout, details in order. | Every web page and mobile screen. Start with Home, Search, Library, Create. |
| charles-ux-animation | Rules for whether something should move, where the eye goes, which curve, target sizes, optimistic updates, undo. | Player transitions, mini player, sheets, buttons, onboarding. |
| charles-polish | Details checklist (tabular numbers, layout shift, hit areas, contrast, press states) and frame-by-frame motion checks. | Final pass per screen after unslop. |
| charles-unreasonable-craft | Renders 3 directions side by side, then verifies and critiques at an award-level bar. Heavy. Needs `interface-craft` skill (not installed) and `npm install` in its scripts folder (Playwright; use Edge, bundled Chromium crashes on the dev page). | One or two signature surfaces only: full player and web home. |
| charles-accent-heroes | Poster-style hero images via GPT Image (needs an OpenAI key). | Website landing hero, README banner. |
| charles-store-screenshots | Screenshot sets from real captures (iPhone-size frames; Android sizes need adapting). | Downloads page, any store listing. |
| charles-arcade-motion, charles-claude-editing | Pixel motion and reel editing for video. | Optional promo content only. |

Already-installed skills that overlap and complement: unslop-ui, minimalist-ui, design-taste-frontend, cinematic-ui-motion, motion-animate-ux-stack, frontend-design-fidelity, curiosity-driven-ux.

## Guardrails

1. Owner taste stays. charles-unslop deletes glows and glassmorphism by default. The owner kept glass and glow (2026-11-01) and chose white as the only accent (2026-11-06). Every run starts from a "keep list" and only fixes real slop. Do not strip glass, glow or the Stream/Spotify-style layout.
2. Allegra rules beat skill defaults. Durations and easings come from `apps/web/src/motion/index.ts`, never the skills' literal numbers. Mobile uses `src/ui/` primitives and theme tokens, no new glass buttons, 48 dp targets. Player invariants and the byte-range rule are untouched.
3. Missing dependency: `interface-craft` skill, and `npm install` in charles-unreasonable-craft/scripts.
4. Ship rules: small PRs on feat/fix branches, regression test per fix, mobile change bumps `expo.version`, typecheck + lint + tests before each PR, web checked at 360/768/1280/1920, mobile motion on a real phone.

## Phases

**Phase 0 - Setup (about half a day).** Install interface-craft. Run npm install in the craft skill's scripts folder. Write a one-page keep list of owner decisions and the Allegra direction in the unslop five lines: product, character, world, moment, signature.

**Phase 1 - Baseline audit, read-only.** Capture every web page and mobile screen at real sizes. Run the unslop audit and the polish score on each. Output: one ranked list of tells and weakest screens. No code changes.

**Phase 2 - Unslop pass, one surface per PR.** Order: web Home, Search, Library, Settings, Auth; mobile Stream, Search, Library, Create sheet, playlist page. Subtract first, then spacing, colour, icons, copy, type, layout. Copy gets particular attention (say less, sound like the owner) for labels and empty states.

**Phase 3 - Motion and UX pass.** Walk the five questions on each interaction: player, mini player, sheets, queue, search, onboarding. Cut animation on high-frequency actions. Add optimistic updates and undo where they fit (like, add to playlist, remove). Put all values in the motion tokens, check reduced motion.

**Phase 4 - Polish pass.** Details table: tabular numbers on time and counts, layout shift, 48 dp hit areas, contrast, press states, focus rings, first paint. Capture motion as frames and look for pops and dead stretches.

**Phase 5 - Signature moments (two surfaces).** Craft skill on the full player (web and mobile) and the web home hero. Render three directions, pick one, one critique round, fix findings. Cover-art-driven colour is the obvious starting idea and already exists; the job is pushing it further.

**Phase 6 - Marketing assets (optional).** Hero image for site and README, refreshed screenshot set, one promo reel. Needs an OpenAI key.

**Phase 7 - Release.** Real-phone check, mobile version bump, `vercel build` to confirm `/api` rewrite order, prove it live.

## Open decisions (unanswered when drafted)

1. Surfaces: web only, mobile only, or both in parallel? Draft suggests web Home and mobile Stream first.
2. Glass and glow: keep everything, or let unslop flag the weakest uses for owner review?
3. OpenAI key available for Phase 6?
