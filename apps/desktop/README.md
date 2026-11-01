# Allegra for Windows

A small native window (Rust, `tao` + `wry`, WebView2) that shows the live site,
https://allegravibe.vercel.app. Site deploys reach the app without a reinstall.

- Dark title bar with the Allegra icon; nothing else on top.
- Closing the window quits the app and stops the music. No tray.
- Login and karaoke models are kept in `%APPDATA%\Allegra\webview`. The page asks for persistent
  storage (granted in WebView2), so Chromium never evicts the models.
- Opening it again brings the open window forward.

## What the desktop app adds

`src/bridge.js` runs in every page. It listens in on the site's Media Session calls
(`apps/web/src/hooks/useMediaSession.ts`), so the app knows the song and can press the site's own
play / pause / next / previous / seek handlers. The site has no desktop-specific code.

| Feature | Where |
|---|---|
| Taskbar preview buttons: previous, play/pause, next, mini player | `win.rs` `Taskbar` |
| Progress fill on the taskbar icon (yellow when paused) | `win.rs` `Taskbar::update` |
| Shortcuts from any app: Ctrl+Alt+Space play/pause, Ctrl+Alt+Right/Left next/previous, Ctrl+Alt+M mini player | `win.rs` `HOTKEYS` |
| Right-click the taskbar icon: recent playlists, play/pause, next, previous, mini player | `win.rs` `set_jump_list`, `%APPDATA%\Allegra\recent.txt` |
| `allegra://playlist/<id>` (any site path) opens in the app without stopping the music | `main.rs` `link_path`, `win.rs` `register_protocol` |
| Mini player: small always-on-top card, bottom-right, draggable | `mini.html`, `main.rs` `open_mini` |
| Link to the Notch: song and window state out, transport and catalog picks in | `link.rs` |
| Notch song selection starts this app's web player and keeps the selected queue | `link.rs`, `bridge.js`, `apps/web/src/App.tsx` |

Command line (used by the jump list; a running app receives it): `allegra.exe --open /liked`,
`allegra.exe --cmd toggle|next|prev|mini`, `allegra.exe allegra://playlist/abc`,
`allegra.exe --allegra-play saavn:<id> --allegra-queue saavn:<id> gaana:<id>`.

## Build

Not a root workspace and not part of `npm test`. Needs Windows, Rust (stable, MSVC) and the
WebView2 runtime.

```bash
cargo test
cargo build --release
```

The app is `target\release\allegra.exe`, a single file you can copy anywhere.
Set `ALLEGRA_URL=http://localhost:5173` to point it at the dev server. Debug builds keep a
console and log commands, the song and the storage grant.

## Releases and updates

- **Most changes need no desktop release.** The window shows the live site, so a website deploy
  reaches every installed app the next time a page loads.
- **A shell change** (anything under `apps/desktop/`) is built by `.github/workflows/desktop.yml` on
  every push and pull request. From `main` it replaces the `desktop-latest` release:
  `allegra.exe` plus `version.txt`.
- **Installed apps update themselves** (`src/update.rs`). At launch, a background check reads
  `version.txt`. If it's higher than the running build, the new `allegra.exe` is downloaded beside the
  old one and swapped in, so the next launch runs it. Debug builds and `ALLEGRA_NO_UPDATE=1` skip
  this.
- **So: bump `version` in `Cargo.toml` with every shell change.** An equal or lower version is
  never installed.
- **First install:** download `allegra.exe` from the `desktop-latest` release into
  `%LOCALAPPDATA%\Programs\Allegra\`. That's the path the Notch looks for.

The Notch (a separate project) uses this app as its only music player. A song selection is sent
over the local named pipe when Allegra is open; otherwise Notch launches the installed app with the
selected song and queue. The installed path is `%LOCALAPPDATA%\Programs\Allegra\allegra.exe`;
Notch also checks beside its own executable for development builds.
