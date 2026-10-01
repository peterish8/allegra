# Connect and account sync: reliability and performance implementation plan

Written: 2026-10-01. Review evidence: 2026-09-30. Status: **P0 local implementation in progress; V2 command policy approved**.

This is the implementation follow-up to the architecture review of the existing Connect and
cross-device account sync feature. It supplements [PLAN.md](./PLAN.md), rather than marking its
completed tasks incomplete. [HANDOFF.md](./HANDOFF.md) records the existing deployment and evidence.

## Goal and direction

Retain the existing architecture: one account identity, shared Connect orchestration, real web and
mobile playback adapters, direct authenticated Convex commands, local audio, and durable SQLite
library operations through the existing HTTP contract. Deepen these modules so ordering, recovery,
timing and batching have locality behind narrow interfaces.

Improve three separate outcomes:

1. **Correctness:** final user intent survives rapid input; expired commands cannot unexpectedly run;
   ownership changes cannot authorize stale playback or reports.
2. **Latency:** selected audio starts without waiting for future queue resolution, and command
   confirmation avoids an unnecessary sequential mutation.
3. **Resource use:** fewer redundant writes, smaller payloads, narrower query invalidations, bounded
   catalog work, and no background rendering timers without a visible consumer.

Do not replace Convex, add faster polling, shorten library debounce to accelerate Connect, or split
`connectSession.ts` solely because it is long. The two playback adapters justify the seam; the shared
module already has useful depth. Do not send audio between devices or change stream/range behavior.

## Evidence and verification limits

Findings below are static source observations, not device benchmarks. Line numbers refer to the
reviewed checkout and can drift; named functions are the durable navigation anchors.

| ID | Problem and source evidence | Proposed solution | Strength |
| --- | --- | --- | --- |
| C1 | `sendRemote` returns while `pending` exists; `processInbox` launches actions concurrently (`packages/connect/src/connectSession.ts`, approximately 230 and 510). | Ordered discrete commands, bounded latest-intent coalescing, and serial receiver execution. | Strong |
| C2 | `onPendingTimeout` clears local state, while backend commands remain pending until retention cleanup (`connectSession.ts:640`; `convex/connect.ts` send/ack/sweep). | Separate executable deadlines from retention; validate account, target, ownership generation and expiry. | Strong |
| C3 | `applyIncoming` awaits `reportLocal` and then `ack`; report failures are swallowed (`connectSession.ts:269`, `442`). | Atomic successful state/result completion, with explicit conflict recovery. | Strong |
| C4 | Web `PlayerPort.load` waits for up to 49 future catalog lookups before audio starts (`apps/web/src/hooks/useConnect.ts:325`); mobile also awaits `matchQueue` in `mobilePlayerPort.load`. | Selected-song readiness first; bounded incremental queue hydration on both platforms. | Strong |
| C5 | Adapter snapshot publication invents `serverNow = Date.now()`; `onTransportSnapshot` resets offset from it (web `useConnect.ts:126`, mobile `convexTransport.ts:132`, session `:191`). | Mutation-derived clock samples owned by the shared module; monotonic local extrapolation. | Strong |
| C6 | Reports spread full `local`, lack an in-flight guard, and stringify queue refs per player event (`connectSession.ts:442`, `477`, `729`). | Dirty field patches, one writer, trailing latest state and revision reconciliation. | Strong |
| C7 | `devices` reads the changing player-state document; `commandsFor` repeats outgoing command args (`convex/connect.ts:277`, `373`). | Measure invalidations; separate low-change ownership metadata and lean outcome delivery where justified. | Strong for measurement; schema split conditional |
| C8 | Web/mobile transport subscription and decoding policy is duplicated, with differing cached startup behavior. | One shared wire-policy module behind platform construction adapters. | Worth exploring |
| C9 | Paused active background devices remain subscribed; mobile remote progress timer lacks foreground gating (`shouldListen`; `ConnectProvider.tsx:149`). | Explicit availability policy; gate rendering clocks independently of control subscriptions. | Strong for rendering; availability change conditional |
| C10 | Any nonempty library pull refreshes all playlists, songs and online likes (`LibrarySync.ts:342`, `464`). | Track applied change categories/IDs; refresh only affected local views after SQLite commit. | Worth exploring |

