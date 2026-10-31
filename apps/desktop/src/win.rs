//! The Windows-only parts: window frame, single instance, the `allegra://` link type, global
//! hotkeys, taskbar buttons and progress, the jump list, and drawn icons.
use crate::{Cmd, Now};
use std::ffi::c_void;
use std::path::Path;
use windows::core::{w, Interface, PCWSTR, PWSTR};
use windows::Win32::Foundation::{E_OUTOFMEMORY, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::*;
use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemAlloc, CLSCTX_INPROC_SERVER};
use windows::Win32::System::DataExchange::COPYDATASTRUCT;
use windows::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
use windows::Win32::System::Variant::VT_LPWSTR;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::*;
use windows::Win32::UI::WindowsAndMessaging::*;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn hwnd(h: isize) -> HWND {
    HWND(h as *mut c_void)
}

/// Dark title bar, rounded corners, and caption + border in `rgb` (0xRRGGBB). Windows 10 ignores
/// the attributes it doesn't know.
pub fn style_frame(h: isize, rgb: u32) {
    let c: u32 = ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff); // COLORREF is BGR
    let on: i32 = 1;
    let round = DWMWCP_ROUND.0;
    let set = |attr: DWMWINDOWATTRIBUTE, v: *const c_void| unsafe {
        let _ = DwmSetWindowAttribute(hwnd(h), attr, v, 4);
    };
    set(DWMWA_USE_IMMERSIVE_DARK_MODE, &on as *const i32 as _);
    set(DWMWA_WINDOW_CORNER_PREFERENCE, &round as *const i32 as _);
    set(DWMWA_CAPTION_COLOR, &c as *const u32 as _);
    set(DWMWA_BORDER_COLOR, &c as *const u32 as _);
}

/// Tags our WM_COPYDATA so a stray one from another program is ignored.
const COPY_TAG: usize = 0x414c_4c47; // "ALLG"

/// If Allegra is already open, hand it `cmd` (a link, a jump-list task) and return true. A plain
/// launch, a link or "show" also brings its window forward; taskbar tasks like "next song" don't.
pub fn forward_to_existing(title: &str, cmd: Option<&Cmd>) -> bool {
    unsafe {
        let Ok(h) = FindWindowW(PCWSTR::null(), PCWSTR(wide(title).as_ptr())) else {
            return false;
        };
        if let Some(c) = cmd {
            let text = c.encode();
            let data = COPYDATASTRUCT {
                dwData: COPY_TAG,
                cbData: text.len() as u32,
                lpData: text.as_ptr() as *mut c_void,
            };
            SendMessageTimeoutW(
                h,
                WM_COPYDATA,
                WPARAM(0),
                LPARAM(&data as *const _ as isize),
                SMTO_ABORTIFHUNG,
                2000,
                None,
            );
        }
        if matches!(cmd, None | Some(Cmd::Open(_) | Cmd::Show)) {
            if IsIconic(h).as_bool() {
                let _ = ShowWindow(h, SW_RESTORE);
            }
            let _ = SetForegroundWindow(h);
        }
        true
    }
}

/// Points `allegra://` links at this exe (per user, no admin). Runs on every start so the link
/// follows the app if it moves.
pub fn register_protocol(exe: &Path) {
    let exe = exe.display().to_string();
    let set = |key: &str, name: Option<&str>, value: &str| unsafe {
        let v = wide(value);
        let name = name.map(wide);
        let _ = RegSetKeyValueW(
            HKEY_CURRENT_USER,
            PCWSTR(wide(key).as_ptr()),
            name.as_ref().map_or(PCWSTR::null(), |n| PCWSTR(n.as_ptr())),
            REG_SZ.0,
            Some(v.as_ptr() as *const c_void),
            (v.len() * 2) as u32,
        );
    };
    let root = r"Software\Classes\allegra";
    set(root, None, "URL:Allegra");
    set(root, Some("URL Protocol"), "");
    set(
        &format!(r"{root}\DefaultIcon"),
        None,
        &format!("\"{exe}\",0"),
    );
    set(
        &format!(r"{root}\shell\open\command"),
        None,
        &format!("\"{exe}\" \"%1\""),
    );
}

