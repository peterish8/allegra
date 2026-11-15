# ALBUM: opened web album layout from owner's screenshot

Owner added this card during the frontend polish run. Frontend only, AUTO subject to parent review and green gates. Use GPT-6 Luna xhigh while Claude authentication is blocked. Slot 1 web 5173 / API 8080; W0 owns slot 2 and M0 slot 3. P1 audit is queued to keep at most three workers.

## Reference and intent

Open and visually inspect this image yourself:
`C:/Users/nithy/.t3/userdata/attachments/09383b78-8094-4b65-87d8-ab9a7fdb28a5-241d1441-e710-446d-ac7d-1261d0a23a73.png`.

The owner wants this opened-album composition using Allegra's CSS and design language. The reference is a 1183 by 917 desktop album view. Its useful structure is:

- A broad hero with square artwork on the left and a bottom-aligned information block on the right: small Album label, prominent album title, then compact artist/year/song-count/total-duration metadata.
- Album artwork supplies the hero atmosphere, fading naturally into the track area. Use Allegra's existing palette, cover wash, clear frosted glass and restrained glow. Keep Allegra's chartreuse web action accent and documented supporting coral; do not copy the screenshot's green action colour or hard-code its red background. Preserve the app shell and player.
- A separate compact toolbar below the hero, above the track headings: prominent round icon play control, shuffle, album like and existing save-to-playlist action. Use working existing actions only, all with accessible names. Do not invent inert download/menu/list controls just because the reference shows them. Existing save interaction stays functional.
- An orderly, full-width track list below: narrow index/play-state column, generous title and secondary artist column, aligned real play counts only if the existing data provides meaningful counts, and tabular duration plus existing row actions at the right. Missing optional stats are omitted, never fabricated. Row hover/keyboard focus/current-track states are quiet but obvious. No artwork repeated in every row merely to fill space. No per-row card chrome or dividers unless existing Allegra styling requires it.
- Keep the reference's proportions and hierarchy, not its exact pixel values or branding. Long titles wrap without clipping. At 360/768 widths collapse the hero gracefully, keep actions reachable and avoid horizontal scrolling. Secondary columns can hide on small screens while title/artist/duration remain usable. Last tracks must clear the persistent player bar.

## Ownership and integration

### Owner clarification: row states (required)

The first screenshot row is HOVERED, the second is CURRENTLY PLAYING. Treat these as independent states: pointer hover and keyboard focus get a restrained full-row highlight and reveal the index-column Play action; the playing row keeps a persistent active title/index treatment when not hovered, with appropriate accessible current/playing state. Hover must not falsely mark a row playing. Existing Allegra web accent tokens apply to active text unless an existing semantic token is more appropriate.

The small downward-arrow-in-circle beside the artist metadata means DOWNLOADED on that device. The owner explicitly wants this marker WHITE in Allegra, not the screenshot's green. Only show it from a real existing local/offline availability signal. A track saved/added to a playlist gets the saved CHECK indicator on the right side, like the reference. Wire this to actual existing library/playlist membership and existing save/add interaction; do not substitute `likedIds` for playlist membership unless the product explicitly models them as the same state. Keep liked, saved-in-playlist, downloaded, playing and hovered states separate and test representative combinations. A plus for unsaved tracks should open the existing save/add flow if available, becoming a tick only after confirmed save. Tooltips/accessibility names explain each state, and indicators remain legible without colour alone. Preserve current menus and duration alignment.

Investigate which state signals the current web AlbumPage already receives or can consume through existing frontend selectors. If essential signals are outside current ownership, report exact minimal frontend wiring needed to parent before editing those files. Do not fabricate download status, infer it from a completed browser download request, add API fields, or add a new offline stack. If the web app has no reliable downloaded state, implement the available states and report that concrete missing capability for orchestration. Do not silently omit the owner's requested behavior.

Own `apps/web/src/components/AlbumPage.tsx`, album-specific rules in the CSS file that currently owns `.album-page`/`.album-hero`/`.album-tracklist` (likely `apps/web/src/styles/app.css`, inspect first), and a new focused album regression spec under existing web/e2e test discovery. Do not change generic track rows/shared controls globally; use album-local composition. If another file is essential, report the exact path and need before editing. Parent will reconcile W6: ALBUM owns AlbumPage; W6 retains Collection and Quick Picks states. W1 CSS consolidation must wait for this CSS change to merge, then rebase and include it. Do not edit tokens, locks, APIs, Convex, mobile, desktop, App.tsx or playback hooks/queue/lyrics.

Use graft before source search, and `graft callers AlbumPage --depth all` before changing the component. Parent graph found AlbumPage at lines 38-145, receiving seed/detail/tracks/palette and existing play/shuffle/like/save callbacks. Verify live source yourself. Preserve callback contracts and track ordering; do not implement a second playback path.

Read root CLAUDE.md, worker protocol, PLAN-v2 keep list/constraints, plus these skills by absolute path: `C:/Users/nithy/.claude/skills/charles-polish/SKILL.md`, `C:/Users/nithy/.claude/skills/charles-ux-animation/SKILL.md`, `C:/Users/nithy/.claude/skills/frontend-design-fidelity/SKILL.md`, `C:/Users/nithy/.agents/skills/accessibility-tester/SKILL.md`, `C:/Users/nithy/.claude/skills/full-send/SKILL.md`, `C:/Users/nithy/.claude/skills/file-pr/SKILL.md`. Owner decisions override skill defaults.

## Method and acceptance

1. Capture the existing album at 360 and desktop before changing it; identify existing handlers and real metadata. Add a meaningful failing behavior/layout regression using the existing test setup.
2. Make the smallest album-local implementation. Existing tokens for colours/type/motion; no new dependency, raw duration/easing/colour/font size, or baseline increase. Edit with Edit/apply_patch, never scripted rewrites.
3. Preserve loading and empty behavior; improve within AlbumPage if needed so the layout does not claim zero songs while fetching. No API or new data fields. Keep play/pause through existing callbacks/requestPlayback and the single layout audio element untouched. Never add a fake control or placeholder stats.
4. Browser proof at 360/768/1280/1920 and reduced motion. Exercise album entry, play, shuffle, like/save and a track selection using the existing fixture/mock setup. Check keyboard navigation, accessible icon names, no page errors/overflow, and player clearance. Animate only transform/opacity from motion tokens; reduced motion retains functionality.
5. Run root typecheck/lint, web tests and focused e2e, inspect own diff for out-of-scope paths and playback invariants. Report exact commands/results and before/after capture paths. Missing evidence remains pending.
6. Parent owns Sol review, babysitting and merge. Do not start delegates, merge or watch PRs. You may file a real PR after proof using file-pr, link it immediately, then report branch/head/PR, files changed, image interpretation, observed behavior and limitations. End PR description `Created with GPT-6 Luna in T3 Code.`; no AI attribution in commits. Never edit LEDGER/OWNER-TODO; send parent entries. Final line `PR <full URL>, head <SHA>, checks and reviews <state>`.

You are not alone in the repo: preserve all other work. Use only your harness-prepared isolated checkout; no new checkout creation. Junction dependencies to the main checkout, no installs or lockfile edits, no cleanup/deletion, keep C: above 10 GB. Existing main-checkout servers may be running on slot 1; inspect health before starting any server. If worktree Turbopack needs a local root adjustment, revert it before committing.
