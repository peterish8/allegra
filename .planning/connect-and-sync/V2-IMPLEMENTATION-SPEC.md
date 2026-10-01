# Connect V2 and sync completion: implementation spec

Written 2026-10-01. This is the single source every implementing agent builds against. It turns the
owner-approved [RELIABILITY-CONTRACT-PROPOSAL.md](./RELIABILITY-CONTRACT-PROPOSAL.md), the slices in
[IMPROVEMENT-PLAN.md](./IMPROVEMENT-PLAN.md) (C1–C10 / P1–P9) and the 2026-10-01 audit (items 1–11,
database rows 1–11, listed in section 9) into exact wire shapes, interfaces and file ownership.

Where this file is exact (function names, argument and return shapes, error codes, the TypeScript
interfaces in section 3), follow it to the letter: other agents are coding against the same text in
parallel. Where it describes behaviour, the internal design is yours.

If you find the spec is wrong or impossible, do not silently diverge. Implement the closest correct
thing, and put a section "Spec deviations" at the top of your final report with the exact shape you
shipped.

## 0. Ground rules for every agent

- Repo rules: root `CLAUDE.md`, `apps/mobile/CLAUDE.md`, `docs/architecture.md`. Convex work: read
  `convex/_generated/ai/guidelines.md` first; it overrides what you remember about Convex.
- **Stay inside your file ownership** (section 8). Other agents are editing the other areas right
  now. If you need a change outside your area, say so in your report instead of making it.
- The Connect UI files (`apps/web/src/components/PlayerPanel.tsx`, `apps/web/src/styles/*.css`,
  `apps/mobile/src/components/connect/*`, `apps/mobile/src/screens/StreamScreen.tsx`) carry
  uncommitted work from earlier today. The owner confirmed on 2026-10-01 that nothing else is
  editing them now, so the web and phone Connect agents may change them freely; build on that
  work rather than reverting it.
- No git state changes: no commit, stash, checkout, reset, clean, branch. No `convex dev`,
  `convex deploy`, `vercel`, or anything that touches a deployed backend. No dependency installs.
  Do not start dev servers. Do not touch `.mcp.json`, `mobile allegra.png`, `output/`,
  `apps/mobile/android/*.log`.
- TypeScript strict, no `any`. No `console.log` in production paths. Code in `packages/` imports no
  npm packages (Metro would bundle a second React).
- Tests are behaviour tests through public interfaces. Every defect you fix gets a test that fails
  on the old code. Mobile tests never mock SQLite.
- Windows box: PowerShell is the default shell, Git Bash is available. If the `npm` shim fails use
  `npm.cmd` / `npx.cmd`, or the binaries in `node_modules\.bin`.
- Finish by running the checks listed for your workstream and report the exact commands and
  results, including anything that still fails. Do not claim a check passed without running it.

## 1. Server data model (additive only)

| Table | Change |
| --- | --- |
| `devices` | `+ protocolVersion: v.optional(v.number())`. Missing means legacy (1). |
| `connectOwnership` (new) | `{ userId: string, activeDeviceId?: string, epoch: number, handoff?: { commandId: Id<'connectCommands'>, toDeviceId: string, executeBefore: number } }`, index `by_userId`. One row per account. It is the only place `devices()` learns who is active. |
| `playerState` | Unchanged shape. Keep writing `activeDeviceId` on every claim so a rollback to old code still works. Readers use `connectOwnership`; if the row is missing they fall back to `playerState.activeDeviceId` with epoch 0, and the next claim creates the row. |
| `connectCommands` | `+ requestId?: string`, `executeBefore?: number`, `expectedOwnershipEpoch?: number`, `reservationToken?: string`, `beganAt?: number`, `errorCode?: string`, `release?: { positionSec: number, resume: boolean }`. New index `by_userId_and_sourceDeviceId_and_requestId`. Statuses stay `pending` / `done` / `failed`. |

Retention: terminal V2 commands are kept 10 minutes (dedupe window); legacy rows keep the 2-minute
sweep. The sweep also clears a `handoff` whose `executeBefore` has passed.

## 2. Convex functions (`convex/connect.ts`)

All derive the account from Convex Auth. Errors are `ConvexError({ code, message, ...details })`.