Existing handoff gates are historical evidence. Signed-in web plus physical Android controls,
transfers, background behavior and timing still need live acceptance. No millisecond or financial
savings are established yet.

## Invariants and contract process

- Convex Auth derives account identity on every public function. Never accept a caller-supplied
  `userId`, reassign another account's device ID, or weaken target ownership checks.
- Keep provider-qualified song references, seconds for positions, milliseconds for timestamps,
  queue cap 50, existing account quota 20 commands per fixed 10-second window, and idempotent results.
- Retain the web's single audio element and `requestPlayback` funnel. Seek resumes only if previously
  playing. Android Media3 owns native playback state; do not force the iOS optimistic-state policy
  onto Android.
- Failed/not-found/autoplay-blocked application never acknowledges success or steals ownership.
- Likes, library membership and downloads stay separate. Library optimization cannot delete media,
  lose outbox work, resurrect tombstones, or change first-sign-in merge/replacement semantics.
- Propose wire changes here first; before implementation update `docs/connect-contract.md`, announce
  the change in the implementation handoff, and adapt Convex, both clients and the memory adapter
  together. Change `docs/api-contract.md` only if the HTTP library shape must actually change.
- Read `convex/_generated/ai/guidelines.md` before Convex edits. Use strict validators, indexed bounded
  reads and transactional mutations. Queries must not depend on `Date.now()` to filter expiry.
- No production deployment or release is authorized by this planning document. Preserve unrelated
  dirty changes, `.mcp.json`, and `mobile allegra.png`.

## Execution order and task state

Every slice is independently reviewable. Finish it, inspect the diff, verify it and record evidence
before starting the next. Checkboxes record verified work only. The approved wire proposal is in
[RELIABILITY-CONTRACT-PROPOSAL.md](./RELIABILITY-CONTRACT-PROPOSAL.md); approval does not mean implemented.

| Slice | Dependency | Deliverable |
| --- | --- | --- |
| P0 | None | Development-only timing/resource baseline and agreed contract proposals |
| P1 | P0 | Retained command intent, serial execution and executable expiry |
| P2 | P0 | Clock ownership and skew-safe position interpolation |
| P3 | P1/P2 for takeover semantics | Selected-song-first playback and safe queue hydration |
| P4 | P1 | Single-flight reporting and atomic completion |
| P5 | P4 baseline comparison | Conditional query/document shaping and lean outcomes |
| P6 | P1–P5 interfaces settled | Shared transport wire policy, if duplication still warrants it |
| P7 | P0 | Rendering-clock lifecycle fixes and explicit background availability policy |
| P8 | P0; independent of Connect wire changes | Change-aware library refresh |
| P9 | All accepted slices | Documentation reconciliation and signed-in two-device acceptance |

### P0 — Establish baseline and write the contract proposal

- [x] Record branch/dirty state and the configured development Convex target before mutations.
  Recorded 2026-10-01: branch `feat/connect-and-sync`, HEAD `5abdde0`; dev target
  `dev:charming-jaguar-140` (cosmicgenius01/luvlyricsweb). Existing dirty report/session tests,
  APK workflow and planning edits are preserved, as are untracked `.mcp.json`,
  `mobile allegra.png`, Android crash logs and this plan. No backend mutations in P0.
- [x] Add opt-in development trace hooks around session control/send, receiver execution, report,
  completion and adapter readiness. Use command/request IDs for correlation, not titles, account
  emails, tokens or raw library payloads. Keep production telemetry deferred under HANDOFF's mobile
  consent requirement.
  Source/behavior evidence and outstanding physical measurements: [P0-BASELINE.md](./P0-BASELINE.md).
- [ ] Measure sender input-to-confirmation on the sender's monotonic clock. Measure receiver delivery
  to playback intent/native confirmation locally. Cross-device absolute timestamps require calibrated
  clock uncertainty; do not subtract two arbitrary wall clocks to claim audible latency.
- [ ] Count application mutation calls, query deliveries, payload bytes, catalog requests, maximum
  lookup concurrency, report conflicts, and renderer timer activity. Distinguish application calls
  from Presence internals and actual billed usage. Query executions/read counts need backend evidence;
  client callback counts alone do not prove rerun counts.
