# LuvLink contract

LuvLink is Allegra's first-party shared-listening room. New rooms use Convex directly; existing Echo rooms keep the `echo-legacy` transport and are not migrated. Clients use their existing local player. The API never relays audio.

## Shared types

`packages/shared/luvLink.ts` is the type source for web and mobile. It has no runtime package imports.

- `LuvLinkMode` is `listen` or `speaker`. In listen mode, each member can play locally. In speaker mode, only the elected output opens audio; approved controllers send transport intents to that output.
- `LuvLinkTransport` distinguishes `convex-v1` from `echo-legacy`.
- `LuvLinkPlaybackAnchor` carries `leaderUserId`, `leaderEpoch`, `sequence`, `trackEpoch`, `queueEntryId`, `intent`, `intentByUserId`, `outputAppliedSequence`, `barrierPending`, a song snapshot, position in seconds, server timestamps in milliseconds, `playing`, and `playbackRate`. Clients project position from the latest anchor and sampled server clock. They do not write progress ticks.
- `LuvLinkRoomSnapshot` includes host and active output identity, leader epoch, room mode/revision, expiry, member count, and any pending speaker handoff. It never contains an invite code.
- `LuvLinkMemberSnapshot` includes `canControl` and `canSuggest`; presence is a separate ephemeral subscription.
- `LuvLinkQueueEntry` has a stable entry ID, order, song snapshot, attribution, and creation time. Duplicate songs remain distinct entries.
- `LuvLinkGroupPicks` contains at most 12 cached Blend-ranked picks. `forUserIds` contains only members who opted in and whose account personalization is enabled.

## Convex functions

Every public function derives identity from Convex Auth and checks active room membership. Clients cannot claim a user ID as authority. Rooms have at most 8 members and 100 pending queue entries. Invite and room lifetime is 24 hours. Hourly cleanup removes expired room data in bounded batches. Queue and playback reads use separate subscriptions.

- `createRoom({ displayName })` returns the room ID and one-time invite code.
- `joinRoom({ code, displayName })` checks the current invite hash, expiry, revocation, room state, and capacity.
- `getRoom`, `getMembers`, `getQueue`, `getPlayback`, and `getPresence` expose separate member-only snapshots. `getServerTime({ roomId })` returns a fresh server timestamp for client clock sampling.
- `heartbeat({ roomId, sessionId })` and `disconnectPresence({ roomId, sessionToken })` use the separate Presence component. Presence does not invalidate room, queue, playback, or recommendation snapshots.
- `setMemberMode` only lets a member choose listen mode. The host chooses room mode with `setRoomMode`, chooses the output with `setSpeaker`, and grants/revokes transport access with `setController`.
- `addQueueItem`, `removeQueueItem`, and `moveQueueItem` are bounded and revision-checked. Mutations accept command IDs and replay their original receipt on retry. Committing a queue item as playback consumes that exact entry in the same transaction.
- `publishPlayback` requires intent `control`, `natural_end`, or `checkpoint`. A host/controller may commit a control intent. Only the elected output may commit a checkpoint or one natural queue advance. Epoch and sequence checks fence stale writers. The elected speaker applies a transport intent locally, then calls `acknowledgePlaybackIntent`.
- A new playing track waits behind a durable four-second readiness barrier. Eligible listening outputs report readiness with `reportReady`; a scheduled deadline releases the current barrier if some clients do not respond. A newer pause or track cancels the old barrier.
- Speaker transfer pauses playback and sets `handoffFromUserId`. The old output must pause locally and call `acknowledgeSpeakerHandoff` before the new output can publish. If the old output never responds, the transfer stays blocked until it reconnects or the room ends.
- `regenerateInvite` deletes the previous invite and returns a new one-time code. `revokeInvite`, `leaveRoom`, and host-only `closeRoom` are also available.
- `setSuggestionsConsent({ roomId, enabled })` is a member's explicit opt-in. It is rejected while account personalization is off. `getGroupPicks` reads only a separate cached result; `refreshGroupPicks` reads at most 25 recent learned-song rows per opted-in member, excludes songs already queued, and uses the existing shared `memberTaste` and `buildBlend` scorer. Results are capped at 12 and cached for five minutes. Consent, membership, and queue changes invalidate the cache. Reads recheck each member's current profile personalization setting and suppress picks attributed to members who have since opted out.
- `account.extras` exports room IDs, roles, and join times. Account erasure closes hosted rooms, revokes their invites, removes membership and authored queue rows, and clears room recommendations derived from the erased member.

Setting the Convex environment variable `LUVLINK_CREATION_DISABLED=true` makes `createRoom` fail with `creation_disabled`. Rooms that are already open keep working and can still be joined and left; unset it to allow new rooms again.

Mutations use Convex rate limits. There are no per-second playback writes. Audio URLs are never stored in room state; `SongSnapshot` references resolve through Allegra's existing catalog/player path. Stream range requests keep the current HTTP `206` behavior.

## Web links

The app handles `/luvlink`, `/luvlink/join/:code`, and `/luvlink/room/:id`. A join link uses `NEXT_PUBLIC_WEB_ORIGIN` when configured, otherwise the active HTTPS site origin. HTTP links are allowed only for localhost development. Sign-in is required before joining a private room.

## Deferred

Bluetooth discovery, chat, car interfaces, and measured cross-device audible drift correction are not part of this implementation. A passing unit suite does not prove two physical devices stay audibly synchronized.