/// Global shortcuts: (id, virtual key, command). All use Ctrl+Alt.
const HOTKEYS: [(i32, u16, Cmd); 4] = [
    (1, VK_SPACE.0, Cmd::Toggle),
    (2, VK_RIGHT.0, Cmd::Next),
    (3, VK_LEFT.0, Cmd::Prev),
    (4, b'M' as u16, Cmd::Mini),
];

/// Registers the hotkeys; one another app already owns is skipped.
pub fn register_hotkeys(h: isize) {
    for (id, vk, _) in &HOTKEYS {
        unsafe {
            let _ = RegisterHotKey(
                Some(hwnd(h)),
                *id,
                MOD_CONTROL | MOD_ALT | MOD_NOREPEAT,
                *vk as u32,
            );
        }
    }
}

/// Taskbar thumbnail buttons: (id, command, tooltip).
const BUTTONS: [(u32, Cmd, &str); 4] = [
    (10, Cmd::Prev, "Previous"),
    (11, Cmd::Toggle, "Play"),
    (12, Cmd::Next, "Next"),
    (13, Cmd::Mini, "Mini player"),
];

/// What the window procedure hook reports.
pub enum Hook {
    Cmd(Cmd),
    /// The taskbar button exists; thumbnail buttons can be added now.
    TaskbarReady,
}

struct HookData {
    taskbar_created: u32,
    sink: Box<dyn Fn(Hook)>,
}

/// Watches the main window's messages for a second launch (WM_COPYDATA), taskbar button clicks,
/// hotkeys and the taskbar being (re)created.
pub fn hook(h: isize, sink: impl Fn(Hook) + 'static) {
    let data = Box::new(HookData {
        taskbar_created: unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) },
        sink: Box::new(sink),
    });
    unsafe {
        // The data lives as long as the window, which is as long as the app.
        let _ = SetWindowSubclass(hwnd(h), Some(subclass), 1, Box::into_raw(data) as usize);
    }
}

unsafe extern "system" fn subclass(
    h: HWND,
    msg: u32,
    wp: WPARAM,
    lp: LPARAM,
    _id: usize,
    data: usize,
) -> LRESULT {
    let d = &*(data as *const HookData);
    match msg {
        WM_COPYDATA => {
            let cds = &*(lp.0 as *const COPYDATASTRUCT);
            if cds.dwData == COPY_TAG && !cds.lpData.is_null() {
                let bytes =
                    std::slice::from_raw_parts(cds.lpData as *const u8, cds.cbData as usize);
                if let Some(c) = std::str::from_utf8(bytes).ok().and_then(Cmd::decode) {
                    (d.sink)(Hook::Cmd(c));
                }
                return LRESULT(1);
            }
        }
        WM_COMMAND if (wp.0 >> 16) as u32 == THBN_CLICKED => {
            let id = (wp.0 & 0xffff) as u32;
            if let Some((_, c, _)) = BUTTONS.iter().find(|b| b.0 == id) {
                (d.sink)(Hook::Cmd(c.clone()));
            }
            return LRESULT(0);
        }
        WM_HOTKEY => {
            if let Some((_, _, c)) = HOTKEYS.iter().find(|k| k.0 as usize == wp.0) {
                (d.sink)(Hook::Cmd(c.clone()));
            }
            return LRESULT(0);
        }
        m if m == d.taskbar_created => (d.sink)(Hook::TaskbarReady),
        _ => {}
    }
    DefSubclassProc(h, msg, wp, lp)
}

/// Thumbnail buttons and the progress fill on the taskbar button.
pub struct Taskbar {
    list: ITaskbarList3,
    h: HWND,
    play: HICON,
    pause: HICON,
    /// (has song, playing) last shown, so the buttons are only rebuilt when it changes.
    shown: Option<(bool, bool)>,
}

