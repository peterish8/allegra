#![windows_subsystem = "windows"]

use std::{
    env,
    ffi::c_void,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    process::Command,
};

const ALLEGRA_URL: &str = "https://allegravibe.vercel.app";
const MB_OK: u32 = 0x0000;
const MB_ICONERROR: u32 = 0x0010;
const SW_SHOWNORMAL: i32 = 1;

#[link(name = "shell32")]
unsafe extern "system" {
    fn ShellExecuteW(
        hwnd: *mut c_void,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show_command: i32,
    ) -> *mut c_void;
}

#[link(name = "user32")]
unsafe extern "system" {
    fn MessageBoxW(hwnd: *mut c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
}

fn main() {
    if let Some(edge) = find_edge() {
        if Command::new(edge)
            .arg(format!("--app={ALLEGRA_URL}"))
            .arg("--no-first-run")
            .spawn()
            .is_ok()
        {
            return;
        }
    }

    if !open_default_browser(ALLEGRA_URL) {
        show_error(
            "Allegra could not open. Check that Microsoft Edge or a default web browser is installed, then try again.",
        );
    }
}

fn find_edge() -> Option<PathBuf> {
    let mut roots = Vec::new();
    for name in [
        "PROGRAMFILES(X86)",
        "ProgramW6432",
        "ProgramFiles",
        "LOCALAPPDATA",
    ] {
        if let Some(root) = env::var_os(name) {
            roots.push(PathBuf::from(root));
        }
    }

    // Keep the standard Windows locations as a fallback for restricted environments
    // that omit the usual Program Files variables.
    roots.push(PathBuf::from(r"C:\Program Files (x86)"));
    roots.push(PathBuf::from(r"C:\Program Files"));

    roots
        .into_iter()
        .map(|root| edge_path(&root))
        .find(|path| path.is_file())
}

fn edge_path(root: &Path) -> PathBuf {
    root.join("Microsoft")
        .join("Edge")
        .join("Application")
        .join("msedge.exe")
}

fn open_default_browser(url: &str) -> bool {
    let operation = wide("open");
    let target = wide(url);
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    result as isize > 32
}

fn show_error(message: &str) {
    let text = wide(message);
    let caption = wide("Allegra Desktop");
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

fn wide(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}
