# Connect contract

This document is the wire contract shared by the web and phone clients and
`convex/connect.ts`. Connect is called directly by authenticated clients. The
server derives the listener from Convex Auth on every public function; callers
never send a `userId`.

## Identity and ownership

- `userId` is `String(await getAuthUserId(ctx))` and is never an argument.
- A `deviceId` is a client-generated stable identifier scoped to one install or
  browser tab. The `by_device` index is global: an existing ID owned by another
  account is rejected, never reassigned.
- Device records contain registration metadata. Online status is owned by the
  Presence component, in room `connect:<userId>` with each `deviceId` as its
  presence user/session ID. Heartbeat intervals are 60 seconds; Presence
  expires a session after 2.5 intervals without a heartbeat.
- `send` and `transfer` require the registered source and target device IDs.
  `issuedBy` records the authenticated account ID; `sourceDeviceId` records
  which owned device requested the operation.

## Stored records

All timestamps and positions are milliseconds and seconds respectively.

| Table | Fields and indexes |
| --- | --- |
| `devices` | `userId`, `deviceId`, `name`, `kind` (`web` / `android` / `ios`), `appVersion`, `canPlay`, optional `protocolVersion` (missing is legacy V1), `createdAt`, `retentionCheckedAt`; indexes `by_user_and_createdAt`, `by_device`, and `by_retentionCheckedAt`. Presence heartbeats are not copied into this table. `retentionCheckedAt` is an internal cursor for the 30-day stale-device sweep. |
| `connectOwnership` | One row per `userId`; optional `activeDeviceId`, monotonically increasing `epoch`, optional `handoff` (`commandId`, `toDeviceId`, `executeBefore`); index `by_userId`. This separates stable ownership reads from hot position writes. |
| `playerState` | One row per `userId`; optional `activeDeviceId` and `song`; `queue` (at most 50 snapshots); `isPlaying`, `positionSec`, server-owned `positionAt`, `volume` (0–1), `shuffle`, `repeat` (`off` / `all` / `one`), `rev`; index `by_user`. `activeDeviceId` stays synchronized with `connectOwnership` for rollback compatibility. |
| `connectCommands` | `userId`, `sourceDeviceId`, `targetDeviceId`, `issuedBy`, `kind`, optional validated `args`, `createdAt`, `status` (`pending` / `done` / `failed`), optional `error`; V2-only optional `requestId`, `executeBefore`, `expectedOwnershipEpoch`, `reservationToken`, `beganAt`, stable `errorCode`, and transfer `release`; indexes include target/status, source/createdAt, user/source/requestId, user/status, and status/deadline/createdAt. Legacy rows remain readable. V2 terminal rows remain available for ten minutes for idempotent retries; legacy rows retain the two-minute TTL. |

Every song crossing the device boundary is a `SongSnapshot`:
`{ref,title,artist,album?,artwork,duration}`. Queue snapshots are capped at 50.