impl Taskbar {
    pub fn new(h: isize) -> Option<Taskbar> {
        unsafe {
            let list: ITaskbarList3 =
                CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER).ok()?;
            list.HrInit().ok()?;
            let size = GetSystemMetrics(SM_CXSMICON).max(16) as usize;
            let t = Taskbar {
                list,
                h: hwnd(h),
                play: icon(size, Shape::Play)?,
                pause: icon(size, Shape::Pause)?,
                shown: None,
            };
            let icons = [
                icon(size, Shape::Prev)?,
                t.play,
                icon(size, Shape::Next)?,
                icon(size, Shape::Mini)?,
            ];
            let buttons: Vec<THUMBBUTTON> = BUTTONS
                .iter()
                .zip(icons)
                .map(|((id, _, tip), ic)| button(*id, ic, tip, false))
                .collect();
            t.list.ThumbBarAddButtons(t.h, &buttons).ok()?;
            Some(t)
        }
    }

    pub fn update(&mut self, now: &Now) {
        let has = !now.title.is_empty();
        unsafe {
            if self.shown != Some((has, now.playing)) {
                self.shown = Some((has, now.playing));
                let (ic, tip) = if now.playing {
                    (self.pause, "Pause")
                } else {
                    (self.play, "Play")
                };
                // Everything but Mini player waits for a song.
                let buttons: Vec<THUMBBUTTON> = BUTTONS[..3]
                    .iter()
                    .map(|(id, _, t)| {
                        let (ic, t) = if *id == 11 {
                            (ic, tip)
                        } else {
                            (HICON::default(), *t)
                        };
                        let mut b = button(*id, ic, t, !has);
                        if ic.is_invalid() {
                            b.dwMask = THB_TOOLTIP | THB_FLAGS;
                        }
                        b
                    })
                    .collect();
                let _ = self.list.ThumbBarUpdateButtons(self.h, &buttons);
            }
            let state = match (has && now.duration > 0.0, now.playing) {
                (false, _) => TBPF_NOPROGRESS,
                (true, true) => TBPF_NORMAL,
                (true, false) => TBPF_PAUSED,
            };
            let _ = self.list.SetProgressState(self.h, state);
            if state != TBPF_NOPROGRESS {
                let ms = |s: f64| (s.max(0.0) * 1000.0) as u64;
                let total = ms(now.duration);
                let _ = self
                    .list
                    .SetProgressValue(self.h, ms(now.position).min(total), total);
            }
        }
    }
}

fn button(id: u32, ic: HICON, tip: &str, disabled: bool) -> THUMBBUTTON {
    let mut sz = [0u16; 260];
    for (d, s) in sz.iter_mut().zip(tip.encode_utf16().take(259)) {
        *d = s;
    }
    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        hIcon: ic,
        szTip: sz,
        dwFlags: if disabled {
            THBF_DISABLED
        } else {
            THBF_ENABLED
        },
        ..Default::default()
    }
}

/// The right-click menu on the taskbar icon: recently opened playlists, then fixed tasks. Each
/// entry starts `allegra.exe` with arguments, which a running Allegra receives as a command.
pub fn set_jump_list(exe: &Path, recent: &[(String, String)]) -> windows::core::Result<()> {
    unsafe {
        let list: ICustomDestinationList =
            CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
        let mut slots = 0u32;
        let _removed: IObjectArray = list.BeginList(&mut slots)?;
        if !recent.is_empty() {
            let items: IObjectCollection =
                CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
            for (path, title) in recent {
                items.AddObject(&shell_link(exe, &format!("--open \"{path}\""), title)?)?;
            }
            // Fails if the listener removed one of these from the list; the tasks still go in.
            let _ = list.AppendCategory(w!("Recent"), &items.cast::<IObjectArray>()?);
        }
        let tasks: IObjectCollection =
            CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
        for (arg, title) in [
            ("toggle", "Play / pause"),
            ("next", "Next song"),
            ("prev", "Previous song"),
            ("mini", "Mini player"),
        ] {
            tasks.AddObject(&shell_link(exe, &format!("--cmd {arg}"), title)?)?;
        }
        list.AddUserTasks(&tasks.cast::<IObjectArray>()?)?;
        list.CommitList()
    }
}