New error codes: `stale_ownership` (`{ currentEpoch, activeDeviceId? }`), `command_expired`,
`request_conflict`, `update_required`, `target_cannot_play`, `target_not_active`,
`reservation_mismatch`, `handoff_missing`.

### Kept for legacy clients (unchanged signatures)

`heartbeat`, `commandsFor`, `send`, `ack`, `transfer`. `send` additionally rejects a target with
`canPlay: false` (`target_cannot_play`). Delete `pendingFor`: no client calls it.

### Changed

| Function | Contract |
| --- | --- |
| `register({deviceId,name,kind,appVersion,canPlay,protocolVersion?})` → `{serverNow}` | As before, stores `protocolVersion`, **and heartbeats Presence in the same mutation** so a device is in other pickers immediately (audit 2). |
| `devices()` → rows `{deviceId,name,kind,appVersion,canPlay,isOnline,isActive,protocolVersion}` | Reads `devices`, Presence and `connectOwnership` only. Must not read `playerState` unless the ownership row is missing (audit DB row 5). `protocolVersion` defaults to 1. |
| `state()` → `null \| {song?,queue,isPlaying,positionSec,positionAt,volume,shuffle,repeat,rev,activeDeviceId?,ownershipEpoch,handoff?: {commandId,toDeviceId}}` | Reads `playerState` + `connectOwnership`. |
| `claim({deviceId,snapshot,expectedOwnershipEpoch?})` → `{rev,serverNow,ownershipEpoch}` | Every successful claim increments the epoch, sets the active device, clears any `handoff`, and fails pending V2 commands bound to the old epoch (`errorCode: 'superseded'`, bounded read). When `expectedOwnershipEpoch` is given and differs from the stored epoch: `stale_ownership`. A claim by the already-active device with a matching epoch is an idempotent state write and does **not** increment the epoch. |
| `report({deviceId,patch,rev,expectedOwnershipEpoch?})` → `{rev,serverNow}` | `patch` is a non-empty partial: `{song?: SongSnapshot \| null, queue?, isPlaying?, positionSec?, volume?, shuffle?, repeat?}`. `song: null` clears the track; an omitted field is unchanged. **Position anchor rule:** `positionAt` is set to now only when the patch carries `positionSec`. If the patch changes `isPlaying` without `positionSec`, first advance the stored `positionSec` to its extrapolated value at now, then set `positionAt = now`. Any other patch (volume, shuffle, repeat, queue) leaves `positionSec` and `positionAt` untouched. Epoch mismatch: `stale_ownership`. |

### New