`artwork` is a cover every device can load: an `https:` URL of at most 2048 characters with no
credentials, or `''`. Never a device's own file (`file:`, `content:`), a `data:` or `blob:` URL, a
relative path, or `http:` (Android refuses cleartext images; a catalog host's `http:` link is
upgraded to `https:` before it is sent). A device whose cover for a song is its own file (a
download's `cover.jpg`, a cover the listener picked) sends the catalog's cover for the same song
instead, and a browser sends the cover it shows rather than an older stored one. A receiver reads
`''` as "look the cover up by `ref`", not as "no cover". One rule, in `packages/shared/artwork.ts`
(`shareableArtwork`), used by every client that builds a snapshot. Added 2026-10-04. The server
does not enforce it: it stores what it is sent.

## Public functions

Every function below requires authentication. `serverNow` is returned from
mutations that clients use to estimate clock offset. Queries do not read the
clock; online status comes from Presence.

| Function | Contract |
| --- | --- |
| `register({deviceId,name,kind,appVersion,canPlay,protocolVersion?})` | Upsert registration metadata, record the protocol version (default 1 for old clients), heartbeat Presence in the same mutation, and return `{serverNow}`. Current clients send protocol version 3 (queue edits, see Commands); builds up to `d8253ed` send 2. `name` is whatever the listener called the device, so registering again is also how a rename reaches the server. A device ID already owned by another account fails with `device_owned_by_another_account`. |
| `heartbeat({deviceId})` | Require an owned registered device, update Presence in the account room with a 60-second interval, return `{serverNow}`. |
| `disconnect({deviceId})` | Require an owned registered device. Mark it offline in Presence now (a graceful disconnect of its session) instead of 2.5 heartbeats later, and return `{serverNow}`. If it is the active device and the stored state is playing, pause the state at the position the song has reached and bump `rev`: its sound has stopped. Clients call it when they stop listening (signed out, tab closed, app in the background with nothing playing). Best effort: an unsent call only means the old 150-second wait. Coming back is an ordinary `register`. |
| `devices()` | Return at most 100 owned devices that Presence marks online, plus the active device even if it has gone offline. Each row includes `isOnline`, `isActive`, `canPlay`, and `protocolVersion` (default 1). |
| `state()` | Return this account's player state or `null`, augmented with the authoritative `ownershipEpoch` and any pending handoff `{commandId,toDeviceId}`. |
| `inboxFor({deviceId})` | V2 client query; return at most 50 pending rows addressed to the owned device, oldest first. Rows include `commandId`, source, command kind/args, request ID, deadline, expected epoch, reservation token, and transfer release data when present. |
| `outcomesFor({deviceId})` | V2 client query; return the 20 most recent commands sent by the owned device, oldest first. Outcomes include status and error fields but never repeat command args. A pending row carries `began: true` once the target has reserved it (`beginV2`): the sender then waits for the command's deadline instead of the 4-second pick-up window, so a slow song load or transfer is not reported as unreachable. |
| `commandsFor({deviceId})` | Require an owned registered device; return up to 50 pending commands addressed to it and up to 50 most recent commands it sent, including `pending` / `done` / `failed` status and optional error. Results are deduplicated and sorted oldest first. |
| `report({deviceId,patch,rev,expectedOwnershipEpoch?})` | Only the active device may report. V2 callers require the current ownership epoch as well as the current `rev`. Merge only supplied fields. `positionAt` changes only with `positionSec`; a play/pause change without a position first advances the stored position to now. Other fields leave the position anchor unchanged. |
| `claim({deviceId,snapshot,expectedOwnershipEpoch?})` | Require an owned registered device. V2 callers include the observed epoch. A changed owner increments the epoch, clears a handoff, and fails pending V2 commands from the old epoch as `superseded`. A claim by the existing owner at the matching epoch is an idempotent state write. |
| `send({fromDeviceId,targetDeviceId,kind,args?})` | Require both source and target to be owned registered devices. Enqueue one validated command and return `{commandId,serverNow}`. All commands share an exact transactional account quota of 20 per fixed 10-second window. |
| `ack({deviceId,commandId,ok,error?})` | Require `deviceId` to equal the command target and belong to this account. Mark a pending command `done` or `failed`; repeat acknowledgements are idempotent and return `{updated:false,serverNow}`. Error text is capped at 240 characters. |
| `transfer({fromDeviceId,toDeviceId})` | Require both devices to be owned and an existing player state. Enqueue `take_over` with the current state as its payload and return `{commandId,serverNow}`. |
| `sendV2({fromDeviceId,targetDeviceId,requestId,expectedOwnershipEpoch,kind,args?})` | Additive fenced send. `requestId` is 8–64 characters and deduplicates by account/source/request ID: identical retries return the original receipt; changed content fails `request_conflict`. Target must be the active V2 device and able to play. `queue_remove`, `queue_move` and `queue_clear` need a target on protocol 3 or later and otherwise fail `update_required` (an older app drops a kind it does not know, which would read as an unreachable device). A server deadline is 15 seconds for controls and queue edits, and 60 seconds for anything that may look a song up (`play_song`, `queue_add`). `take_over` is refused here. |
| `transferV2({fromDeviceId,toDeviceId,requestId,expectedOwnershipEpoch})` | Additive V2 transfer command with the same request dedupe and account quota. The destination must be owned, online, V2, and able to play; a current song is required. The destination may equal the source device. The command is bound to the observed ownership epoch and has a 60-second deadline. |
| `beginV2({deviceId,commandId})` | Target-only execution reservation. Refuse expired, stale-epoch, terminal, or non-playable commands before player work. Repeated begin on the same pending command returns the same reservation token. Legacy inbox rows can still use this receiver path. |
| `prepareV2({deviceId,commandId,reservationToken})` | Transfer destination calls after it has loaded the song paused. If a different owner is still playing and Presence counts it online (legacy clients included), record a handoff and wait for its confirmed pause. Otherwise make the destination active at the next epoch, paused, and return the resume intent: at the saved position when the state was paused, or at the position the song has reached when the playing owner is offline in Presence (see below). |
| `releaseV2({deviceId,commandId,expectedOwnershipEpoch,positionSec,resume})` | Current owner calls only after its player confirms pause. Atomically set the exact paused position, move ownership to the destination, increment epoch, clear the handoff, and record the release data. A transfer whose online owner does not confirm within 15 seconds fails `owner_unreachable`. |
| `completeV2({deviceId,commandId,reservationToken,outcome,patch?,rev?})` | Complete or fail a reserved command idempotently. Successful patches require the target to be active and the exact revision; conflicts return `currentRev` without finalizing so the client can retry completion without replaying audio. Failed outcomes never apply patches and clear a matching handoff. |

### Taking playback from an owner that has gone

Changed 2026-10-01. Before, a playing owner always had to confirm its pause, so a device that
died mid-song (a closed laptop lid, a killed app) held playback until someone pressed Play on
another device's own song. Now an owner that Presence has given up on (no heartbeat for 150
seconds, or a `disconnect`) is not waited for: `prepareV2` hands playback to the destination where
the song would have reached, with the owner's song and queue.

