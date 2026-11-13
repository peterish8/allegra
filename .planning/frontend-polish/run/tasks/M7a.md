# Task card M7a: Mobile Blend screens

| Field | Value |
|---|---|
| Model | Claude Sonnet 5.5, high |
| Branch | `fix/mobile-blend-polish` |
| Merge mode | AUTO (full-send); CI gates green |
| Depends on | M5 merged |
| Size | M |

Read `../WORKER-PROTOCOL.md` first, then this card. The authoritative spec is `../../PLAN-v2.md`; read the whole entry named below before you start.

## Spec
PLAN-v2 §8 Phase 4 "M7" (Blend half). Keep list K11 (Blend orbs and member tones).

## You own
`BlendScreen.tsx`, `BlendsScreen.tsx`, `BlendJoinScreen.tsx` and `apps/mobile/src/components/blend/*`.

## Open these skill files
`C:/Users/nithy/.claude/skills/charles-unslop/SKILL.md` (passes 2, 5, 7), `C:/Users/nithy/.claude/skills/charles-polish/SKILL.md`, `C:/Users/nithy/.agents/skills/building-native-ui/SKILL.md`, `C:/Users/nithy/.claude/skills/expo-react-native-expert/SKILL.md`, `C:/Users/nithy/.agents/skills/micro-interactions/SKILL.md`.

## Do
Font-weight literals to 0; tracking except one documented room-code exception; bare pressables to `Tactile`; `Alert` questions to `ConfirmSheet` or `Sheet`. Change no user-facing strings (the naming question is unanswered).

## Prove
`node_modules/.bin/tsc.cmd --noEmit` in `apps/mobile`, then `npm run mobile:check` from the root (never overlapping `convex:test`), the M0 ratchets falling for the touched files, emulator screenshots at font scale 1.0 and 2.0 (restore the setting afterwards), `expo.version` bumped after your final rebase right before merge, CI APK + launch gate + player probe green before merge. Phone items (TalkBack, 200% text on a device, frame rate) go to `OWNER-TODO.md` as pending, never claimed.

## Done when
Merged; ratchets fall for these files.