- [ ] Capture p50/p95 for warm controls and cold/warm transfers separately, with sample count,
  network, browser visibility, device state, queue length and cache conditions. Use real Android for
  native/background claims; synthetic transport delays prove behavior only.
- [ ] Finalize the proposals in P1/P4/P5 with explicit old-client rollout behavior. Do not promise an
  arbitrary ms target before the baseline. Regression criterion: correctness unchanged/improved and
  no material p95 or resource regression under the same scenario.

### P1 — Reliable command scheduling and expiry

**Problem:** a single pending slot drops input; independently launched receiver actions race; local
timeout is mistaken for cancellation; delayed commands can execute after the UI rolls back.

**Files:** `packages/connect/src/{connectSession.ts,types.ts,memoryTransport.ts,testing.ts,
connectSession.test.ts}`, `convex/{schema.ts,connect.ts,connect.test.ts}`, both Convex transport adapters,
and `docs/connect-contract.md`.

**Implementation:**

1. Replace the `if (pending) return` behavior with a bounded sender scheduler inside the session.
   Keep discrete play/pause/next/prev/queue mutations in input order. Coalesce only unsent seek or
   volume intents to their latest value, keyed by target plus ownership generation. Do not coalesce
   across a discrete command or transfer barrier: `seek → next → seek` has different semantics.
   Start with one transmitted unresolved command per sender; additional queued intent stays local.
   Bound the queue (proposed initial cap 32), surface overflow rather than silently discard actions,
   and retain the server quota. Slider release must eventually deliver its final value.
2. Give each logical send a stable request ID before transmission. Proposed additive command fields:
   `requestId`, `executeBefore`, and `expectedOwnershipEpoch`; add an indexed account/source/request
   lookup for deduplication. The backend chooses and clamps deadlines; clients do not get to extend
   validity arbitrarily. Use separate budgets for basic controls and catalog-loading transfers,
   selected from P0 evidence. A four-second feedback timeout need not be a four-second load budget.
3. Count feedback timeout from input/send start, including enqueue latency. If a send response arrives
   after timeout, preserve its outcome correlation but never resurrect stale optimistic UI. Retry
   an uncertain send with the same request ID, not a new command. Keep dedupe records long enough
   for the documented retry window; after that window surface uncertainty rather than replay.
4. Introduce a server-owned ownership generation incremented on successful claims. Bind ordinary
   commands to the observed active device/generation. Reject stale sends and reports after transfer.
   `take_over` uses explicit transfer semantics, not an ordinary active-target restriction.
5. Drain the receiver inbox through one asynchronous worker, stable by server creation order and ID
   tie-break. Keep executing IDs and completed IDs distinct. Duplicate delivery during an in-flight
   action does not start it again; duplicate completion retries do not reapply it.
6. Check executable deadline and ownership before entering the playback adapter and again before
   committing authoritative results. Use corrected server-time estimate from P2; server mutations
   validate against real server time. Keep a separate bounded retention sweep. Query omission based
   on client time is not a security guarantee, and cleanup every five minutes is not precise expiry.
7. Define cancel/timeout semantics explicitly: timeout means outcome unknown; cancellation before
   execution prevents starting where observed, but cannot undo audio already applied. Record a
   terminal failure/reason on expired or superseded operations. Choose whether to add terminal status
   variants or retain `failed` with stable codes; update validators and UI consistently.
8. Bound takeover races: reserve ownership with a generation/fencing token, prepare the destination
   without playing, confirm old-owner pause where reachable, then activate and finalize. Handle
   preparation failure without leaving an unusable owner. An unreachable old device cannot provide
   synchronous pause proof: require a defined local lease-expiry/self-pause policy or document bounded
   overlap. Do not label eventual active-device convergence as a strict zero-overlap guarantee.

**Tradeoff:** authoritative start/reservation validation may add a takeover round trip. Keep that
cost distinct from ordinary command confirmation optimization. Exactly-once native playback across
process crashes cannot be obtained solely from a database mutation; prefer state-setting commands
and document ambiguous recovery for `next`, `prev` and queue additions.

**Acceptance:** rapid play→pause preserves final pause; slider final value arrives; queue overflow
is visible; inbox actions never overlap; duplicates do not reapply; late send replies do not restore
optimism; expired commands never begin playback on reconnect; another account cannot inspect or
complete them; transfer invalidates queued old-generation actions; quota is not raised.

