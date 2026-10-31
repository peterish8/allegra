#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! Allegra for Windows: the live site (`ALLEGRA_URL`) in one WebView2 window, the way Spotify's
//! desktop app wraps its web UI in a native shell.
//!
//! - The title bar is the native one, painted Allegra's black with the Allegra icon, so it reads
//!   as a thin strip while keeping snap layouts, resizing and the system buttons for free.
//! - Closing the window quits the app, which stops the music. There is no tray.
//! - WebView2 publishes the page's media session to Windows, so media keys and the notch's
//!   Music page follow Allegra with no extra code.
//! - Login lives in our own profile folder (`%APPDATA%\Allegra\webview`) and survives restarts.
//! - A second launch brings the open window forward instead of opening another.
//!
//! `ALLEGRA_URL` in the environment overrides the site, e.g. `http://localhost:5173` in dev.

use std::path::PathBuf;
use std::process::Command;
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::platform::windows::{IconExtWindows, WindowExtWindows};
use tao::window::{Icon, Theme, WindowBuilder};
use wry::{NewWindowResponse, WebContext, WebViewBuilder};

/// Unique among top-level windows: a second launch finds the first by it.
const TITLE: &str = "Allegra";
const ALLEGRA_URL: &str = "https://allegravibe.vercel.app";
/// Allegra's page background, 0xRRGGBB. The frame uses it so the bar melts into the page.
const BG: u32 = 0x050506;

mod win {
    use windows_sys::Win32::Graphics::Dwm::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Bring an already open Allegra forward; true if there was one.
    pub fn focus_existing(title: &str) -> bool {
        unsafe {
            let h = FindWindowW(std::ptr::null(), wide(title).as_ptr());
            if h.is_null() {
                return false;
            }
            if IsIconic(h) != 0 {
                ShowWindow(h, SW_RESTORE);
            }
            SetForegroundWindow(h);
            true
        }
    }

    /// Dark title bar, rounded corners, and caption + border in `rgb` (Windows 11; older
    /// versions ignore what they don't know).
    pub fn style_frame(hwnd: isize, rgb: u32) {
        // COLORREF is 0x00BBGGRR.
        let c: u32 = ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
        let on: i32 = 1;
        let round: i32 = DWMWCP_ROUND;
        let set = |attr: i32, v: *const core::ffi::c_void| unsafe {
            DwmSetWindowAttribute(hwnd as _, attr as u32, v, 4);
        };
        set(DWMWA_USE_IMMERSIVE_DARK_MODE, &on as *const i32 as _);
        set(DWMWA_WINDOW_CORNER_PREFERENCE, &round as *const i32 as _);
        set(DWMWA_CAPTION_COLOR, &c as *const u32 as _);
        set(DWMWA_BORDER_COLOR, &c as *const u32 as _);
    }
}

fn profile_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Allegra")
        .join("webview")
}

/// Links the site opens in a new window (artist pages, licences) go to the default browser.
fn open_external(url: &str) {
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = Command::new("explorer.exe").arg(url).spawn();
    }
}

fn main() -> wry::Result<()> {
    if win::focus_existing(TITLE) {
        return Ok(());
    }
    let url = std::env::var("ALLEGRA_URL").unwrap_or_else(|_| ALLEGRA_URL.into());

    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title(TITLE)
        .with_window_icon(Icon::from_resource(1, None).ok())
        .with_inner_size(LogicalSize::new(1280.0, 820.0))
        .with_min_inner_size(LogicalSize::new(880.0, 600.0))
        .with_theme(Some(Theme::Dark))
        .build(&event_loop)
        .expect("window");
    win::style_frame(window.hwnd(), BG);

    let mut context = WebContext::new(Some(profile_dir()));
    let _webview = WebViewBuilder::new_with_web_context(&mut context)
        .with_url(&url)
        .with_background_color((
            (BG >> 16) as u8,
            (BG >> 8) as u8,
            BG as u8,
            255,
        ))
        .with_devtools(cfg!(debug_assertions))
        .with_new_window_req_handler(|url, _| {
            open_external(&url);
            NewWindowResponse::Deny
        })
        .build(&window)?;

    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *flow = ControlFlow::Exit;
        }
    });
}
