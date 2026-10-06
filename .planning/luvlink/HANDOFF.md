# LuvLink handoff

Updated 2026-10-06. Branch `feat/luvlink` in worktree `C:\dev\allegra-luvlink`, built on
`feat/search-radio` (PR #17). The feature was moved here from the shared `C:\dev\allegra` checkout
as LuvLink-only hunks; navigation, Blend and performance edits stayed out. This file replaces the
earlier per-worker status files.

## Done in this pass

- Backend fix: a room kept one `luvLinkBarriers` row per track change, but every read used
  `.unique()`, so the second playing track change in any room would have thrown. `publishPlayback`
  now replaces the room's single barrier row. Regression test added.
- Creation kill switch: Convex env `LUVLINK_CREATION_DISABLED=true` rejects `createRoom` with
  `creation_disabled`; open rooms keep join/leave/playback. Test added; contract documents it.
- Web invite QR: encoded locally with `qrcode` and shown next to the invite link. The private link
  is never sent to a QR service.
- Web room playback no longer starts the song radio from PR #17 (it would append local songs
  behind the room's track).
- Mobile `app.json` 1.6.0 (feature).

## Verified (this worktree)

- Root `npm run typecheck`, `npm run lint`: no errors.
- Workspace tests: API 311, web 127, Connect 81, shared 180; infra 20; Convex 80/80 across
  seven files plus auth redirect 4/4.
- `npm run mobile:check`: see the PR description for the latest result.

## Not done or not verified

- Mobile group-picks shelf (consent, refresh, add) and the leave-during-catalog-resolution test
  exist and pass in the mobile suite, but neither was exercised on a device.
- Cold/warm invite continuation and the standalone mobile screen were not run on the emulator.
- No rendered browser check of the web room, no two-device or physical-phone run. Audible
  drift, screen-off and Bluetooth behaviour are unverified.

## Deploy notes

Merging to `main` deploys the Convex schema (new `luvLink*` tables, hourly cleanup cron) to
production through the Vercel build and publishes an APK. To pause new rooms without a deploy,
set `LUVLINK_CREATION_DISABLED=true` on the production Convex deployment.