| Function | Contract |
| --- | --- |
| `inboxFor({deviceId})` → `InboxRow[]` | At most 50 pending commands addressed to this owned device, oldest first (createdAt, then id). Row: `{commandId,sourceDeviceId,kind,args?,createdAt,requestId?,executeBefore?,expectedOwnershipEpoch?,reservationToken?,release?}`. |
| `outcomesFor({deviceId})` → `OutcomeRow[]` | The 20 most recent commands this device sent, oldest first. Row: `{commandId,requestId?,targetDeviceId,kind,createdAt,status,error?,errorCode?}`. **No `args`** (audit DB row 9). |
| `sendV2({fromDeviceId,targetDeviceId,requestId,expectedOwnershipEpoch,kind,args?})` → `{commandId,serverNow,executeBefore,ownershipEpoch}` | `requestId` is 8–64 chars. Look up `(userId, fromDeviceId, requestId)` first: same kind and args returns the original receipt without spending quota; different kind or args fails `request_conflict`. Then: both devices owned; target is the active device (`target_not_active`) and the epoch matches (`stale_ownership`); target `canPlay` (`target_cannot_play`); target `protocolVersion >= 2` (`update_required`); the unchanged 20 per 10 s account quota. `take_over` is refused here. Deadline chosen by the server: 15 s for `play`, `pause`, `seek`, `next`, `prev`, `volume`, `shuffle`, `repeat`; 60 s for `play_song` and `queue_add`. |
| `transferV2({fromDeviceId,toDeviceId,requestId,expectedOwnershipEpoch})` → same receipt | Same dedupe and quota. Target must be owned, `canPlay`, V2. Requires a player state with a song (`player_state_missing`). Enqueues `take_over` with `args.state` as today, bound to the current epoch, 60 s deadline. `toDeviceId` may equal `fromDeviceId` ("play here"). |
| `beginV2({deviceId,commandId})` → `{reservationToken,serverNow,executeBefore}` | Caller must be the target. If the command is past `executeBefore`: mark it `failed` with `errorCode: 'expired'` and throw `command_expired`. If its `expectedOwnershipEpoch` differs from the current epoch: mark `failed` / `superseded` and throw `stale_ownership`. If the target is `canPlay: false`: mark `failed` / `cannot_play` and throw `target_cannot_play`. Otherwise store a fresh token and `beganAt`. Calling it again for an already-begun pending command returns the same token (same process redelivery). A terminal command throws `command_not_found`. |
| `prepareV2({deviceId,commandId,reservationToken})` → `{status:'activated',serverNow,rev,ownershipEpoch,positionSec,resume}` or `{status:'awaiting_release',serverNow}` | Only for `take_over`, called once the destination has loaded the song **paused**. Re-checks token, deadline and epoch. Let *owner* be the current active device. Activate immediately only when there is no owner, the owner is this device, or the stored state is not playing. Otherwise write `handoff = {commandId,toDeviceId,executeBefore}` on the ownership row and return `awaiting_release`. This includes an owner that is offline or legacy: the old owner must confirm pause before the destination can activate. If that owner cannot return before the deadline, the transfer fails `owner_unreachable`, and ownership/state remain unchanged. On immediate activation, return the stored position (extrapolated to now only if the old owner is still playing) and stored `isPlaying` as `resume`; clamp position to the song duration. This strict rule implements the owner's explicit confirmed-pause approval and prevents two audio sources. |
| `releaseV2({deviceId,commandId,expectedOwnershipEpoch,positionSec,resume})` → `{serverNow,rev,ownershipEpoch}` | Called by the **old owner** after its local player has confirmed pause. Requires caller is the active device at that epoch and `handoff.commandId` matches (`handoff_missing`). Atomically: store `positionSec`, `isPlaying: false`, `positionAt = now`; make `handoff.toDeviceId` active; epoch + 1; clear the handoff; write `release = {positionSec,resume}` on the command row. |
| `completeV2({deviceId,commandId,reservationToken,outcome,patch?,rev?})` → `{status:'completed',serverNow,rev,ownershipEpoch}` or `{status:'conflict',serverNow,currentRev}` | `outcome` is `{ok:true}` or `{ok:false,code,error?}` (`error` capped at 240 chars). A command already terminal returns `completed` with the recorded result and changes nothing (no second revision bump). Success with a `patch`: caller must be the active device; `rev` must equal the stored revision, else return `conflict` **without** finalizing; then apply the patch with the `report` anchor rule and mark `done` in the same transaction. Success without a patch just marks `done`. A failed outcome never applies a patch; it marks `failed` with `errorCode = code`, and if this command owns the current `handoff` it clears it. An expired command is finalized as `failed` / `expired` whatever outcome was sent. |

Failure codes written to `errorCode`: `needs_gesture`, `not_found`, `expired`, `superseded`,
`cannot_play`, `owner_unreachable`, `command_failed`.

### Rate limits

Keep the `connectCommands` quota. Add per-device token buckets that normal use never reaches and a
runaway loop does: `claim` (burst 6, 12/min), `report` (burst 20, 60/min), `register` (burst 5,
10/min), `heartbeat` (burst 3, 4/min). Over the limit: `rate_limited` with `retryAfterMs`.

### Song snapshot validation

One `assertSongSnapshot` for Connect and the library. An empty `artist` is accepted (the library
already accepts it and the phone produces it); title and ref stay required.

## 3. Shared TypeScript surface (`packages/connect/src/types.ts`)

These names and shapes are fixed. Keep the existing trace types, `PlayerSnapshot`, `RemoteCommand`,
`RepeatMode`, `DeviceKind`, `Clock`, `TransferResult`, `ConnectSession`.

