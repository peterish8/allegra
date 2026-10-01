# P0 baseline — 2026-10-01

Base: `5abdde0`, branch `feat/connect-and-sync`. Current slice adds local tracing
through the shared session and both real adapters, and preserves the existing
single-flight report fix. It does not implement approved V2 endpoints or transfers.

## Diagnostic scope

Web tracing requires development mode and `?connectTrace=1`; mobile requires
`EXPO_PUBLIC_CONNECT_TRACE=1` in a development build. `allegraConnectTrace` is a
bounded local buffer. Events whitelist timing/count/size/outcome fields and opaque
correlation IDs, never song/account payloads. Session/account disposal clears it.
No persisted trace, upload or production telemetry is added. Disabled tracing
skips trace mutation/input work. See `docs/workflows.md` for collection commands.

Instrumentation covers input, mutation lifecycle, query deliveries, receiver
execution, acknowledgement, report conflicts, player/catalog actions and renderer
timers. Serialization byte estimates are application payload estimates. Callback
counts are not backend query/read counts, Presence internal calls or billing.

## Evidence

- Shared behavior checks cover opt-in/privacy/bounds/disposal, synthetic timing,
  single-flight reports with one trailing latest snapshot, accepted revision
  tracking and bounded stale-revision retry. Focused Connect tests passed 29/29.
- Synthetic sender delays of 10/20/30/40/50 ms produce imposed p50 30 ms and p95
  50 ms. These are test fixtures, not observed network or audible latency.
- Root typecheck, lint and tests passed; mobile checks passed 68 suites/534 tests;
  Convex typecheck passed. Final presentation changes receive another typecheck,
  lint, production build and E2E run before commit.
- In-app browser inspected expanded cover and lyrics at widths 360, 768, 1280
  and 1920. Desktop picker anchors to the right and extends left; narrow viewports
  show a bottom half-height sheet. Standard computed backdrop blur/saturation,
  aligned rows, focus trapping, Escape and outside dismissal were checked.
- Remote owner gives the right Connect control green color/glow; local owner
  gives a neutral control. No indicator or device text remains beside the song.
  Browser header still showed Guest, so this is UI/state evidence, not verified
  Google profile or signed-in web-to-Android acceptance.
- Native Stream header sheet shares device actions with the player sheet. Source
  gates cover it; no physical inspection or Android accessibility proof exists.

## Open baseline

No attached Android device was available. Warm-control and cold/warm-transfer
sample sets, real p50/p95, native confirmation/background availability, battery,
backend query/read measurements and APK update-install evidence remain open.
No performance improvement is claimed. P0 and the entire improvement plan remain
incomplete. External audit findings are tracked in `AUDIT-TRIAGE.md`.