### P2 — Correct clock ownership

**Problem:** web and mobile publish client wall time as server time, wiping out the clock offset.
The current arrival-time offset also includes unaccounted one-way network delay.

**Files:** `packages/connect/src/{clock.ts,types.ts,connectSession.ts,memoryTransport.ts,testing.ts}`,
web `useConnect.ts`, mobile `convexTransport.ts`, and their interface tests.

**Implementation:**

1. Remove fabricated `serverNow` from reactive snapshot publication. Make timing samples distinct
   from playback snapshots (or explicitly optional during compatibility); mutations supply genuine
   `serverNow`. A reactive notification without a sample must leave the estimate unchanged.
2. Capture local wall-clock send/receive times and monotonic elapsed duration around each sampled
   mutation. Estimate server offset against the local request midpoint; prefer low-RTT samples and
   reject/reinitialize estimates after wall-clock discontinuities. Midpoint estimation has network
   asymmetry uncertainty; it is not exact synchronization.
3. Extend the injectable clock only as needed with a monotonic elapsed-time source; adapt web,
   mobile and fake clocks together. Anchor remote position once against corrected server time and
   advance by monotonic elapsed time. Clamp to zero/duration; freeze paused states.
4. Re-anchor on seek, track/ownership change and meaningful state revisions. Recalibrate on reconnect
   or foreground without increasing heartbeat frequency. Keep interpolation local and never emit
   per-second position network writes.

**Acceptance:** clients skewed ±120 seconds agree within the estimated timing uncertainty; reactive
updates do not reset the offset; delayed responses, wall-clock jumps, pause and seek produce bounded
positions; takeover uses the corrected anchor. Use deterministic fake clocks for these properties.

### P3 — Selected-song-first playback readiness

**Problem:** future queue catalog work is on the selected-song critical path, causing unnecessary
delay and bursts of provider calls. The mobile `matchQueue` path must be reviewed alongside web.

**Files:** web `apps/web/src/hooks/useConnect.ts` and its actual player load/queue owner; mobile
`apps/mobile/src/services/connect/{mobilePlayerPort.ts,songMatcher.ts,songMatcher.test.ts}` and
`apps/mobile/src/contexts/PlayerContext.tsx`; shared `PlayerPort` types if required.

**Implementation:**

1. Resolve the selected provider-qualified song first, preferring a usable local mobile download
   when matched. Deduplicate/cache successful lookups by provider-qualified reference. Authenticated
   provider access remains behind the existing HTTP module; no provider secrets enter clients.
2. Load/seek/start the selected song through the existing playback funnel. Confirm actual adapter
   readiness and autoplay outcome; queue hydration completion is not a condition for selected-song
   success. Abort/timeout outbound lookups using existing provider policy.
3. Retain the original ordered queue snapshot independently of resolved playable rows. Hydrate the
   immediate next item first, then future items with a small bounded worker pool (proposed initial
   concurrency 2; tune from P0). Deduplicate in-flight resolutions and cancel stale hydration on a
   new track, queue edit, transfer, account switch or disposal using a load-generation token.
4. Keep unresolved entries in the authoritative queue. Do not publish the temporary resolved subset
   as a queue deletion. Preserve queue order and cap; define skip/error behavior for truly unavailable
   entries without waiting forever. `next` at an unresolved entry awaits only that item's bounded
   readiness, and auto-next requests the same queue resolver.
5. Keep shuffle/repeat, original order, native prefetch and queue mutations consistent during
   hydration. If the existing player cannot retain unresolved queue refs, first deepen its queue
   implementation behind the existing interface rather than inventing a competing Connect queue.

**Acceptance:** a deliberately slow/unavailable later item cannot block selected audio; queue order
and remote snapshots retain all intended entries; no more than configured concurrency runs; stale
results cannot overwrite a new queue; next/auto-next/shuffle/repeat work; local downloads still play;
autoplay failure remains a failure; both-direction transfers retain position and settings.

### P4 — Single-flight reporting and atomic command completion

**Problem:** full snapshots repeat unchanged queue data, overlapping writes share stale revisions,
and successful application requires sequential report then acknowledgement.