```ts
export const CONNECT_PROTOCOL_VERSION = 2;

export type ConnectFailureCode =
  | 'needs_gesture' | 'not_found' | 'expired' | 'superseded'
  | 'cannot_play' | 'owner_unreachable' | 'command_failed';

/** Codes carried on thrown transport errors as `error.data.code`. */
export type ConnectErrorCode =
  | 'unauthenticated' | 'device_not_registered' | 'device_owned_by_another_account'
  | 'invalid_command' | 'rate_limited' | 'player_state_missing' | 'device_not_active'
  | 'stale_revision' | 'stale_ownership' | 'command_not_found' | 'command_not_target'
  | 'command_expired' | 'request_conflict' | 'update_required' | 'target_cannot_play'
  | 'target_not_active' | 'reservation_mismatch' | 'handoff_missing' | 'offline';

export interface ConnectDevice {
  readonly deviceId: string; readonly name: string; readonly kind: DeviceKind;
  readonly appVersion: string; readonly canPlay: boolean; readonly isOnline: boolean;
  readonly protocolVersion: number;          // lastSeenAt is removed
}
export interface DeviceRegistration {
  readonly deviceId: string; readonly name: string; readonly kind: DeviceKind;
  readonly appVersion: string; readonly canPlay: boolean;
  readonly protocolVersion?: number;         // the session sends CONNECT_PROTOCOL_VERSION
}

export interface ConnectPlayerState extends PlayerSnapshot {
  readonly activeDeviceId?: string;
  readonly positionAt: number;               // server ms
  readonly rev: number;
  readonly ownershipEpoch: number;
  readonly handoff?: { readonly commandId: string; readonly toDeviceId: string };
}

export interface PlayerStatePatch {
  readonly song?: SongSnapshot | null;       // null clears, omitted = unchanged
  readonly queue?: readonly SongSnapshot[];
  readonly isPlaying?: boolean; readonly positionSec?: number; readonly volume?: number;
  readonly shuffle?: boolean; readonly repeat?: RepeatMode;
}

export interface InboxCommand {
  readonly id: string; readonly sourceDeviceId: string; readonly command: RemoteCommand;
  readonly createdAt: number; readonly requestId?: string;
  readonly executeBefore?: number; readonly expectedOwnershipEpoch?: number;
  readonly release?: { readonly positionSec: number; readonly resume: boolean };
}
export interface CommandOutcome {
  readonly id: string; readonly requestId?: string; readonly targetDeviceId: string;
  readonly kind: RemoteCommand['kind']; readonly createdAt: number;
  readonly status: 'pending' | 'done' | 'failed';
  readonly errorCode?: ConnectFailureCode; readonly error?: string;
}

/** No server time here: only mutations yield clock samples. */
export interface ConnectSnapshot {
  readonly devices: readonly ConnectDevice[];
  readonly state?: ConnectPlayerState;
  readonly inbox: readonly InboxCommand[];
  readonly outcomes: readonly CommandOutcome[];
}

export interface SendReceipt {
  readonly commandId: string; readonly serverNow: number;
  readonly executeBefore: number; readonly ownershipEpoch: number;
}
export type CommandOutcomeInput =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ConnectFailureCode; readonly error?: string };
export type PrepareResult =
  | { readonly status: 'activated'; readonly serverNow: number; readonly rev: number;
      readonly ownershipEpoch: number; readonly positionSec: number; readonly resume: boolean }
  | { readonly status: 'awaiting_release'; readonly serverNow: number };
export type CompleteResult =
  | { readonly status: 'completed'; readonly serverNow: number; readonly rev: number; readonly ownershipEpoch: number }
  | { readonly status: 'conflict'; readonly serverNow: number; readonly currentRev: number };

export interface ConnectTransport {
  register(device: DeviceRegistration): Promise<{ readonly serverNow: number }>;
  heartbeat(deviceId: string): Promise<{ readonly serverNow: number }>;
  /** The listener is first called once all three queries have delivered a server result. */
  watch(deviceId: string, listener: (snapshot: ConnectSnapshot) => void): () => void;
  report(deviceId: string, patch: PlayerStatePatch, expected: { readonly rev: number; readonly ownershipEpoch: number }): Promise<{ readonly serverNow: number; readonly rev: number }>;
  claim(deviceId: string, snapshot: PlayerSnapshot, expectedOwnershipEpoch?: number): Promise<{ readonly serverNow: number; readonly rev: number; readonly ownershipEpoch: number }>;
  send(input: { readonly fromDeviceId: string; readonly targetDeviceId: string; readonly requestId: string; readonly expectedOwnershipEpoch: number; readonly command: RemoteCommand }): Promise<SendReceipt>;
  transfer(input: { readonly fromDeviceId: string; readonly toDeviceId: string; readonly requestId: string; readonly expectedOwnershipEpoch: number }): Promise<SendReceipt>;
  begin(deviceId: string, commandId: string): Promise<{ readonly reservationToken: string; readonly serverNow: number; readonly executeBefore: number }>;
  prepare(deviceId: string, commandId: string, reservationToken: string): Promise<PrepareResult>;
  release(input: { readonly deviceId: string; readonly commandId: string; readonly expectedOwnershipEpoch: number; readonly positionSec: number; readonly resume: boolean }): Promise<{ readonly serverNow: number; readonly rev: number; readonly ownershipEpoch: number }>;
  complete(input: { readonly deviceId: string; readonly commandId: string; readonly reservationToken: string; readonly outcome: CommandOutcomeInput; readonly patch?: PlayerStatePatch; readonly rev?: number }): Promise<CompleteResult>;
}
```

