# LuvLink implementation plan

Status: implementation in progress, adapted from the approved Spotify Jam comparison and enhancement plan. This document is the durable execution entry point; continue from `CHECKLIST.md` and `HANDOFF.md` if context or credits run out.

## Goal

Rename the mobile and web room feature to **LuvLink** and deliver an authenticated first-party room experience with reliable playback sync, a shared attributed queue, contribution/control permissions, listen-on-own-device and one-speaker modes, reliable invites, and bounded Convex usage. Keep Echo/Metrolist as an explicit legacy transport for existing rooms and old links. Do not operate both transports for a room. Audio remains local on each eligible device.

## Product and architecture boundaries

- First-party API/types are canonical in `docs/luvlink-contract.md`, `packages/shared/luvLink.ts`, and `api.luvLink`; mobile must implement that additive contract exactly.
- Convex handles room authority and small event-driven updates, not media or playhead ticks. Progress projects locally from server-clock-calibrated anchors. Separate room, playback, queue, member, and ephemeral presence subscriptions.
- Keep playback leader/epoch authority distinct from guest transport-control permission. In speaker mode only elected output loads/plays audio; controller-only users follow committed anchors without resolving tracks or reporting audio readiness.
- Keep personal output volume local. Queue identity is the entry ID, with attribution. Only the leader advances on natural end; command retries are idempotent.
- Avoid join-triggered reloads, stale async player loads, timeout autoplay, remote-correction echo, unbounded polling, duplicate transports, or unmeasured claims of resource savings.
- Preserve stored Echo keys, protobuf and `lyricflow://together` links. Add the HTTPS `/luvlink/join/<CODE>` path. Do not expose invite codes from room queries; keep new secret invite/session material in memory or secure storage as appropriate.
- Use existing Allegra theme and current native player/Connect ownership boundaries. Preserve unrelated changes in the shared worktree.

## Implementation sequence

1. **Mobile label and legacy reliability:** Move code/modules to LuvLink naming where practical; rename all user-facing affordances/accessibility/settings/toasts; keep explicit Echo legacy mode and old persisted keys/links. Require exact recording evidence; pause on failed readiness; cap stale anchors; send only explicit user seeks; prevent joining a room from reloading current playback; cancel outdated loads before player side effects.
2. **First-party vertical slice:** Build create/join/leave/invite and reactive room/member/queue/playback subscriptions from the canonical contract. Add presence with bounded heartbeat, foreground clock samples, and explicit disconnect. Make account signout/room leave cancel subscriptions and restore solo player state.
3. **Playback and queue:** Calibrate clock, project from monotonic time, handle ready barrier failure truthfully, sequence and leader fencing, sync all authorized controllers, route add/play-next/skip/advance through one authoritative queue/leader. Never autoplay on timeout or independently advance follower queues.
4. **UI and invite path:** LuvLink panel/settings, room modes and member controls, ordered attributed queue and commands, shareable HTTPS preview and app links/cold launch, legacy entry kept identifiable. In controller-only mode do not load media.
5. **Validation and finish:** Focused client/sync/queue tests, root/mobile/native gates as appropriate, browser and device checks when available, truthful checklist/handoff updates. No deployment or push.

## Delivery slices and acceptance

### S0: durable docs and rename
- All visible mobile/web feature naming is LuvLink; history/research references remain clearly historical.
- Old Echo serialized values/protobuf and invite URI keep working.
- Focused tests and typecheck identify only verified failures.

### S1: mobile first-party rooms
- Signed-in user can create, join, share, see members and leave/end. New invite code is shown once and never recovered from room snapshot.
- Realtime subscription lifecycle stops on leave/signout; server presence disconnect is attempted; command failures resolve visibly.

### S2: correct shared playback
- Room anchors are projected on calibrated monotonic clock. Only user intents generate seek/control mutations; remote corrections never bounce.
- Exact recording match uses canonical identity where available plus version/title/duration evidence; duration mismatch rejects local match. Failed or timed-out readiness does not autoplay/report ready.
- Resume fetches fresh clock and authoritative snapshot before applying; no stale cached anchor on resume.
- Listen mode members follow timeline even when control enabled. Speaker mode only elected output loads audio; controls do not make controllers audio-ready.

### S3: shared queue and completion
- Add/reorder/remove are attributed, bounded and revision-checked. Duplicate command retries do not duplicate entries.
- Existing add/play-next UI routes contributions to the room. Only authoritative leader advances once at natural end. Leave restores solo queue/rate without pausing unrelated playback.

### S4: proven UX/reliability
- New HTTPS and app links support warm and cold launches, preserve old links, and show explicit signed-in requirements.
- Physical two-device/background claims are made only after that hardware test; otherwise limitation is recorded.

## Resource efficiency

No per-second room writes. Writes only on meaningful playback commands/track changes, idempotent queue changes, explicit presence cadence and bounded clock calibration. Maintain separate small reactive documents/queries; no room-wide invalidation on presence, no full queue on every playback update, no repeated catalog resolution for stable IDs. Validate no idle polling loops while subscriptions work. This is a target; report actual resource counts only when instrumented and measured.

## Quality pass (2026-10-06)

User requested `/ponytail /unslop /caveman`. Keep implementation minimal while preserving the requested feature and its safety rules. Reuse player, queue, QR and design-system seams. Avoid duplicate audio or queue authority. Remove code only after caller closure proves it is safe. Keep docs plain and useful. Progress updates can be brief. Rendered web checks must use visible Codex IAB only. Never use another browser if IAB is unavailable.

## Ownership and canonical references

- Mobile: `/apps/mobile/` (status in `.planning/luvlink/HANDOFF.md`).
- Backend/web/shared: `/convex/`, `/packages/shared/`, `/apps/web/`, `/docs/luvlink-contract.md`.
- Durable cross-worker record: `.planning/luvlink/CHECKLIST.md` and `HANDOFF.md` (mobile worker/root coordinator updates without overwriting worker-owned status file).
- Historical research: `.planning/listen-together/JAM-ENHANCEMENT-PLAN.md` remains intact and links here.

Completion requires all checklist implementation and verification entries to be truthful, remaining blockers explicit, and no deployment or device success claimed without proof.
