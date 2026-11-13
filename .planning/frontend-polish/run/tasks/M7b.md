# Task card M7b: Mobile LuvLink and Import screens

| Field | Value |
|---|---|
| Model | Claude Sonnet 5.5, high |
| Branch | `fix/mobile-luvlink-import-polish` |
| Merge mode | AUTO (full-send); CI gates green |
| Depends on | M5 merged |
| Size | M |

Read `../WORKER-PROTOCOL.md` first, then this card. The authoritative spec is `../../PLAN-v2.md`; read the whole entry named below before you start.

## Spec
PLAN-v2 §8 Phase 4 "M7" (LuvLink and Import half). Mobile LuvLink scores 3. Change no strings ("LuvLink" naming is unanswered).

## You own
`LuvLinkScreen.tsx`, `ImportScreen.tsx`, `apps/mobile/src/components/luvLink/*`, `apps/mobile/src/components/import/*`. Leave `LuvLinkPanel.tsx`'s alert import for M4 only if M4 needs it.

## Open these skill files
`C:/Users/nithy/.claude/skills/charles-unslop/SKILL.md` (passes 1-5, 7), `C:/Users/nithy/.claude/skills/charles-polish/SKILL.md`, `C:/Users/nithy/.agents/skills/building-native-ui/SKILL.md`, `C:/Users/nithy/.claude/skills/expo-react-native-expert/SKILL.md`, `C:/Users/nithy/.agents/skills/micro-interactions/SKILL.md`, `C:/Users/nithy/.claude/skills/accessibility-tester/SKILL.md`.

## Do
Weight and tracking literals out, pressables to `Tactile`, two `Alert` questions to `ConfirmSheet`, 48 dp targets, reduced motion where it animates.

## Prove
`node_modules/.bin/tsc.cmd --noEmit` in `apps/mobile`, then `npm run mobile:check` from the root (never overlapping `convex:test`), the M0 ratchets falling for the touched files, emulator screenshots at font scale 1.0 and 2.0 (restore the setting afterwards), `expo.version` bumped after your final rebase right before merge, CI APK + launch gate + player probe green before merge. Phone items (TalkBack, 200% text on a device, frame rate) go to `OWNER-TODO.md` as pending, never claimed.

## Done when
Merged; LuvLink mobile 3 to 7.
