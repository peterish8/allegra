# Allegra for Windows

A small native window (Rust, `tao` + `wry`, WebView2) that shows the live site,
https://allegravibe.vercel.app. Site deploys reach the app without a reinstall.

- Dark title bar with the Allegra icon; nothing else on top.
- Closing the window quits the app and stops the music. No tray.
- Media keys and Windows' media controls follow Allegra (WebView2 publishes the media session).
- Login is kept in `%APPDATA%\Allegra\webview`.
- Opening it again brings the open window forward.

Not a root workspace and not part of `npm test`. Needs Windows, Rust (stable, MSVC) and the
WebView2 runtime.

```bash
cargo build --release
```

The app is `target\release\allegra.exe` (about 1 MB), a single file you can copy anywhere.
Set `ALLEGRA_URL=http://localhost:5173` to point it at the dev server.

The Notch (a separate project) opens this app when you click the cover on its Music page, if
`allegra.exe` sits beside `notch.exe`; otherwise it opens the site in the browser.
