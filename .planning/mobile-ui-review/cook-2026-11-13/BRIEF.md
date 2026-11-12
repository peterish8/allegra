# Brief: LuvLyrics player transition and Create sheet

Target: the Android mini player → Now Playing transition and the Create sheet in LuvLyrics (`apps/mobile`, React Native 0.81 + Reanimated 4), on top of PR #84 (`feat/mobile-player-transition`, 1.51.0). Stack: Expo SDK 54, Reanimated 4.1.6, Gesture Handler 2.28.
References: cook/refs/R01 to R04, the owner-approved web prototype (`C:\Users\nithy\.t3\scratch\luvlyrics-player-prototype\index.html`) at four points of the open: R01 closed (p=0), R02 p≈0.35 mid-drag, R03 p≈0.7 mid-drag, R04 open (p=1). Same quality in Allegra's own clear-glass style, not a copy of Apple Music or Spotify. Create sheet: no references; the first stills the owner approves become R05.
Bar: 9/10 per dimension: composition, light and glow, color, glass and materials, detail, motion.
Calibration offset: none yet.
Rules: repo CLAUDE.md and apps/mobile/CLAUDE.md hard rules: animate transform and opacity only; every duration and easing from a token (`Motion` in `src/constants/allegraTheme.ts`); reduced motion collapses to opacity and never disables a feature; UI from `src/ui`; worklet safety (`src/workletSafety.test.ts`); the three playback invariants; no new dependencies. Owner taste: clear frosted glass, no dark veils, subtle glows, icon-only buttons, no clutter. Cook slop ban list applies.
Time: hard cap 3h. Started: 2026-11-12 23:40 IST. Cap: 2026-11-13 02:40 IST.
Usage: about 20% of a 5h window per hour, never 100%. Codex is at its usage limit, so critics are Sonnet subagents.
Hardware: the `probe` emulator on this PC (Android 36 x86_64 with arm64 translation), stills through adb screencap. The real-phone check stays with the owner.
Deliverable: emulator stills after every round, then a PR. No video.
Permissions: download no (beyond what is installed), push a branch yes, open a PR yes, merge no.
User's words: "cook our codebase using this skill" … "Use the defaults"
