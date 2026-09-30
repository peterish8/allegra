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
| `devices` | `userId`, `deviceId`, `name`, `kind` (`web` / `android` / `ios`), `appVersion`, `canPlay`, `createdAt`, `retentionCheckedAt`; indexes `by_user_and_createdAt`, `by_device`, and `by_retentionCheckedAt`. Presence heartbeats are not copied into this table. `retentionCheckedAt` is an internal cursor for the 30-day stale-device sweep. |
| `playerState` | One row per `userId`; optional `activeDeviceId` and `song`; `queue` (at most 50 snapshots); `isPlaying`, `positionSec`, server-owned `positionAt`, `volume` (0–1), `shuffle`, `repeat` (`off` / `all` / `one`), `rev`; index `by_user`. |
| `connectCommands` | `userId`, `sourceDeviceId`, `targetDeviceId`, `issuedBy`, `kind`, optional validated `args`, `createdAt`, `status` (`pending` / `done` / `failed`), optional `error`; indexes `by_target_and_status`, `by_source_and_createdAt`, and `by_createdAt`. Commands expire after two minutes. |

Every song crossing the device boundary is a `SongSnapshot`:
`{ref,title,artist,album?,artwork,duration}`. Queue snapshots are capped at 50.

## Public functions

Every function below requires authentication. `serverNow` is returned from
mutations that clients use to estimate clock offset. Queries do not read the
clock; online status comes from Presence.

| Function | Contract |
| --- | --- |
| `register({deviceId,name,kind,appVersion,canPlay})` | Upsert registration metadata for this account and return `{serverNow}`. A device ID already owned by another account fails with `device_owned_by_another_account`. |
| `heartbeat({deviceId})` | Require an owned registered device, update Presence in the account room with a 60-second interval, return `{serverNow}`. |
| `devices()` | Return at most 100 owned devices that Presence marks online, plus the active device even if it has gone offline. Each row includes `isOnline` and `isActive`. |
| `state()` | Return this account's player state or `null`. |
| `pendingFor({deviceId})` | Require an owned registered device; return at most 50 pending commands for it, oldest first. |
| `commandsFor({deviceId})` | Require an owned registered device; return up to 50 pending commands addressed to it and up to 50 most recent commands it sent, including `pending` / `done` / `failed` status and optional error. Results are deduplicated and sorted oldest first. |
| `report({deviceId,patch,rev})` | Only the currently active device may report. `rev` must equal the stored revision; accepted reports patch the provided playback fields, set `positionAt` from server time, increment `rev`, and return `{rev,serverNow}`. |
| `claim({deviceId,snapshot})` | Require an owned registered device. Make it active and store the full client playback snapshot (`song?`, queue, play state, position, volume, shuffle, repeat); set `positionAt` to server time and increment `rev`. |
| `send({fromDeviceId,targetDeviceId,kind,args?})` | Require both source and target to be owned registered devices. Enqueue one validated command and return `{commandId,serverNow}`. All commands share an exact transactional account quota of 20 per fixed 10-second window. |
| `ack({deviceId,commandId,ok,error?})` | Require `deviceId` to equal the command target and belong to this account. Mark a pending command `done` or `failed`; repeat acknowledgements are idempotent and return `{updated:false,serverNow}`. Error text is capped at 240 characters. |
| `transfer({fromDeviceId,toDeviceId})` | Require both devices to be owned and an existing player state. Enqueue `take_over` with the current state as its payload and return `{commandId,serverNow}`. |

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
| `play_song` | `{song:SongSnapshot,queue?:SongSnapshot[]}` |
| `queue_add` | `{song:SongSnapshot}` |
| `take_over` | `{state:PlayerStateSnapshot}`; created only by `transfer` |

`PlayerStateSnapshot` contains `song?`, `queue`, `isPlaying`, `positionSec`,
`positionAt`, `volume`, `shuffle`, `repeat`, and `rev`. Clients acknowledge a
command only after applying it through their player adapter. Failed application
uses `ok:false` and a short displayable error.

## Errors

Public errors carry a stable `{code,message}` payload. Codes are
`unauthenticated`, `device_not_registered`, `device_owned_by_another_account`,
`invalid_command`, `rate_limited`, `player_state_missing`, `device_not_active`,
`stale_revision`, `command_not_found`, and `command_not_target`.

The internal five-minute sweep removes commands older than two minutes and
checks registered devices whose retention check is at least 30 days old against
Presence's `lastDisconnected`. It removes an offline device only when its last
disconnect is at least 30 days old (or when it has no Presence session), and
keeps an online or recently disconnected device. The scan is indexed and
bounded per transaction; subsequent invocations continue through eligible
rows.
