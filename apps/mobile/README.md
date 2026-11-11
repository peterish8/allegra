> **Current source:** LuvLyrics includes offline playback and playlists, Connect and account sync,
> share links and scannable codes, Listening Stats, and native Android playback. Start with the
> [Allegra codebase map](../../docs/current-codebase.md) for recent changes, then read the
> [mobile rules](CLAUDE.md) and [design system](DESIGN.md) for the area you are changing.
> GitHub Actions builds and checks the APK. See [workflows](../../docs/workflows.md) for what
> each gate proves.

<div align="center">

# 🎵 LuvLyrics

### _A local-first music library with a premium synced-lyrics experience._

[![CI](https://img.shields.io/badge/CI-passing-brightgreen?style=flat-square&logo=github-actions&logoColor=white)](https://github.com/peterish8/allegra/actions/workflows/mobile-ci.yml)
[![Expo](https://img.shields.io/badge/Expo-54.0-000020?style=flat-square&logo=expo&logoColor=white)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React_Native-0.81-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://expo.dev/packages/expo-sqlite)
[![GSSoC 2026](https://img.shields.io/badge/GSSoC%202026-Official%20Project-orange?style=flat-square&logo=girlscript&logoColor=white)](https://gssoc.girlscript.org/projects/luvlyrics%2Fluvlyricsapp)
[![Discord](https://img.shields.io/discord/1346915886471483404?logo=discord&label=Discord)](https://discord.gg/VeR3hAfUn)

---

> **Your music. Your lyrics. Your phone. No cloud required.**

## 📖 Table of Contents

- [About](#-about)
- [GSSoC — Contribute & Earn Points](#-girlscript-summer-of-code-gssoc-2026)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Repository Structure](#-repository-structure)
- [Prerequisites](#-prerequisites)
- [Local Setup](#-local-setup)
- [Environment Variables](#-environment-variables)
- [Quality Checks](#-quality-checks)
- [Contributing](#-contributing)
- [Security](#-security)
- [Documentation](#-documentation)
- [Contributors](#-contributors)
- [License](#-license)

</div>

---

## 🎧 About

LuvLyrics is an open-source, **local-first** music library and lyrics app built with Expo, React Native, TypeScript, SQLite, and Zustand.

The app is built around one core obsession: a **premium lyrics-reading experience** — perfectly timed synced lyrics, plain lyric auto-scroll, multi-source lyric fetching, local playlist management, cover art tools, and a native Android player that just works.

Current feature entry points:

- [Listening Stats](src/screens/ListeningStatsScreen.tsx) reads the local listening log through
  [the stats hook](src/hooks/useListeningStats.ts). The 1.45.1 source combines qualifying paused
  segments in the same listen.
- [ShareSheet](src/components/share/ShareSheet.tsx) and [ScanCodeScreen](src/screens/ScanCodeScreen.tsx)
  use share URLs and the shared LuvLyrics code format. The [deep-link parser](src/hooks/useDeepLinks.ts)
  handles the resulting links.
- [PlayerContext](src/contexts/PlayerContext.tsx) and [NativeAudioPlayer](src/services/NativeAudioPlayer.ts)
  route Android playback to Kotlin Media3, which owns the active queue and confirmed play state.
- Downloads use native WorkManager. The local library works offline, and signed-in sync uses the
  [SQLite outbox](src/services/sync/LibrarySync.ts) for retry.

---

## 🌸 GirlScript Summer of Code (GSSoC) 2026

<div align="center">

**LuvLyrics is an official project under [GirlScript Summer of Code (GSSoC) 2026](https://gssoc.girlscript.org/projects/luvlyrics%2Fluvlyricsapp).**

_Contribute to a real production app. Earn GSSoC leaderboard points. Build your open-source portfolio._

</div>

### How to earn points as a GSSoC contributor

| Step | Action |
| --- | --- |
| 1 | Visit the [LuvLyrics GSSoC project page](https://gssoc.girlscript.org/projects/luvlyrics%2Fluvlyricsapp) to register your interest |
| 2 | Browse [open issues](https://github.com/LuvLyricsApp/LuvLyricsApp/issues) — filter by [`gssoc`](https://github.com/LuvLyricsApp/LuvLyricsApp/issues?q=label%3Agssoc), `good first issue`, or `help wanted` |
| 3 | Comment on the issue you want to tackle and **wait for a maintainer to assign it to you** before writing any code |
| 4 | Fork the repo, create a branch, make your changes, and open a PR linked to the issue |
| 5 | Once your PR is reviewed and merged, your GSSoC points are automatically credited |

### Point levels

| Label | Points | What fits |
| --- | --- | --- |
| `gssoc-l1` | 10 pts | Docs, tests for existing code, small UI/copy fixes |
| `gssoc-l2` | 25 pts | New features, lyrics providers, UI screen improvements, moderate refactors |
| `gssoc-l3` | 45 pts | Native Kotlin modules, player engine changes, SQLite migrations, multi-store work |

> **What is GSSoC?** GirlScript Summer of Code is a free, open-source program by GirlScript Foundation. It is open to everyone — regardless of gender, background, or country — and is a great way to make real contributions to production projects while getting recognized for it.

### 💬 Questions or need help?

- **Discord**: [Join our community](https://discord.gg/VeR3hAfUn) — fastest way to reach maintainers and other contributors
- **Email**: [contactluvlyricsapp@gmail.com](mailto:contactluvlyricsapp@gmail.com) — for private or sensitive questions

---

## ✨ Features

- Synced lyrics display with smooth active-line scrolling powered by `@shopify/flash-list`
- Plain lyrics auto-scroll for lyrics without timestamps
- Local SQLite song and playlist storage
- Playlist management and per-playlist loop behavior
- Manual lyrics search through in-app WebView
- Lyrics provider integrations: LRCLIB, Genius, Lyrica, JioSaavn-style APIs
- Cover art search and local media tooling
- Download queue and audio downloader flows
- Native Android playback, notification controls, lock-screen controls, and Bluetooth headphone skip via Media3 ExoPlayer
- Background downloads that survive app kill and device restart via WorkManager
- **Desktop bridge** — _temporarily disabled_; remote control over WiFi with automatic phone-to-desktop playback handoff

---

## 🏗️ Tech Stack

| Layer | Technology |
| --- | --- |
| **Framework** | Expo SDK 54 + React Native 0.81 |
| **Language** | TypeScript 5.9 (strict) |
| **UI** | React 19 + Reanimated 3 + Gesture Handler |
| **State** | Zustand |
| **Database** | SQLite via `expo-sqlite` |
| **Lists** | `@shopify/flash-list` |
| **Audio** | Media3 ExoPlayer + MediaSessionService (Kotlin native module) |
| **Downloads** | WorkManager `CoroutineWorker` (Kotlin native module) |
| **Native modules** | Expo Modules API (Kotlin) — StartupModule, MainPlayerModule, LuvsPlayerModule, DownloaderModule |
| **Networking** | `react-native-tcp-socket`, `react-native-zeroconf` |
| **Tests** | Jest + ts-jest |
| **CI** | GitHub Actions |

---

## 🧠 Architecture

On Android, Kotlin Media3 owns confirmed play state and the active queue. JavaScript presents
player events and routes intent through the existing controls and Connect. The Expo audio fallback
has separate ownership and event rules. Use [the mobile rules](CLAUDE.md#key-architecture) when
changing transport, seek, or queue code.

### Player and seek

| Layer | Current responsibility |
| --- | --- |
| `PlayerContext` and `NativeAudioPlayer` | Bridge Kotlin player events into UI state and forward local commands. |
| Android Media3 queue | Owns play intent, auto-next, shuffle/repeat and persisted native queue state. |
| `playerStore` | Exposes controls and mirrors the confirmed native queue and play state on Android. |
| Expo audio fallback | Handles its own status guards and near-end auto-next behavior. |

Scrub through the existing transport path so Connect can route remote seeks and the local
player preserves the listener's play/pause intent. See the
[player rules and load guard](CLAUDE.md#key-architecture).

---

## 📁 Repository Structure

```text
src/
  components/       Reusable UI components
  screens/          App screens and navigation destinations
  services/         Provider clients, download logic, search logic
  store/            Zustand stores
  database/         SQLite setup, migrations, and queries
  utils/            Parsers, formatters, import/export helpers
  types/            Shared TypeScript types
scripts/
  ci/               CI helper scripts
.github/
  workflows/        GitHub Actions workflows
  ISSUE_TEMPLATE/   Issue templates
```

---

## 🔧 Prerequisites

Install these before starting:

- Node.js 20 or newer
- npm
- Git
- Android Studio (for Android builds)

---

## 🚀 Local Setup

**1. Fork the repository on GitHub.**

**2. Clone your fork:**

```bash
git clone https://github.com/<your-username>/LuvLyrics.git
cd LuvLyrics
```

**3. Install dependencies:**

```bash
npm install
```

**4. Create local environment file:**

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

**5. Start Expo:**

```bash
npm start
```

**6. Run on Android:**

```bash
npm run android
```

---

## 🔑 Environment Variables

Most features work without API keys — several services have public or fallback paths. Create `.env` from `.env.example` and fill only what you need.

| Variable | Required | Used by | Notes |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Optional | `AuthService` | Needed for Google sign-in flows |
| `EXPO_PUBLIC_GENIUS_ACCESS_TOKEN` | Optional | `GeniusService` | Improves Genius lyric search reliability |
| `EXPO_PUBLIC_SAAVN_API_URL` | Optional | `SpotifyBridgeService` | Primary Saavn-compatible API base URL |
| `EXPO_PUBLIC_SAAVN_SECONDARY_API_URL` | Optional | `MultiSourceSearchService` | Secondary fallback API base URL |
| `EXPO_PUBLIC_GAANA_API_URL` | Optional | `MultiSourceSearchService` | Gaana-compatible fallback API base URL |
| `EXPO_PUBLIC_API_SECRET` | Optional | `MultiSourceSearchService` | Only if your API endpoint expects a shared secret |
| `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` | Optional | `SpotifyService` | Needed for Spotify metadata flows |
| `EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET` | Not recommended | `SpotifyService` | Do not ship real client secrets in public mobile builds — use a backend proxy |

> **Security note:** `EXPO_PUBLIC_*` values are bundled into the client app — treat them as public. Never commit `.env`, real tokens, private keys, `credentials.json`, or Firebase service files.

---

## ✅ Quality Checks

Run the full local CI bundle before opening a PR:

```bash
npm run ci
```

This runs:

- Secret scan: `npm run security:secrets`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Tests with coverage: `npm run test:ci`

You can also run checks individually:

```bash
npm run lint
npm run typecheck
npm test
```

---

## 🤝 Contributing

Please keep PRs focused and linked to an issue.

**Recommended workflow:**

1. Pick or open an issue.
2. Create a branch from `main` — name it `fix/<issue-number>-short-description` or `feat/short-description`.
3. Make the smallest useful change.
4. Add or update tests when behavior changes.
5. Run `npm run ci`.
6. Open a PR using the template.

Good places to start:

- [Open issues](https://github.com/LuvLyricsApp/LuvLyricsApp/issues)
- Issues labeled [`gssoc`](https://github.com/LuvLyricsApp/LuvLyricsApp/issues?q=label%3Agssoc), [`good first issue`](https://github.com/LuvLyricsApp/LuvLyricsApp/issues?q=label%3A%22good+first+issue%22), or [`help wanted`](https://github.com/LuvLyricsApp/LuvLyricsApp/issues?q=label%3A%22help+wanted%22)
- [CONTRIBUTING.md](./CONTRIBUTING.md) — full contributor guide
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — community standards

---

## 🔒 Security

Please do not report secrets or vulnerabilities in public issues. Read [SECURITY.md](./SECURITY.md) for responsible reporting and secret-handling rules.

---

## 📚 Documentation

| Document | Purpose |
| --- | --- |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contributor workflow |
| [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) | Community standards |
| [SECURITY.md](./SECURITY.md) | Security policy |
| [Database Schema Guide](./docs/database-schema.md) | SQLite tables, migrations, and schema-change checklist |
| [README_DETAILED.md](./README_DETAILED.md) | Architecture notes and historical feature details |

---

## 💖 Contributors

Thanks to everyone who has contributed to LuvLyrics!

<a href="https://github.com/LuvLyricsApp/LuvLyricsApp/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=LuvLyricsApp/LuvLyricsApp&max=100&columns=14" alt="Contributors" />
</a>

<sub>View the [full contributor list →](https://github.com/LuvLyricsApp/LuvLyricsApp/graphs/contributors)</sub>

---

## 📄 License

License information is not yet defined. Maintainers should add a `LICENSE` file before wider distribution.

---

<div align="center">

_Built for music lovers. Open to everyone._

⭐ **If LuvLyrics made your library better, drop a star.** ⭐

### This project is an official participant in GSSoC 2026.

[![GSSoC 2026](https://img.shields.io/badge/GSSoC%202026-Official%20Project-orange?style=for-the-badge)](https://gssoc.girlscript.org/projects/luvlyrics%2Fluvlyricsapp)

</div>
