# LuvLink: first-party shared listening

Adds LuvLink rooms on Convex while keeping existing Echo rooms on their legacy transport. Members can join by expiring invite, share a bounded ordered queue, and synchronize playback through versioned anchors, leader epochs, separate readiness/presence state, and an acknowledged speaker handoff. Clients continue to use Allegra's existing local player; Convex stores song snapshots and playback intent, not audio or progress ticks.

The web app gains create/join/room routes, an auth-aware invite flow, queue and speaker controls, autoplay recovery, and opt-in cached group picks using the existing Blend scorer. Account export and erasure include LuvLink data. Recommendation reads remain separate from playback and recheck current consent.

Validation completed: root typecheck and lint passed; the serialized root `npm.cmd test` passed API, web, shared, infra, and Convex suites (Convex 78/78, auth redirect 4/4); web workspace typecheck/lint/tests passed after the playback self-echo guard (127/127 tests); Convex dev deployment completed with `npx.cmd convex dev --once`. The root full test run preceded the final web-only self-echo patch; the affected web workspace gates were rerun afterward.

Rendered UI verification is pending because Codex's in-app browser was unavailable. No claim is made about physical-device behavior or measured cross-device audible drift. The Convex command targeted the configured development deployment only; production was not deployed.