- Transports **throw** on failure. The thrown value is an `Error` with `data: { code:
  ConnectErrorCode, message: string, ...details }` (the `ConvexError` shape). `MutationResult` and
  its `accepted` flag are removed. Export a `connectError(code, details?)` helper and an
  `errorCode(error)` reader from the package.
- `ConnectCommand` and `userDeviceId` are removed (`sourceDeviceId` replaces the mysterious name).
- `PlayerPort.pause()` now means: resolves once the platform player has confirmed it is paused
  (or after a bounded wait). `PlayerPort.load()` means: resolves when the **selected** song is
  ready at the requested position; the rest of the queue may still be resolving, and
  `getSnapshot().queue` must already return the full intended queue in order.
- `ConnectView` additions: `ownershipEpoch: number`, `activeDeviceOnline: boolean`,
  `queuedCommands: number`, `lastErrorCode?: ConnectErrorCode | ConnectFailureCode`.
  New session method `livePosition(): number` (cheap, no allocation) so renderers can tick without
  rebuilding the whole view.

### Shared wire module (`packages/connect/src/convexWire.ts`) — owned by the session agent

One implementation of `ConnectTransport` over Convex for both apps (C8). It imports nothing from
npm. The apps inject a binding:

```ts
export interface ConvexWireClient {
  mutation(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** `current()` returns undefined until the first server result, and may throw on a failed query. */
  watchQuery(name: string, args: Record<string, unknown>): { onUpdate(callback: () => void): () => void; current(): unknown };
}
export function createConvexTransport(client: ConvexWireClient, options?: { readonly trace?: ConnectTraceWriter }): ConnectTransport;
```

Function names it calls: `connect:register`, `connect:heartbeat`, `connect:devices`, `connect:state`,
`connect:inboxFor`, `connect:outcomesFor`, `connect:report`, `connect:claim`, `connect:sendV2`,
`connect:transferV2`, `connect:beginV2`, `connect:prepareV2`, `connect:releaseV2`,
`connect:completeV2`. It validates and decodes every payload (the mobile `commandFor` decoder is the
model: a malformed row is dropped, never cast), subscribes before reading cached results, publishes
nothing until devices, state and inbox have each delivered once, and never invents a server time.

## 4. Session behaviour (`packages/connect/src/connectSession.ts`)

Each line is an acceptance test.

**Sending (C1, C2).**
- `control()` never drops input. Up to 32 unsent intents are held in order; adjacent unsent `seek`
  or `volume` for the same target and epoch coalesce to the latest value; nothing coalesces across
  a discrete command. One transmitted, unresolved command at a time. Overflow sets a visible error.
- Each intent gets a stable `requestId` before its first transmission; a retry after an uncertain
  failure reuses it.
- Feedback timeout is 4 s from input and means *outcome unknown*: optimistic UI rolls back,
  "Couldn't reach …" shows, and a late result may still update `lastError` but never restores the
  optimistic state. play then pause, sent quickly, ends paused.