**Implementation A: report writer**

- Change `PlayerStatePatch` from the current full `PlayerSnapshot` alias to a validated nonempty
  partial representation. Specify explicit track removal semantics (for example `song: null` in
  the wire patch), since omitted `song` must mean unchanged, not cleared. Retain full snapshots for
  claims and transfers. Update the memory transport to merge patches, not replace all state.
- Own last confirmed snapshot, latest local snapshot, dirty categories, in-flight report and accepted
  revision inside the session. Allow one write at a time and at most one trailing latest report.
  Merge new changes during the await; do not clear changes which happened after the sent snapshot.
- On revision conflict, refresh/rebase only while this device still owns the same generation. Lose
  ownership → stop report retries and obey the active-device transition. Retrying cannot reclaim
  playback implicitly. Account/disposal cancels future work.
- Send queue/song only on changes. Maintain a queue change token/fingerprint at queue mutations,
  instead of JSON-stringifying the full queue on every progress event.
- Preserve the 30-second drift cadence. Immediate track, pause/play and seek changes must report
  promptly, including native/media-session changes outside Connect control callbacks.
- Position patches carry a coherent position/play-state anchor. If a volume-only patch keeps the
  old `positionSec`, the backend must not reset `positionAt` as if that old position were current.
  Either preserve the anchor or transactionally advance it before re-anchoring. Test both pauses
  and volume changes to prevent backward progress jumps.

**Implementation B: completion proposal**

- Add a proposed `complete` mutation to `convex/connect.ts` and shared transport: command ID, target
  device, execution generation, outcome, optional playback patch and expected revision. Final names
  and validators belong in the updated contract before implementation.
- Within one transaction authenticate, verify device/command account and target, reject expired or
  stale-generation execution, validate patch, update owned player state and mark outcome terminal.
  Duplicate calls return the recorded result without incrementing revision again.
- Failed adapter application marks failure without applying a success patch. A revision conflict
  must not mark success while discarding the observed state: return explicit conflict and reconcile
  without reapplying the native command. Distinguish executed-but-unconfirmed from rejected-before-
  execution. Serialize the local report writer with completion so its own writes do not race it.
- Handle `take_over` finalization under P1's reserved generation; ordinary completion cannot silently
  claim ownership. Keep completion retry state separately from playback execution state.
- Successful ordinary control becomes send → reactive delivery → adapter action → complete → reactive
  result. This removes one sequential client mutation from confirmation compared with report+ack;
  a separate execution reservation, if chosen, changes that arithmetic and must be measured.

**Files/tests:** shared session/types/memory transport, `convex/connect.ts` and `connect.test.ts`,
`convex/schema.ts` where outcome/generation fields are needed, both wire adapters, contract.
Delayed report tests must prove trailing pause/volume/seek all survive; completion retries must prove
no re-execution, no duplicate revision increment, cross-account denial and honest failure outcomes.

### P5 — Reduce reactive replication and query fanout

**Problem:** changing player state invalidates the device listing that reads it; recent outgoing
commands repeatedly carry large args. Projection alone does not narrow document dependencies.

**Implementation, conditional on P0/P4 evidence:**

1. Measure `devices`, `state` and command-query execution/read/payload behavior before changing their
   shape. Preserve narrow queries; merging all watches into one may broaden invalidations.
2. If justified, add a small account ownership document (proposed `connectOwnership`: account,
   active device and epoch; indexed by account). `devices` reads it and Presence/registration only,
   not the hot playback document. Claims/finalization update ownership and playback atomically.
3. If queue bytes remain material, split queue metadata into a revisioned account queue document.
   Hot playback stores the queue revision/reference; transport assembles only matching revisions,
   tolerating differently arriving query updates. This complexity is conditional, not required merely
   to send partial patches. Do not move frequent playback fields into `profiles`.
4. Separate receiver inbox payloads from sender outcomes. Outcome rows need ID/request ID, status,
   reason and relevant generation, not full completed `play_song`/`take_over` args. Keep pending inbox
   payloads, deduplication, bounded indexed reads, reconnection reconciliation and retention.
