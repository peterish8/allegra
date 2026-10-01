# External audit triage — 2026-10-01

Reviewed the owner-supplied audit against the current dirty checkout on
`feat/connect-and-sync`, based on `5abdde0`. This is source inspection, not a
rerun of the external scratchpad or physical cross-device acceptance. The Luna
reviewer completed a read-only source review; it ran no tests. Its earlier
usage-limited implementation turn is not review evidence.

## Findings to carry into implementation

| Audit item | Current evidence | Next verification |
| --- | --- | --- |
| 1. Offline remote owner | `App.tsx` and `useConnect.playRemote` route to a foreign active ID without an online check. | Test the offline-owner selection path. Preserve confirmed-pause policy: unreachable ownership must produce a clear failure, not an automatic second audio source. |
| 2. Initial Presence | `convex/connect.register` writes metadata only; session heartbeat first runs at the 60-second interval. | Regression using actual Presence semantics; registration should establish immediate availability. |
| 3. Shared browser identity | `connectDeviceId.ts` shares localStorage identity across tabs; no web BroadcastChannel leader exists. | Two normal tabs, without the distinct-device harness, must prove one receiver/audio owner. Duplicate-audio outcome remains unobserved. |
| 4. Startup restore | Web transport publishes an empty initial snapshot; shared session consumes `didRestore` before hydrated state arrives. | Cold-query regression including a local settings change before hydration. Exact queue-erasure sequence is not reproduced here. |
| 5–6. Claims and ownership loss | `onPlayerChange` claims on each playing/non-active callback; `claimLocal` has no single-flight guard. Ownership loss starts asynchronous pause. | Delayed claim/pause regressions; implement with ownership fencing. Exact counts and final two-device outcome remain unverified. |
| 7. Web progress | Web reads the last notified live position and has no remote renderer timer; mobile has a one-second timer. | Controlled-clock web progress/lyrics test, including visibility cleanup. |
| 8. Local seek reporting | `reportKey` excludes position; ordinary ticks report drift only after 30 seconds. | Playing and paused seek regressions; distinguish deliberate seek from normal progress. |
| 9. Room isolation | Transfers check `canPlay`; ordinary send/receiver paths do not enforce that guard. | Reject controls while Listen Together owns playback, at backend and receiver seams. |
| 10. Mobile selections | Stream and browse selections enter `StreamService` and the local player queue directly. | Catalog and YouTube selection tests with a foreign active owner; preserve provider refs and playback funnels. |
| 11. Stale library changes | Shared library logic silently skips older timestamps, without a rejected entry or revision change. | Reproduce stale-op outcomes and define explicit feedback. Skew normalization is not approved by the V2 playback policy and must not make old offline edits overwrite newer changes. |

## Cost and standards boundaries

- Remote recent history polls immediately and every five seconds while playing.
  This permits 720 GETs/hour during sustained remote playback; it is not measured
  usage. For non-guest tokens, `resolveCaller` reads the profile before
  `authenticatedUser` reads it again. Guest tokens take a different path.
- `rebuildProfileCopy` caps current rows at 4,000 likes, 300 playlists and 8,000
  items. 12,300 is the maximum query envelope, not a measured read count per write.
  The proposed 2,500 versus 300 Convex calls/hour is not dashboard evidence.
- Web library hydration begins at revision zero. Mobile stores a revision cursor,
  but schedules a pull for each observed revision and does not use successful
  operation replies to suppress its own revision wakeups.
- Contract index names currently differ from `convex/schema.ts`; fix the actual
  contract before approved additive V2 wire implementation.
- Installed Convex supports one-ID database calls for backwards compatibility.
  Table-qualified calls are preferred for new code; existing calls are not by
  themselves runtime defects. Library functions lack return validators.
- Keep legacy `pendingFor` and APK endpoints compatible. Its absence from current
  consumers is not authorization to remove support.
- Mobile maps upcoming queue snapshots before slicing to 50; optimize this bounded
  client work independently. Split ownership/hot state or alter tombstone handling
  only with measurements and preservation of account/offline invariants.

## Order and limitations

Finish the current UI/tracing slice, then add regressions for startup/Presence
and continue P1 ordered delivery, execution, correlation, V2 dedupe/deadlines/
fencing and confirmed-pause transfers. Keep remaining progress, selection and
library findings attached to the corresponding improvement-plan phase.

No signed-in physical Android run, backend read measurements, scratchpad test
artifacts, APK update-install evidence or production acceptance is supplied by
this triage. Existing passing suites do not disprove these uncovered behaviors.
