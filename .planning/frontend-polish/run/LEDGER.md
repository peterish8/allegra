# Run ledger (the orchestrator updates this after every state change)

Statuses: `queued`, `running`, `in-review`, `merged`, `parked-ready` (HOLD, waiting for the owner), `blocked`, `failed`, `dropped`.

**Step 0 checks (2026-11-13):** origin/main `cf662478b3cef6dd11eb5a4c890741ab6f87b3b5`; gh authenticated as peterish8; Node v24.18.0 / npm 11.16.0; adb reports no connected devices; probe AVD configured for Android 36 google_apis_playstore x86_64 (not launched); C: free 19,847,364,608 bytes. Root `npm run typecheck` passed. Root lint and tests running.

**Models resolved:** Initial combined search returned no matches. Owner directed individual-name discovery; verified Codex `gpt-6-luna` with reasoningEffort xhigh, Claude `claude-sonnet-5-5` with effort high, and reviewer Codex `gpt-6.1-sol`. No substitution. Antigravity is now enabled and can be explored for the third council provider when needed. No code cards have started; dispatch awaits Step 0 merge.

**Additional defaults:** Library defaults to grid and remembers the choice. Albums is investigated first; removal is the default, with persisted Albums start tabs normalized to Songs.

**Defaults applied for the plan's open questions:** Q1 keep and fix YtMiniPlayer; Q2 keep orbit loops and DJ notes; Q3 no copy changes; Q4 allow colour/background-colour/border-colour
transitions 100-160 ms on web only; Q5 craft-lite; Q6 owner phone checks batched in `OWNER-TODO.md`; Q7 assume other mobile work exists.

| ID | Model | Merge | Status | Branch | PR | Version | Evidence (paths) | Decisions / not proved |
|---|---|---|---|---|---|---|---|---|
| P1 | Sonnet | AUTO | queued | | | n/a | | |
| W0 | Luna | AUTO | queued | | | n/a | | |
| M0 | Luna | AUTO | queued | | | | | |
| W1 | Luna | AUTO + council | queued | | | n/a | | |
| W7 | Sonnet | AUTO | queued | | | n/a | | |
| M5 | Sonnet | AUTO | queued | | | | | |
| W6 | Sonnet | AUTO | queued | | | n/a | | |
| M12 | Luna | AUTO/HOLD | queued | | | | | |
| W2 | Luna | AUTO | queued | | | n/a | | |
| W3 | Sonnet | AUTO | queued | | | n/a | | |
| M1 | Luna | AUTO + council | queued | | | | | |
| M8 | Sonnet | AUTO | queued | | | | | |
| W4 | Sonnet | AUTO | queued | | | n/a | | |
| M11 | Sonnet | AUTO | queued | | | | | |
| M7a | Sonnet | AUTO | queued | | | | | |
| M7b | Sonnet | AUTO | queued | | | | | |
| M6 | Sonnet | AUTO | queued | | | | | |
| M2 | Luna | AUTO | queued | | | | | |
| W5 | Sonnet | AUTO | queued | | | n/a | | |
| W11 | Sonnet | AUTO | queued | | | n/a | | |
| M4 | Sonnet | AUTO | queued | | | | | |
| M9 | Sonnet | AUTO | queued | | | | | |
| M3 | Sonnet | AUTO | queued | | | | | |
| M10 | Luna | AUTO | queued | | | | | |
| W8 | Sonnet | AUTO | queued | | | n/a | | |
| P5 | Luna | AUTO | queued | | | | | |
| W9 | Sonnet | HOLD | queued | | | n/a | | |
| P6 | Luna | HOLD | queued | | | n/a | | |
| FINAL | orchestrator | n/a | queued | | | | | |

## Guard baselines (record before and after)

| Guard | Before (P1/W0/M0) | After (FINAL) |
|---|---|---|
| Web raw transition/animation durations | | |
| Web raw cubic-bezier | | |
| Web undefined custom properties | | |
| Web ungated hover-scale rules | | |
| Mobile pressable / slideModal / alert / weight / tracking / color / reduceMotion / layoutAnim | | |
| Mobile motion literals / component colour literals | | |

## Owner questions asked through the question tool

(none yet)
