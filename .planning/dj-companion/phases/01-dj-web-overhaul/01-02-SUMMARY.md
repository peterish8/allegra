# Phase 01 Plan 02: One DJ session for the whole app Summary

All DJ state now lives in `useDjSessionState`, called once in `App` and provided through `DjSessionContext`; `DjPage` keeps only view concerns (analyser loop, pointer look, voice input, prompt text). DJ picks are tracked apart from the listener's own queued songs, and App exposes reorder, remove and play-from controls for them. No visual or copy change.

Status: tasks 1, 2 and 3 done; typecheck, lint and tests green except the known pre-existing API failure. Browser acceptance checks are left for the orchestrator (listed below).

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | 9d0efbf | feat(web): pure DJ session logic for slash commands and the stored provider choice |
| 2 | 57c8890 | refactor(web): track DJ picks apart from the listener's own queued songs |
| 3 | 3478f54 | refactor(web): lift DJ state into one session App provides through context |

## Files

- `apps/web/src/lib/djSession.ts` (new) - `defaultModelFor`, `readDjProviderChoice`, `writeDjProviderChoice` (key `allegra.dj.provider.v1`, provider and model only), `applySlashCommand` (copy of DjPage's slash logic, same strings).
- `apps/web/src/lib/djSession.test.ts` (new) - 9 tests with a fake Storage: `/playlist` -> goal playlist and songLimit >= 10; `/size 99` in mix -> 8 (and keeps the remainder as a message); `/size` alone -> prefill `/size `; `/size 2` in a playlist -> 5; provider+model round-trip; a stored `apiKey` is ignored and never written back; bad/blocked storage reads as nothing.
- `apps/web/src/hooks/useDjSession.ts` (new) - `useDjSessionState(inputs)`, `DjSessionContext`, `useDjSession()`.
- `apps/web/src/components/DjPage.tsx` - props cut to `currentSong, isPlaying, isLive, isRemote, isCurrentLiked, audioRef, onToggle, onLike`; reads the rest from the session.
- `apps/web/src/App.tsx` - `djPlannedRef`; `applyDjPlan`, `startDjPlan(turn, fromId?)`, `reorderDjUpcoming`, `removeDjUpcoming`, `playDjFrom`; calls `useDjSessionState` and wraps the shell in `DjSessionContext.Provider`.

## Design notes

- The hook reads its volatile inputs (current song, recent, liked, next songs, the App callbacks) from a ref refreshed every render, so the action callbacks (`startPlan`, `reorder`, `removePick`, `playFrom`, `skipAndTeach`, `savePlaylist`) are stable and the context value only changes when session state or `nextSongs` changes (App memoises `playingNext.slice(0, 8)`), not on every playhead tick.
- `send(message, options)` now takes the message explicitly and resolves `true` only when the turn completed; `submitPrompt(value)` resolves `{ clear, prefill? }`. Slash commands that also send fire the send without awaiting, so the prompt still clears immediately, as before. A plain message clears the prompt only after a successful turn, as before.
- Provider and model are one state object; `setProvider` sets the provider's default model itself (no `[provider]` effect), and both setters write to storage. The initial value is read once (lazily) from storage with a safe fallback to openai / gpt-4o-mini.
- The `curious` -> `idle` 1100 ms timer moved into the hook with the emotion state.
- `nextSongs` for the DJ is now `playingNext.slice(0, 8)` (was `audio.queue` minus the current song, `slice(0, 6)`), as the plan said; the "Coming up" list can therefore show up to 8 rows.

## Deviations / judgement calls

1. **DJ picks are in `djPlannedRef` AND `userQueuedRef`, not `djPlannedRef` instead of it.** The plan said "instead of". `userQueuedRef` is also read by `useSongRadio.fill` and by `playSong`/`queueSong` to keep DJ picks ahead of radio and ahead of a new context; moving them out would silently change those paths (picks would fall out of the queue the moment the listener plays a song from Home). So `applyDjPlan` computes `pinned = userQueued && !djPlanned` (exactly the plan's rule), then adds new picks to both sets. Replace turns first drop the old DJ ids from `userQueuedRef` and clear `djPlannedRef`. `queueSong` removes a song from `djPlannedRef` when the listener queues it by hand (it becomes theirs). The id is cleared from both when the song starts (same effect as before, plus `djPlannedRef`).
2. Task 2's commit (57c8890) adds `removeDjUpcoming` and `playDjFrom` to App before anything uses them, so `eslint src/App.tsx` reports two `no-unused-vars` at that commit; Task 3 consumes them and lint is clean from 3478f54 on. Task 2's own verify (`typecheck`) passed.
3. `playDjFrom` returns false (does nothing) when remote or when the song is the one already playing. `reorderDjUpcoming` returns false when remote or when no DJ picks are queued; ids that are not DJ picks are ignored and DJ picks not named keep their relative order after the named ones.

## Gates (at 3478f54)

| Command | Result |
|---|---|
| `node --import tsx --test src/lib/djSession.test.ts` (apps/web) | 9 pass, 0 fail |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` (root) | exit 1, only the known failure: api `app.profile.test.ts` "Gaana plays keep their provider ref ..." (api 310/311) |
| `npm test --workspace apps/web` | tests 136, pass 136, fail 0 (127 before + 9 new) |
| (same root run) connect / shared | 81/81, 198/198 |

`infra:test` and `convex:test` were not rerun (the root `npm test` chain stops at the api failure; nothing in this plan touches them). Mobile `connectRouting.test.ts` / DjScreen.tsx was not run and is untouched by this plan.

`grep -n "localStorage" apps/web/src/hooks/useDjSession.ts apps/web/src/lib/djSession.ts` -> only `useDjSession.ts:99 return typeof window === 'undefined' ? null : window.localStorage;`, which is used solely to read/write the `allegra.dj.provider.v1` choice. The API key is only in React state.

## For the orchestrator to verify live

1. Play a song, ask for a mix on /dj, go Home and back to /dj: music never stops, the turn, chips, status and "Coming up" list are still shown, pause works on the first press.
2. Two consecutive mix turns: Up next holds only the second turn's picks plus any songs queued by hand (Play next / Add to queue before the first turn should survive both turns; first-turn picks should be gone).
3. Reload: provider and model (open settings) are kept; the API key field is empty again. Check DevTools > Application > Local Storage: only `allegra.dj.provider.v1` = `{provider, model}`.
4. `/size` alone fills the prompt with `/size `; `/playlist` then `/size 99` clamps to 30; `/mix` then `/size 99` clamps to 8; `/settings` opens the panel.
5. The unknown-shortcut message ("Unknown shortcut. Type / to see the DJ commands.") still keeps the prompt text; a failed/blocked send (no key on a cloud provider) keeps the prompt and opens settings.
6. Note: the reorder / remove / play-from controls have no UI yet (01-04 onward uses them); to try them, call via the React devtools context or wait for 01-04.

## Known Stubs

None. `reorderDjUpcoming`, `removeDjUpcoming`, `playDjFrom` and `startPlan(turn, fromId)` are wired through the session but have no UI caller until 01-04 (intended; the plan builds them for 01-04 to 01-07).

## Self-Check: PASSED

Commits 9d0efbf, 57c8890, 3478f54 exist on `codex/dj-companion`; `djSession.ts`, `djSession.test.ts`, `useDjSession.ts` exist; `apps/desktop/` left untracked.
