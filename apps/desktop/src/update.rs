//! Keeps the app itself up to date. The site inside updates with every deploy; this updates the shell (taskbar,
//! hotkeys, mini player, the Notch link) from the `desktop-latest` GitHub release that
//! `.github/workflows/desktop.yml` publishes from `main`.
//!
//! Once per launch, on a background thread: when the release's `version.txt` is newer than this build, its
//! `allegra.exe` is downloaded beside this one and swapped in (Windows lets a running exe be renamed), so the next
//! launch is the new version. The old exe is deleted at the launch after. Debug builds and `ALLEGRA_NO_UPDATE` never
//! replace themselves. Downloads use Windows' own `curl.exe`, so the app carries no HTTP client.
//!
//! ponytail: trusts HTTPS from this repository's release (the same trust as downloading it by hand) and checks only
//! that the file is a Windows program of plausible size; add Authenticode signing when the exe is signed.

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

const RELEASE: &str = "https://github.com/peterish8/allegra/releases/download/desktop-latest";
/// No console window flashes up for the download.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// A release build is about 1.2 MB; an error page is a few KB. Anything under this is not the app.
const MIN_EXE_BYTES: u64 = 500_000;

/// Clears the last update's leftover, then looks for a newer build without holding up the window.
pub fn check_in_background(exe: PathBuf) {
    let _ = std::fs::remove_file(old_path(&exe));
    if cfg!(debug_assertions) || std::env::var_os("ALLEGRA_NO_UPDATE").is_some() {
        return;
    }
    std::thread::spawn(move || {
        if let Err(_e) = update(&exe) {
            #[cfg(debug_assertions)]
            eprintln!("update: {_e}");
        }
    });
}

/// Downloads and swaps in a newer build. Ok(true) when the next launch is a new version.
fn update(exe: &Path) -> Result<bool, String> {
    let latest = fetch_text(&format!("{RELEASE}/version.txt"))?;
    if !is_newer(latest.trim(), env!("CARGO_PKG_VERSION")) {
        return Ok(false);
    }
    let new = exe.with_file_name("allegra.new.exe");
    download(&format!("{RELEASE}/allegra.exe"), &new)?;
    if !looks_like_app(&new) {
        let _ = std::fs::remove_file(&new);
        return Err("the download is not the app".into());
    }
    let old = old_path(exe);
    std::fs::rename(exe, &old).map_err(|e| format!("could not move the running app aside: {e}"))?;
    if let Err(e) = std::fs::rename(&new, exe) {
        // Put the running app back, so the next launch still finds one.
        let _ = std::fs::rename(&old, exe);
        return Err(format!("could not put the new app in place: {e}"));
    }
    Ok(true)
}

/// True when `latest` is a higher `major.minor.patch` than `current`; anything unreadable is never newer.
pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

fn parse_version(text: &str) -> Option<(u32, u32, u32)> {
    let mut parts = text.trim().trim_start_matches('v').split('.');
    let version = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    parts.next().is_none().then_some(version)
}

fn old_path(exe: &Path) -> PathBuf {
    exe.with_file_name("allegra.old.exe")
}

/// A Windows program ("MZ") of plausible size.
fn looks_like_app(path: &Path) -> bool {
    let big = std::fs::metadata(path).map(|m| m.len() >= MIN_EXE_BYTES).unwrap_or(false);
    let head = std::fs::read(path).ok().map(|bytes| bytes.starts_with(b"MZ")).unwrap_or(false);
    big && head
}

fn curl() -> Command {
    let mut command = Command::new("curl.exe");
    command.args(["--fail", "--silent", "--show-error", "--location", "--max-time", "120"]);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn fetch_text(url: &str) -> Result<String, String> {
    let out = curl().arg(url).output().map_err(|e| format!("curl: {e}"))?;
    if !out.status.success() {
        return Err(format!("{url}: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    String::from_utf8(out.stdout).map_err(|_| format!("{url}: not text"))
}

fn download(url: &str, to: &Path) -> Result<(), String> {
    let status = curl().arg("--output").arg(to).arg(url).status().map_err(|e| format!("curl: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{url}: download failed"))
    }
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn a_higher_release_is_newer() {
        assert!(is_newer("0.3.0", "0.2.0"));
        assert!(is_newer("0.2.10", "0.2.9"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("v0.2.1\n", "0.2.0"));
    }

    #[test]
    fn the_same_or_an_older_release_is_not_newer() {
        assert!(!is_newer("0.2.0", "0.2.0"));
        assert!(!is_newer("0.1.9", "0.2.0"));
    }

    #[test]
    fn an_unreadable_version_is_never_newer() {
        assert!(!is_newer("", "0.2.0"));
        assert!(!is_newer("<!DOCTYPE html>", "0.2.0"));
        assert!(!is_newer("0.3", "0.2.0"));
        assert!(!is_newer("0.3.0.1", "0.2.0"));
    }
}
