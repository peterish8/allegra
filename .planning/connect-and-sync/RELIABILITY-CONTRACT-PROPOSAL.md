# Connect reliability contract proposal

Status: owner approved V2 and confirmed-pause transfers on 2026-10-01. No wire changes
are implemented by this proposal. P4/P5 remain later dependency-gated slices.
Prepared against `feat/connect-and-sync` at `5abdde0`, including the existing uncommitted
single-flight report repair. This supplements P0/P1/P4/P5 of IMPROVEMENT-PLAN.md.

## P1: versioned, fenced commands

- Add optional `protocolVersion: 2` to device registration and returned device metadata.
  Missing means legacy. Keep all existing public function signatures and legacy command
  decoding supported; no table deletion or required-field migration.
- Add `ownershipEpoch` to player state, defaulting missing historical values to zero.
  Every successful claim, including legacy claims, increments it transactionally.
- Add `sendV2({fromDeviceId,targetDeviceId,requestId,expectedOwnershipEpoch,kind,args?})`
  and `transferV2({fromDeviceId,toDeviceId,requestId,expectedOwnershipEpoch})`.
  Return `{commandId,serverNow,executeBefore,ownershipEpoch}`. Request IDs identify a
  logical action, persist across uncertain retries, and are bounded strings. Deduplicate
  by indexed account/source/request before consuming the unchanged 20/10-second quota.
  A repeated ID with different arguments fails instead of aliasing another action.
- V2 rows add optional `requestId`, `executeBefore`, `expectedOwnershipEpoch`, execution
  reservation metadata and stable failure code. Preserve statuses `pending/done/failed`.
  Ordinary sends require the current active target and matching epoch. Backend chooses
  deadlines: proposed initial safety budgets 15 seconds for simple controls and 60 seconds
  for song loading/transfer; these are development defaults, not measured latency targets.
  Retain terminal dedupe records for ten minutes; retention and execution expiry differ.
- Add `beginV2({deviceId,commandId,expectedOwnershipEpoch})`. It authenticates account,
  target, deadline and epoch transactionally and returns a reservation token plus server
  time. It never authorizes a second independent executor for the same command. Repeated
  delivery in one process reuses its reservation without reapplying native actions.
  Process-crash ambiguity for next/previous/queue-add is surfaced; it is not retried as a
  new native action. Expiry/supersession records `failed` with stable codes.
- Sender retains up to 32 unsent intents, ordered, with coalescing only for adjacent unsent
  seek/volume of the same target/epoch. Overflow is visible. One unresolved transmission
  per sender; feedback after four seconds means outcome unknown, never cancellation.
  Late responses keep result correlation but cannot revive stale optimistic UI.
- New clients require V2 capability for commands requiring execution fencing. A legacy
  destination gets a clear update-required error; do not silently downgrade safety.
  Legacy-to-legacy operation and the installed APK's existing endpoints remain supported.

## Transfer behavior requiring product agreement

Prepare the destination paused under a fenced transfer reservation. Keep the old owner until
preparation succeeds. Request old-owner pause and wait for confirmation when reachable, then
atomically finalize the new ownership epoch and activate the destination. Failed preparation
does not replace the usable owner. Without old-owner confirmation, leave the transfer pending
and fail at its deadline rather than automatically starting both devices. This deliberately
does not promise transfer from an unreachable owner; an explicit lease/self-pause policy can
be added separately if offline takeover is required. A later manual local play remains an
explicit claim, with the existing eventual convergence limitation documented.

## P4: atomic result plus observed state

Proposed `completeV2({deviceId,commandId,reservationToken,expectedOwnershipEpoch,rev,
outcome,patch?})`, with outcome success or failed/stable code. Validate before transactionally
merging a nonempty partial patch and finalizing the result. `song:null` explicitly removes a
track; omission preserves it. Claims/transfers retain full snapshots. A duplicate completion
returns the recorded result with no extra revision. A revision conflict returns an explicit
conflict and does not finalize success; retry completion after rebase without replaying audio.
Failed outcomes cannot carry a success patch. Serialize completion with the report writer.
Volume-only changes preserve/advance the old position anchor coherently.

Legacy `report` and `ack` remain usable. New clients only use atomic completion after both
backend and receiver capability support it. No HTTP library shape change is proposed.

## P5: evidence gate

Do not add ownership/queue tables now. Measure client deliveries and serialized application
payload estimates separately from backend query executions/reads. Only propose a split once
the comparable baseline demonstrates material invalidation/byte cost. Lean sender outcomes
and any split subscription assembly need additive versioned functions and reordered-delivery
tests before legacy cutover. Production remains a separate authorized rollout.

## Approval and acceptance

Owner approved the V2 capability gate, conservative offline-transfer behavior and
versioned P1 signatures above. Server budgets must be revisited after physical measurements;
development deterministic tests can prove ordering, expiry, dedupe, isolation and recovery.
Physical Android audible/native timing, background availability and battery cost remain
unmeasured. Do not mark P0's physical baseline or P9 acceptance complete without that evidence.