- Before sending: the active device must be online and `canPlay` (audit 1, 9). If the active device
  is **offline** and the command is `play` or `play_song`, the session plays on this device and
  claims instead of sending. Other commands to an offline device fail at once with a clear error.
- `stale_ownership` on send: drop queued intents bound to the old epoch and report them failed.

**Receiving (C1, C2, C3).**
- The inbox is drained by one serial worker in server order. Actions never overlap. A redelivered
  command that is executing or finished is not started again.
- `begin` before touching the player. `command_expired` / `stale_ownership` / `target_cannot_play`:
  never execute. Re-check the deadline against the corrected server clock before entering the
  player adapter.
- A device registered `canPlay: false` executes nothing and completes with `cannot_play`.
- After the action, one `complete` carries the outcome plus the resulting state patch and current
  revision. On `conflict`, rebase the revision and retry `complete` only — never replay the audio
  action. Completion retries are separate from execution state.
- Legacy commands (no `executeBefore`) in the inbox are executed and finished through the same
  path; `complete` works for them too.

**Ownership (audit 5, 6).**
- Automatic claims happen only on a local paused→playing edge (or when the session starts while
  already playing) on a non-active device, are single-flight, and carry the observed epoch. Position
  ticks never claim. A rejected or failed claim is not retried per tick.
- `stale_ownership` on an automatic claim while another device is active: pause locally.
- Losing ownership while playing pauses the local player and stops report retries.

**Transfer (confirmed pause).**
- `transferTo(other)`: `transfer` → wait for the outcome. Refuse up front if the target is offline,
  cannot play, or is legacy (`update_required` message).
- `transferTo(self)` uses the same command path (`toDeviceId == fromDeviceId`).
- Destination: `begin` → `player.load(song, queue, {positionSec: estimate, play:false})` →
  `prepare`. `activated`: seek to `positionSec`, play if `resume`, then `complete` with a patch.
  `awaiting_release`: wait for this command's `release` in the inbox, then seek to
  `release.positionSec`, play if `release.resume`, `complete`. If the deadline passes first:
  `complete` failed `owner_unreachable`; the old owner keeps playing.
- Old owner: on `state.handoff` for another device while active at that epoch, remember
  `resume = isPlaying`, `await player.pause()`, read the exact position, call `release`. No reports
  or claims during a handoff.
- Autoplay blocked after activation: the destination is the owner, paused, `autoplayBlocked` set,
  command completed failed `needs_gesture`.
- A failed load (`not_found`) never changes ownership.

**Reporting (C6, audit 4, 8).**
- One report in flight, at most one trailing. Reports send only dirty fields. Queue and song are
  sent only when their refs change (a change token, not a JSON string per tick).
- Play, pause, track and seek report immediately. A seek is a position that differs from the
  expected extrapolated position by more than 1.5 s. Position-only drift reports follow the same
  1.5 s threshold and are bounded to one per 5 s; there is no unconditional 30 s write.
- Position and `isPlaying` are always sent together.
- Restore of the last session waits for the first authoritative snapshot. While this device has no
  local song, it never reports `song`, `queue` or `positionSec`; a volume change sends volume only.
  A reload therefore cannot erase the stored queue or position.

**Clock (C5).**
- Offset samples come only from mutation replies, measured against the request midpoint with a
  monotonic duration; the lowest round-trip sample wins; a wall-clock jump discards the estimate.
  Reactive snapshots never touch it. Two clients skewed ±120 s agree on the remote position within
  the sample's uncertainty; a paused position is frozen; position is clamped to `[0, duration]`.

**Lifecycle (C9).**
- Unchanged listening rule (visible, playing or active) and 60 s heartbeat. Dispose and account
  change cancel every timer, queued intent and retry.

`MemoryTransport` must mirror the Convex semantics in section 2 (merging patches, anchor rule,
epochs, deadlines, dedupe, handoff, thrown coded errors, register marks online). Add knobs the tests
need: per-call delay, dropped replies, forced offline devices, legacy devices, manual time.

## 5. Library sync contract (HTTP, additive)