unsafe fn shell_link(exe: &Path, args: &str, title: &str) -> windows::core::Result<IShellLinkW> {
    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
    let exe_w = wide(&exe.display().to_string());
    link.SetPath(PCWSTR(exe_w.as_ptr()))?;
    link.SetArguments(PCWSTR(wide(args).as_ptr()))?;
    link.SetIconLocation(PCWSTR(exe_w.as_ptr()), 0)?;
    let store: IPropertyStore = link.cast()?;
    // PROPVARIANT frees its string with CoTaskMemFree when dropped, so the string must come
    // from CoTaskMemAlloc.
    let title_w = wide(title);
    let buf = CoTaskMemAlloc(title_w.len() * 2) as *mut u16;
    if buf.is_null() {
        return Err(windows::core::Error::from_hresult(E_OUTOFMEMORY));
    }
    std::ptr::copy_nonoverlapping(title_w.as_ptr(), buf, title_w.len());
    let mut pv = PROPVARIANT::default();
    (*pv.Anonymous.Anonymous).vt = VT_LPWSTR;
    (*pv.Anonymous.Anonymous).Anonymous.pwszVal = PWSTR(buf);
    store.SetValue(&PKEY_Title, &pv)?;
    store.Commit()?;
    Ok(link)
}

/// The screen's work area (without the taskbar), physical px.
pub fn work_area() -> RECT {
    let mut r = RECT::default();
    unsafe {
        let _ = SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            Some(&mut r as *mut RECT as *mut c_void),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
    }
    r
}

#[derive(Clone, Copy)]
enum Shape {
    Play,
    Pause,
    Next,
    Prev,
    Mini,
}

/// Whether the point (x, y) in the unit square is ink for `shape`.
fn ink(shape: Shape, x: f32, y: f32) -> bool {
    let rect = |x0: f32, y0: f32, x1: f32, y1: f32| x >= x0 && x <= x1 && y >= y0 && y <= y1;
    // Right-pointing triangle with its flat side at x0.
    let tri = |x0: f32, x1: f32, x: f32| {
        let half = 0.32 * (1.0 - (x - x0) / (x1 - x0));
        x >= x0 && x <= x1 && (y - 0.5).abs() <= half
    };
    match shape {
        Shape::Play => tri(0.3, 0.82, x),
        Shape::Pause => rect(0.27, 0.2, 0.42, 0.8) || rect(0.58, 0.2, 0.73, 0.8),
        Shape::Next => tri(0.2, 0.66, x) || rect(0.68, 0.2, 0.8, 0.8),
        Shape::Prev => tri(0.2, 0.66, 1.0 - x) || rect(0.2, 0.2, 0.32, 0.8),
        Shape::Mini => {
            let frame = rect(0.1, 0.2, 0.9, 0.8) && !rect(0.18, 0.28, 0.82, 0.72);
            frame || rect(0.48, 0.48, 0.74, 0.66)
        }
    }
}

/// A white `size`-px icon for `shape`, antialiased with 4x4 supersampling.
fn icon(size: usize, shape: Shape) -> Option<HICON> {
    let mut bgra = vec![0u8; size * size * 4];
    for py in 0..size {
        for px in 0..size {
            let mut hits = 0;
            for sy in 0..4 {
                for sx in 0..4 {
                    let x = (px as f32 + (sx as f32 + 0.5) / 4.0) / size as f32;
                    let y = (py as f32 + (sy as f32 + 0.5) / 4.0) / size as f32;
                    hits += ink(shape, x, y) as u32;
                }
            }
            let a = (hits * 255 / 16) as u8;
            let i = (py * size + px) * 4;
            bgra[i..i + 4].copy_from_slice(&[a, a, a, a]); // premultiplied white
        }
    }
    let mask = vec![0u8; size * size]; // alpha decides; the AND mask only needs to be big enough
    unsafe {
        CreateIcon(
            None,
            size as i32,
            size as i32,
            1,
            32,
            mask.as_ptr(),
            bgra.as_ptr(),
        )
        .ok()
    }
}
