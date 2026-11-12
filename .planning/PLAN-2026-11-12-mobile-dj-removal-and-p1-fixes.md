# Plan: pull Your DJ out of the phone app, then fix the seven P1 bugs

Written 2026-11-12. Nothing in this plan is implemented yet. Source for the bugs: `audit/FIX-BACKLOG.md`,
rechecked against the live code on 2026-11-12.

## Decisions already made (by the owner)

- The **phone app** loses the DJ for now: no screen, no menu entry, no way in. The web DJ stays as is.
- DJ code is **archived**, not deleted, so it can come back without digging through git history.

## PR 1: archive Your DJ in the phone app (LuvLyrics 1.46.2)

**Archive** (move with `git mv`, so history follows):

| From | To |
| --- | --- |
| `apps/mobile/src/screens/DjScreen.tsx` (510 lines) | `apps/mobile/archive/dj/DjScreen.tsx` |
| `apps/mobile/src/services/dj/djApi.ts`, `localDj.ts` | `apps/mobile/archive/dj/services/` |

`apps/mobile/archive/` sits outside `src`, so TypeScript, Jest, lint and the Expo bundler never see it.
Add `archive/dj/README.md`: what it was, why it left, and the exact restore steps below.

**Remove every way in** (each is a file that references DJ today):

1. `src/navigation/TabNavigator.tsx:20,198`: the import and the `Dj` tab screen.
2. `src/types/navigation.ts:37`: the `Dj` route type.
3. `src/navigation/profileMenu.ts:7,25`: the `'dj'` action and the "Your DJ" row.
4. `src/components/V6TabBar.tsx:79`: the `action === 'dj'` branch.
5. `src/screens/YouScreen.tsx:24`: the "Your DJ" row.
6. `src/components/moreItems.ts:9,21`: the `Dj` item and the `dj-mascot` icon name.
7. `src/components/MoreMenu.tsx:53-65` and `moreMenuPayload.ts:14`: the mascot icon and its native payload entry.
8. Tests that name it: `src/navigation/shellNavigation.test.ts:42` (drop `'dj'` from the expected list).
   Re-baseline `src/designGuards.baseline.json` only if the guard fails.
9. Comments that still say "Your DJ": `ProfileMenu.tsx:3`, `createMenu.ts:32`, `tabs.ts:6`.

**Leave alone, on purpose:**

- `StreamService.startDj*` and `applyDjUpcoming`, and `onlinePlaylist.addOnlineSongsToPlaylist`. They are the radio and
  playlist engine, shared code. Mark them `// DJ archived: kept for restore` so nobody deletes them by accident.
- `NativeMoreItemsView.kt` mascot drawing. It becomes unused. Touching Kotlin costs an emulator run for no user gain.
  Remove it in the same release that decides DJ is gone for good.
- Web DJ (`apps/web`, `apps/api` DJ routes) and `.planning/dj-companion/`.

**Safety checks:**

- Grep for any saved or deep-linked route named `Dj`; a stale one must fall back to Stream, not crash.
- Mobile release notes: add a "Changed" line ("Your DJ is paused in the phone app") so About -> Updates is honest
  (`tests/infra/mobile-release-notes.test.mjs` guards the format).
- Bump `expo.version` in `apps/mobile/app.json` from 1.46.1 to **1.46.2** (project rule: a rebuilt APK = new version).

**Restore later:** `git mv` the files back, re-add the nine entries above (a revert of this PR does exactly that).

**Done when:** `npm run mobile:check` passes; on an emulator the profile menu, Library and More show no DJ and
nothing crashes; grep for `DjScreen|services/dj|'Dj'` in `apps/mobile/src` returns nothing.

## The seven P1 bugs, grouped into PRs that can ship independently

| PR | Bugs | Area | Version bump | Effort | Test that must come with it |
| --- | --- | --- | --- | --- | --- |
| 2 | FE-003 mic header, FE-001 keyboard, FE-002 guest merge | web | none | S + S + M | Header test for `microphone=(self)`; `tests/e2e/connect.spec.ts` Space and arrows route to the owner; `guestLink.test.ts` failure-then-retry and sign-out keeps the token |
| 3 | SEC-003 erased-token writes, SEC-004 cover ownership | Convex + API | none | M + L | `convex/account.test.ts` (erased identity rejected on register and createRoom); route and Convex tests for foreign, unknown and duplicate cover keys |
| 4 | DESK-001 unsigned desktop updater | desktop | `Cargo.toml` patch/minor | L | Rust test with an injected byte source: valid fixture accepted, wrong digest or signer refused, no swap on mismatch |
| 5 | AND-001 debug-signed public APK | CI + signing | mobile bump | M + owner decision | `tests/infra/infra-files.test.mjs`: main requires the private signer and verifies the exact artifact fingerprint |

Order: **2 -> 3 -> 1 -> 4 -> 5**. (PR 1 can run in parallel with 2 and 3; they touch different files.)

### PR 2: web fixes (smallest first)

- **FE-003:** `apps/web/next.config.ts:43`, change `microphone=()` to `microphone=(self)`. Keep camera and geolocation denied.
- **FE-001:** delete the old keydown effect in `useAudioPlayer.ts:612-632`. Keep the App-level handler
  (`App.tsx:764-782`), which already goes through Connect (`togglePlayer`, `seekPlayer`). One handler, one funnel.
- **FE-002:** in `ConvexSignInProvider.tsx:60-72` set `linked` only after success. `linkGuestSession` returns
  `merged | none | failed`; on `failed`, keep the guest token and retry with capped backoff. Sign-out must not
  replace a token that has not been merged yet.

### PR 3: Convex and API

- **SEC-003:** one shared `requireLiveUser` that checks the auth user still exists, used by `connect.ts:202`,
  `luvLink.ts:70` and `library.ts:430`. Erase removes or fences the identity before cleanup runs.
  Do not require a profile row; a brand-new user has none yet.
- **SEC-004:** an upload claim bound to the uploader. `routes/user.ts` attaches only a claimed key, and `covers.remove`
  refuses keys the caller does not own. Existing covers need a one-off migration before deletion is enabled.
  Needs `npx convex dev --once` and `npm run convex:test` (not at the same time as `mobile:check`).

### PR 4: desktop updater (needs your input on the key)

Signed manifest (version, size, SHA-256) checked against a public key built into the app before the swap. A
checksum file next to the exe is not enough; an attacker who replaces one can replace both. Old installed copies
need one bootstrap release that carries the key.

### PR 5: APK signer (needs your decision first)

Published 1.46.1 is signed with the public Expo debug key. Before changing anything:

1. Check whether the repo has the `ANDROID_RELEASE_KEYSTORE*` secrets (the workflow only uses them on main).
2. If phones already run debug-signed builds, switching the signer **blocks every update** on those phones. The plan
   then is: keep the current signer, add the artifact fingerprint check, and schedule a one-time reinstall
   migration as its own release.
3. If a private key exists, publish with it from the next release and say so in the notes.

## Before every PR

`npm run typecheck`, `npm run lint`, `npm test`; every fix ships a regression test; web changes get a pass at
360 / 768 / 1280 / 1920; one change per branch (`fix/`, `chore/`), squash-merge, no AI footer in commit messages.

## Questions that change the plan

1. Is it fine that PR 1 only hides DJ and leaves its shared engine code in place (recommended), or should the
   Kotlin mascot and the `StreamService` DJ methods go too?
2. PR 5: do you have a private release keystore stored in the repo's secrets?
3. PR 4: who holds the desktop signing key, and is a Windows code-signing certificate available?