`POST /api/me/library/ops` body becomes `{ ops, sentAt? }`. `sentAt` is the device's wall clock in
ms when the request was sent. When present and the device clock differs from the server's by more
than 2 s, the server shifts every op's `at` by `(serverReceivedAt - sentAt)` before applying
(audit 11). The reply gains two fields: `superseded: number[]` (indexes of ops that lost to newer
state, so the client knows to pull) and `applied: number` . `rev` and `rejected` are unchanged.
Old clients that omit `sentAt` behave as today. Update `docs/api-contract.md` in the same change.

`GET /api/me/library/changes?since=0` returns current rows only: no tombstones are needed by a
client that has nothing (audit DB row 10). Tombstone compaction is **not** in scope unless it can be
done with a safe floor that forces a stale cursor into a full resync; if you defer it, say so.

## 6. Adapter requirements

**Both apps.** Build the transport with `createConvexTransport`; delete the duplicated classes.
`PlayerPort.load` resolves the selected song first and hydrates the rest of the queue in the
background, next item first, at most 2 lookups in flight, deduplicated by ref, cancelled by a load
generation token on a new load, queue edit, account change or dispose. Unresolved entries stay in
the reported queue (C4). Catalog lookups batch through `GET /api/songs?ids=` (50 per call) where the
ref allows it (audit DB row 8). `PlayerPort.pause()` resolves on confirmed pause.

**Web (`apps/web`).**
- Audit 1: `remotePlayback` is true only while the active device is another device that is online
  (or a transfer is in progress); song clicks never route to an offline device.
- Audit 3: one tab per browser profile and account runs the Connect session, chosen with the Web
  Locks API (`navigator.locks`), falling back to today's behaviour where it is missing. Other tabs
  run no session and show "Allegra is playing in another tab". The `?connectDevice=` dev harness
  keeps working and bypasses the lock.
- Audit 7 / C9: the remote scrubber and lyrics advance from `session.livePosition()` on a timer
  that exists only while the document is visible and a remote device is playing.
- Remove the 5 s `GET /api/me/recently-played` poll; fetch once a few seconds after the remote
  song changes (audit DB row 1).
- Library reload keeps a `since` cursor, ignores revisions caused by its own writes, and stops
  re-hydrating `/api/me/liked` on every revision (audit DB row 2). Send `sentAt` with ops.

**Phone (`apps/mobile`).**
- Audit 6: `pause()` waits for the native player to report paused (bounded, about 1.5 s).
- Audit 10: while another online device is active, picking a song on the phone sends `play_song`
  to it. The session's own `player.load` must bypass that routing.
- Audit 9: with Listen Together active the phone registers `canPlay: false` and refuses commands.
- C9: the 1 s remote-position timer runs only in the foreground while a remote device plays, and
  must not re-render every `useConnect()` consumer; expose position through its own hook or store.
- `getSnapshot` slices the queue to 50 before mapping (audit DB row 11).
- Library: use `rev` from the ops reply and skip the pull when `myRev` equals the cursor (DB row
  7); refresh only the stores a pull actually changed (C10); send `sentAt`; pull when the reply
  lists `superseded`. Add the Settings row "Sync paused: tap to retry" once the outbox has been
  stuck for 24 h (PLAN section 6).

**Product bar for both apps (owner, 2026-10-01): "the true way, like Spotify".** A listener signed
in on the website and the phone must get, without thinking about it:
- a device picker that lists every online device of the account, marks the one that is playing,
  and moves playback with one tap, carrying the song, position, queue, volume, shuffle and repeat;
- a persistent "Playing on <device>" indicator on every non-playing device, whose play, pause,
  seek, skip, volume, shuffle, repeat and queue controls drive the playing device and move in step
  with it (scrubber, lyrics, artwork, queue);
- picking a song anywhere plays it on the playing device, not locally;
- honest feedback: a control that could not be delivered says so and rolls back; a device that
  went offline is shown as unavailable and playing here takes over instead of failing;
- no state where two devices play at once, or where both are silent after a transfer;
- nothing on screen that does nothing: every Connect control is wired to real behaviour.
Check the existing UI against this list and close the gaps you find; do not redesign what already
works.