5. Legacy data/index migration is additive: optional new fields first, bounded backfill, dual-read
   compatibility, then cutover. Define a gate/minimum supported Android version for changed command
   semantics. Old installed APKs cannot be assumed updated atomically with web and Convex.

**Acceptance:** unchanged presence/device lists do not repeatedly deliver due solely to position
reports after the ownership split; outcomes contain no unnecessary queue payload; coherent queue
versions survive reordered subscription callbacks; account isolation and bounded queries persist.

### P6 — Shared Convex transport wire policy

**Problem:** duplicated subscriptions, decoding and cached-startup policy have diverged.

**Files:** web `useConnect.ts` transport class; mobile `services/connect/convexTransport.ts`; shared
Connect exports/types and new shared wire-policy tests.

**Implementation:** extract subscription lifecycle, payload validation/decoding, initial cached result
handling, result assembly and mutation timing capture into one deep module. Keep construction of the
Convex client, generated function references, auth and platform lifecycle outside it. Mobile rules
prohibit npm imports in `packages/`; inject a narrow client binding rather than importing Convex/React
from the root into shared mobile code. Do not create many shallow delegate modules.

Exercise the same transport interface tests through web/mobile bindings: cached startup, malformed
payload rejection, partial watch arrival, auth loss, reconnect, duplicate notification and disposal.
Delete the duplicated implementation only after parity is demonstrated. Leverage comes from one
tested wire policy; player adapters continue to own platform behavior.

### P7 — Resource-aware lifecycle without losing remote availability

**Problem:** background rendering clocks spend work without a visible consumer; active-paused
subscription behavior differs from idle-offline planning language.

**Files:** `shouldListen`/listening reconciliation in the session, web `useConnect.ts`, mobile
`ConnectProvider.tsx` and remote-player/lyrics consumers.

**Implementation:** gate progress-view timers on visible foreground consumers and remote playing
state; recompute the current anchored position immediately on foreground. Stop timers on pause,
unmount, account change and disposal. Keep this independent from the command transport lifetime.

Document an explicit background policy: active playback retains subscriptions/heartbeats; active
paused devices retain remote resume availability by default until a deliberate bounded idle policy
is approved. If adding idle expiry, publish unavailable state honestly, drop ownership safely and
prove foreground recovery. Do not silently turn a remotely resumable phone offline. OS-killed app
wake remains the v2 push feature, not a promise of these timers. Keep 60-second Presence heartbeats.

**Acceptance:** no remote UI tick timer in background; visible lyrics/progress recover without a jump
from stale UI state; background playback still receives controls; idle availability matches docs;
no duplicate subscriptions/timers after repeated foregrounding. Profile on real Android.

### P8 — Change-aware account-library refresh

**Problem:** nonempty inbound sync refreshes broad local stores even for a small change.

**Files:** `apps/mobile/src/services/sync/LibrarySync.ts`, `apps/mobile/src/database/{syncQueries.ts,
syncQueries.test.ts}`, existing store refresh consumers, shared library change types if needed.

**Implementation:**

1. Have the SQLite application path return a local change summary: liked refs, affected playlist
   IDs, metadata changes and song-record changes. Compute it from actual committed changes, not
   simply nonempty server arrays. No HTTP shape change is needed for this local summary.
2. Commit rows/tombstones and revision cursor atomically before refreshing views. Emit no-op summary
   on replayed/unchanged rows. Refresh only affected stores/playlists; schedule one trailing refresh
   for concurrent revision notifications and foreground reconciliation.
3. Preserve durable outbox batches of at most 100, implemented 1.5-second flush debounce, retry/backoff
   and conflict rules. Separate pull single-flight state from flush state; a notification during a
   pull schedules another check rather than being lost. Account switches invalidate old callbacks
   and cannot apply one listener's rows to another's UI.
4. On refresh failure keep database/cursor truth and a retryable dirty-view marker; do not resend
   already-acknowledged writes or replay downloads. Keep recent plays/taste publication separate
   from liked/playlist refreshing and retain the five-heard-seconds rule.

**Acceptance:** a like change does not reload unrelated playlists; an item tombstone updates the
affected playlist; unchanged pulls do not refresh stores; offline writes and replacement choices
still pass existing real SQLite tests; downloads remain untouched; reconnect converges once.

### P9 — Reconcile planning and complete acceptance