The cost is the one case where two devices can sound at once: the owner is still playing but cut
off from the server. It lasts until that owner reconnects. Its next `report` or `claim` is refused
(`device_not_active` / `stale_ownership`) and the session pauses it; it also pauses as soon as its
state query shows another active device. A `claim` by a device that starts its own song already
worked this way. While Presence still counts the owner online nothing changes: no confirmation, no
transfer.

`claim.snapshot` and `report.patch` may contain `song`, `queue`, `isPlaying`,
`positionSec`, `volume`, `shuffle`, and `repeat`. `positionAt`,
`activeDeviceId`, and `rev`
are server-owned. Empty patches, queues above 50 items, non-finite or negative
positions, and volumes outside 0–1 are rejected.

## Commands

The `kind` and `args` pair is validated together before enqueueing:

| Kind | Args |
| --- | --- |
| `play`, `pause`, `next`, `prev` | omitted |
| `seek` | `{sec:number}` |
| `volume` | `{v:number}` (0–1) |
| `shuffle` | `{on:boolean}` |
| `repeat` | `{mode:'off'|'all'|'one'}` |
| `play_song` | `{song:SongSnapshot,queue?:SongSnapshot[],positionSec?:number}`. `positionSec` (≥ 0) starts the song there; a protocol 2 receiver ignores it and starts at 0. |
| `queue_add` | `{song:SongSnapshot,more?:SongSnapshot[],next?:boolean}`. `more` (at most 49) follows `song` in order: the rest of an album. `next: true` puts them straight after the current song instead of at the end. A protocol 2 receiver adds `song` alone, at the end. |
| `queue_remove` | `{index:number,ref:string}`. Protocol 3 targets only. |
| `queue_move` | `{from:number,to:number,ref:string}`. Protocol 3 targets only. |
| `queue_clear` | omitted. Protocol 3 targets only. |
| `take_over` | `{state:PlayerStateSnapshot}`; created only by `transfer` |

Queue edits act on the upcoming queue (the songs after the current one) and never restart the
current song. Indexes are 0–49 and count from the next song, as the sender saw the queue in
`state.queue`. The receiver trusts `ref` over the index: the queue may have moved since (a song
ended, another controller edited it), so it uses the index only when that position still holds
`ref`, otherwise the first queued song with that ref, and fails `not_found` ("That song is no
longer in the queue.") when there is none. `to` is the song's place among the others once it has
been taken out. The receiver reports the resulting queue in its completion patch, so every
controller sees the edit in the same transaction that marks the command done.

`PlayerStateSnapshot` contains `song?`, `queue`, `isPlaying`, `positionSec`,
`positionAt`, `volume`, `shuffle`, `repeat`, `rev`, and `ownershipEpoch?` (the epoch the
transfer was queued under; always sent by the server since 2026-10-01, missing on older rows).
Receivers must not require `ownershipEpoch`: the command's `expectedOwnershipEpoch` is the fence.
Android builds from `a8577af` do require it, which is why the server keeps sending it. Clients acknowledge a
command only after applying it through their player adapter. Failed application
uses `ok:false` and a short displayable error.

## Errors

Public errors carry a stable `{code,message}` payload. Codes are
`unauthenticated`, `device_not_registered`, `device_owned_by_another_account`,
`invalid_command`, `rate_limited`, `player_state_missing`, `device_not_active`,
`stale_revision`, `command_not_found`, `command_not_target`, `stale_ownership`,
`command_expired`, `request_conflict`, `update_required`, `target_cannot_play`,
`target_not_active`, `reservation_mismatch`, `handoff_missing`, and `offline`.

V2 command failure codes are `needs_gesture`, `not_found`, `expired`,
`superseded`, `cannot_play`, `owner_unreachable`, and `command_failed`.

The internal five-minute sweep removes commands older than two minutes and
checks registered devices whose retention check is at least 30 days old against
Presence's `lastDisconnected`. It removes an offline device only when its last
disconnect is at least 30 days old (or when it has no Presence session), and
keeps an online or recently disconnected device. The scan is indexed and
bounded per transaction; subsequent invocations continue through eligible
rows.