**API (`apps/api`).** Section 5, plus one profile read per signed-in request reused as the write
base (audit DB row 6: `resolveCaller` then `authenticatedUser` read it twice).

**Convex library (`convex/library.ts`).** `returns` validators on `apply`, `changes`, `myRev`;
`apply` updates the profile copy from the rows in the batch instead of re-reading the whole library
(audit DB row 3), with a full rebuild kept only where correctness needs it; database calls in the
style `convex/_generated/ai/guidelines.md` shows.

## 7. Verification each workstream owes

| Workstream | Commands |
| --- | --- |
| Session | `npm test -w @allegra/connect`, `npm run typecheck -w @allegra/connect` |
| Convex | `npx vitest run convex/connect.test.ts` (plus any new convex test file), `npx tsc --noEmit -p convex` |
| API | `npm test -w apps/api` (or its package name), `npm run typecheck -w` same, `npm run lint -w` same |
| Web | `npm run typecheck`, `npm run lint`, web unit tests |
| Phone | in `apps/mobile`: `node_modules\.bin\tsc.cmd --noEmit`, `node_modules\.bin\eslint.cmd src index.ts`, `node_modules\.bin\jest.cmd <your test paths>` then the full suite |

The orchestrator runs the full root gates afterwards. Live two-device acceptance needs a signed-in
browser and a physical phone and stays out of scope; say "not live-tested" rather than implying it.

## 8. File ownership

| Workstream | Owns |
| --- | --- |
| Session | `packages/connect/**` |
| Convex | `convex/**` (not `_generated`), `docs/connect-contract.md` |
| API | `apps/api/**`, `packages/shared/library*`, `docs/api-contract.md`, `mocks/**`, `tests/contract/**` |
| Phone library | `apps/mobile/src/services/sync/**`, `apps/mobile/src/database/syncQueries*`, the Settings sync row |
| Web | `apps/web/**` |
| Phone Connect | `apps/mobile/src/services/connect/**`, `apps/mobile/src/components/connect/**`, the player-store hook for remote routing |
| Integration and docs | `tests/convex/**`, `.planning/connect-and-sync/{HANDOFF.md,DECISIONS.tsv,PLAN.md,IMPROVEMENT-PLAN.md}`, `docs/architecture.md`, `docs/workflows.md` |

## 9. The audit, for reference

Defects (2026-10-01, against the working tree):

1. Web sends every song click to the last active device even when it is offline.
2. A device is missing from other pickers for its first 60 s (`register` did not touch Presence).
3. Two tabs of one browser are the same device; the single-tab rule was never built.
4. Web reload publishes an empty snapshot first, restore is marked done on it, and the next player
   event reports the empty player over the stored queue and position.
5. `claimLocal` has no in-flight guard: one claim per 250 ms position tick, queued offline.
6. Android: the old owner re-claims when a position tick lands before Media3 confirms its pause.
7. The web remote view has no tick, so scrubber and lyrics move only on snapshots.
8. `reportKey` has no position, so a seek on the playing phone is not reported for up to 30 s.
9. `canPlay: false` (Listen Together) blocks transfers only, not ordinary commands.
10. Phone song picks play locally while another device is active.
11. A library op stamped by a slow clock loses silently and no revision moves.

Missing: the "Sync paused: tap to retry" Settings row. Not asked for: the 5 s recently-played poll.

Still open from IMPROVEMENT-PLAN: C1 (play then pause leaves music playing), C2 (a command ran
1 min 54 s after the sender gave up), C3, C4, C5 (±120 s skew), C6, C7, C8, C9, C10.

Standards: contract doc index names do not match the schema and it says "install or browser tab";
`playerState` mixes hot position with the queue and ownership; one-argument `ctx.db` call forms;
the 1 s remote timer runs in the background and re-renders every consumer; missing `returns`
validators in `library.ts`; duplicated transports; a too-forgiving `MemoryTransport`;
`pendingFor`, `MutationResult.accepted`, `issuedBy`; `userDeviceId`; string-compared failure
codes; two snapshot validators that disagree.

Database: no rate limit on `claim` / `report` / `register` / `heartbeat`; `rebuildProfileCopy`
re-reads up to 12,300 rows per change; `devices` reads the hot `playerState` document; `send` does
not check the target.