- [ ] Update PLAN's stale device-heartbeat table flow to Presence-owned online status; distinguish
  registration retention markers from heartbeat writes and 150-second presence expiry.
- [ ] Correct ack/report order, autoplay failure semantics, background idle policy, and 1.5-second
  library debounce. Distinguish command execution deadline from two-minute retention/periodic sweep.
- [ ] Replace claims that connected idle listeners cost nothing with measured heartbeat/read/write
  and rendering budgets. Revalidate hosting-platform claims from current official documentation;
  do not use old socket-capability claims to justify a migration.
- [ ] Ensure `docs/connect-contract.md` index names match schema rather than abbreviated historic
  names; record new fields/functions and compatibility state only when implemented.
- [ ] Update HANDOFF/DECISIONS after each accepted slice with actual commands/results, baseline
  comparison and remaining limits. No proposed task becomes complete from documentation alone.

## Verification and rollout checklist

Behavior tests are the interface surface, not assertions mirroring private helper structure.

- Shared session: fake clocks/transports for skew, delayed writes, dropped replies, expiry, ordering,
  coalescing, lease changes, account/disposal cleanup and idempotent completion.
- Convex: use existing `convex-test` tests for real transaction behavior, authenticated account
  isolation, validators, indexes, quota, stale revisions and retry idempotence. Update the memory
  adapter to preserve parity, rather than trusting its previous full-snapshot behavior.
- Playback adapters: selected audio versus slow future queue; genuine autoplay/native outcome;
  unavailable local/catalog matching; cancellation, next/auto-next and stable queue refs.
- Library: existing real SQLite tests plus minimal-update refresh/replay/offline/account-switch
  properties. Mocking SQLite writes is insufficient for cursor/tombstone atomicity claims.

Before claiming source implementation complete, run from the root using Windows `npm.cmd`/`npx.cmd`
if PowerShell shims interfere:

```text
npm run typecheck
npm run lint
npm test
npm run mobile:check
npx tsc --noEmit -p convex
npm run build
npm run e2e
```

Run the contract smoke check against the running local API where an HTTP seam changed. Check
health/ports before starting servers. Visible web changes get browser checks on :5173 at the repo's
required sizes; native behavior gets physical Android evidence. Do not install dependencies or
restart running servers merely for planning edits.

Live signed-in matrix: web→Android and Android→web; play/pause/seek/next/volume; rapid conflicting
controls; queue 0/1/50; warm/cold selected songs; available/unavailable later songs; transfer playing
and paused; autoplay blocked; reconnect after deadline; ownership changes with queued commands;
foreground/background; offline library replay; account switch. Record p50/p95, sample size and
resource deltas for identical baseline/final scenarios. Separate audible/native readiness from
confirmation and from first stream bytes.

Rollout: additive schema/compatible development backend → deterministic tests → updated web/mobile
development clients → live matrix → explicit release decision. Never remove compatibility while
supported Android APKs still call legacy functions. Production rollbacks must remain possible with
additive fields/functions and documented client version gates; do not delete user library data.

## Expected benefit, without invented measurements

| Change | Expected mechanism | Claim requiring measurement |
| --- | --- | --- |
| Selected-song-first readiness | Future lookups leave the audio-start critical path. | Actual transfer/song-start ms reduction |
| Atomic completion | One fewer sequential mutation for ordinary command confirmation. | Approximately one receiver round trip, if no added reservation step |
| Single-flight partial reports | Fewer duplicate/conflicting writes and smaller payloads. | Mutation/byte/query reduction under actual controls |
| Clock ownership | Skew-correct interpolation and transfer anchoring. | Cross-device position error and timing uncertainty |
| Scoped UI clocks/library refresh | Fewer background timer callbacks and unrelated store refreshes. | Android battery/CPU and render/SQLite reductions |

Nominal application baseline: 60 heartbeat calls/hour per continuously connected device and about
120 scheduled drift reports/hour while continuously active and playing, plus immediate changes,
commands, subscription work, Presence internals and reconnects. These counts are not a bill estimate.

References for implementation verification: [Convex realtime dependencies](https://docs.convex.dev/realtime)
and [Convex query scaling](https://stack.convex.dev/queries-that-scale). Use installed-version docs
and generated guidelines for code details.

