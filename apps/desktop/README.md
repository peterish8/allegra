# Allegra Desktop for Windows

This small 32-bit Windows executable opens the hosted Allegra website in Microsoft Edge's app window. It uses Edge's normal browser profile, so browser sign-in and OAuth continue to work. If Edge cannot be found, it opens the site with the Windows default browser.

The executable is a launcher, not an offline copy of Allegra. An internet connection is required; the website, API, accounts, and music providers remain on their existing hosted services.

## Build the x86 executable

Install the Rust Windows MSVC target once:

```powershell
rustup target add i686-pc-windows-msvc
```

Then build from the repository root:

```powershell
npm run desktop:build:x86
```

The standalone executable is written to:

```text
apps/desktop/target/i686-pc-windows-msvc/release/Allegra-Desktop-x86.exe
```

The launcher checks standard Edge install locations and opens `https://allegravibe.vercel.app`. Update `ALLEGRA_URL` in `src/main.rs` if Allegra's production hostname changes.
