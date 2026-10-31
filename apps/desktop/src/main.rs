#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! Allegra for Windows: the live site (`ALLEGRA_URL`) in one WebView2 window, the way Spotify's
//! desktop app wraps its web UI in a native shell, plus what only a desktop app can do.
//!
//! - The title bar is the native one, painted Allegra's black with the Allegra icon, so it reads
//!   as a thin strip while keeping snap layouts, resizing and the system buttons for free.
//! - Closing the window quits the app, which stops the music. There is no tray.
//! - `bridge.js` listens in on the site's Media Session calls, so the shell knows the song and
//!   can press play, next, previous and seek through the site's own handlers.
//! - That state drives the taskbar (prev / play / next / mini buttons and a progress fill), the
//!   mini player (`mini.html`, always on top) and the link to the Notch (`link.rs`).
//! - Ctrl+Alt+Space / Right / Left / M work from any app: play-pause, next, previous, mini player.
//! - `allegra://playlist/<id>` links and the taskbar's jump list (recent playlists, tasks) arrive
//!   as a command line; a second launch hands it to the running window and exits.
//! - Login and karaoke models live in our own profile folder (`%APPDATA%\Allegra\webview`), and
//!   the page asks for persistent storage so Chromium never evicts the models.
//!
//! `ALLEGRA_URL` in the environment overrides the site, e.g. `http://localhost:5173` in dev.

mod link;
mod win;

use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy, EventLoopWindowTarget};
use tao::platform::windows::{IconExtWindows, WindowBuilderExtWindows, WindowExtWindows};
use tao::window::{Icon, Theme, Window, WindowBuilder, WindowId};
use wry::{NewWindowResponse, WebContext, WebView, WebViewBuilder};

/// Unique among top-level windows: a second launch finds the first by it.
const TITLE: &str = "Allegra";
const ALLEGRA_URL: &str = "https://allegravibe.vercel.app";
/// Allegra's page background, 0xRRGGBB. The frame uses it so the bar melts into the page.
const BG: u32 = 0x050506;
/// The mini player's card colour (`mini.html` `.card`).
const MINI_BG: u32 = 0x0b0b0d;
const BRIDGE_JS: &str = include_str!("bridge.js");
const MINI_HTML: &str = include_str!("mini.html");
/// How many playlists the jump list remembers.
const RECENT_MAX: usize = 6;

/// Something to do, from a launch, the taskbar, a hotkey, the notch or the mini player.
#[derive(Clone, Debug, PartialEq)]
pub enum Cmd {
    Toggle,
    Play,
    Pause,
    Next,
    Prev,
    /// Seconds.
    Seek(f64),
    /// Start a catalog song in Allegra's own web player. `queue` is in play order.
    PlayCatalog {
        id: String,
        queue: Vec<String>,
    },
    /// Open the mini player, or close it if it's open.
    Mini,
    /// Close the mini player and bring the main window back.
    Expand,
    Show,
    /// A site path such as `/playlist/abc`.
    Open(String),
}

impl Cmd {
    /// Wire form for a second launch: `toggle`, `seek 12.5`, `open /playlist/x`.
    fn encode(&self) -> String {
        match self {
            Cmd::Toggle => "toggle".into(),
            Cmd::Play => "play".into(),
            Cmd::Pause => "pause".into(),
            Cmd::Next => "next".into(),
            Cmd::Prev => "prev".into(),
            Cmd::Seek(s) => format!("seek {s}"),
            Cmd::PlayCatalog { id, queue } => {
                format!("play-catalog {}", json!({ "id": id, "queue": queue }))
            }
            Cmd::Mini => "mini".into(),
            Cmd::Expand => "expand".into(),
            Cmd::Show => "show".into(),
            Cmd::Open(p) => format!("open {p}"),
        }
    }

    fn decode(s: &str) -> Option<Cmd> {
        let (word, rest) = s.trim().split_once(' ').unwrap_or((s.trim(), ""));
        Some(match word {
            "toggle" => Cmd::Toggle,
            "play" => Cmd::Play,
            "pause" => Cmd::Pause,
            "next" => Cmd::Next,
            "prev" => Cmd::Prev,
            "seek" => Cmd::Seek(rest.trim().parse().ok().filter(|s: &f64| s.is_finite())?),
            "play-catalog" => {
                let value: Value = serde_json::from_str(rest.trim()).ok()?;
                let id = clean_catalog_ref(value.get("id")?.as_str()?)?;
                let queue_values = value.get("queue")?.as_array()?;
                if queue_values.len() > 50 {
                    return None;
                }
                let mut queue = queue_values
                    .iter()
                    .map(|item| clean_catalog_ref(item.as_str()?))
                    .collect::<Option<Vec<_>>>()?;
                if !queue.contains(&id) {
                    queue.insert(0, id.clone());
                }
                Cmd::PlayCatalog { id, queue }
            }
            "mini" => Cmd::Mini,
            "expand" => Cmd::Expand,
            "show" => Cmd::Show,
            "open" => Cmd::Open(clean_path(rest)?),
            _ => return None,
        })
    }

    /// From our command line: an `allegra://` link, `--open <path>` or `--cmd <name>`.
    fn from_args(args: &[String]) -> Option<Cmd> {
        if args.first().is_some_and(|flag| flag == "--allegra-play") {
            let id = clean_catalog_ref(args.get(1)?)?;
            let mut queue = vec![id.clone()];
            if args.get(2).is_some_and(|flag| flag == "--allegra-queue") {
                let queued = args.get(3..)?;
                if queued.len() > 50 {
                    return None;
                }
                queue = queued
                    .iter()
                    .map(|item| clean_catalog_ref(item))
                    .collect::<Option<Vec<_>>>()?;
                if !queue.contains(&id) {
                    queue.insert(0, id.clone());
                }
            }
            return Some(Cmd::PlayCatalog { id, queue });
        }
        match args {
            [flag, path, ..] if flag == "--open" => Some(Cmd::Open(clean_path(path)?)),
            [flag, name, ..] if flag == "--cmd" => {
                Cmd::decode(name).filter(|c| !matches!(c, Cmd::Open(_)))
            }
            [url, ..] => link_path(url).map(Cmd::Open),
            [] => None,
        }
    }
}

/// A playable catalog reference is a source prefix plus one provider id.
fn clean_catalog_ref(reference: &str) -> Option<String> {
    let (source, id) = reference.split_once(':')?;
    if !matches!(source, "saavn" | "gaana")
        || id.is_empty()
        || id.len() > 256
        || id.contains(':')
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.~".contains(&b))
    {
        return None;
    }
    Some(reference.to_owned())
}

/// `allegra://playlist/abc` → `/playlist/abc`.
fn link_path(url: &str) -> Option<String> {
    let rest = url
        .get(..10)?
        .eq_ignore_ascii_case("allegra://")
        .then(|| &url[10..])?;
    clean_path(rest)
}

/// A same-site path: one leading `/`, no trailing `/`, nothing that could leave the site.
fn clean_path(p: &str) -> Option<String> {
    let p = p.trim().trim_start_matches('/').trim_end_matches('/');
    let bad = |c: char| c.is_whitespace() || c.is_control() || matches!(c, '\\' | '"' | '<' | '>');
    if p.contains(bad) || p.contains("://") {
        return None;
    }
    Some(format!("/{p}"))
}

/// The song as the page reports it. Times in seconds.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Now {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover: Option<String>,
    pub playing: bool,
    pub duration: f64,
    pub position: f64,
}

impl Now {
    fn from_json(v: &Value) -> Now {
        let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_owned();
        let n = |k: &str| {
            v.get(k)
                .and_then(Value::as_f64)
                .filter(|x| x.is_finite())
                .unwrap_or(0.0)
        };
        Now {
            title: s("title"),
            artist: s("artist"),
            album: s("album"),
            cover: v.get("cover").and_then(Value::as_str).map(str::to_owned),
            playing: v.get("playing").and_then(Value::as_bool).unwrap_or(false),
            duration: n("duration"),
            position: n("position"),
        }
    }

    fn to_json(&self) -> Value {
        json!({
            "title": self.title, "artist": self.artist, "album": self.album, "cover": self.cover,
            "playing": self.playing, "duration": self.duration, "position": self.position,
        })
    }
}

/// Put `path` first in the recent list. False if nothing changed.
fn remember(list: &mut Vec<(String, String)>, path: &str, title: &str) -> bool {
    let title = match title.trim() {
        "" if path == "/liked" => "Liked songs",
        "" if path.starts_with("/shared/") => "Shared playlist",
        "" => "Playlist",
        t => t,
    };
    let entry = (path.to_owned(), title.to_owned());
    if list.first() == Some(&entry) {
        return false;
    }
    list.retain(|(p, _)| p != path);
    list.insert(0, entry);
    list.truncate(RECENT_MAX);
    true
}

fn data_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Allegra")
}

/// `recent.txt`: one `path<TAB>title` per line, newest first.
fn load_recent() -> Vec<(String, String)> {
    std::fs::read_to_string(data_dir().join("recent.txt"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.split_once('\t'))
        .filter_map(|(p, t)| Some((clean_path(p)?, t.to_owned())))
        .take(RECENT_MAX)
        .collect()
}

fn save_recent(list: &[(String, String)]) {
    let text: String = list
        .iter()
        .map(|(p, t)| format!("{p}\t{}\n", t.replace(['\t', '\n', '\r'], " ")))
        .collect();
    let _ = std::fs::create_dir_all(data_dir());
    let _ = std::fs::write(data_dir().join("recent.txt"), text);
}

/// Links the site opens in a new window (artist pages, licences) go to the default browser.
fn open_external(url: &str) {
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = Command::new("explorer.exe").arg(url).spawn();
    }
}

enum UserEvent {
    /// A message from `bridge.js` in the site.
    Page(String),
    /// A message from the mini player.
    Mini(String),
    Cmd(Cmd),
    TaskbarReady,
}

struct Mini {
    window: Window,
    view: WebView,
}

struct App {
    window: Window,
    view: WebView,
    mini: Option<Mini>,
    taskbar: Option<win::Taskbar>,
    link: link::Link,
    page_ready: bool,
    pending_catalog: Option<Cmd>,
    now: Now,
    recent: Vec<(String, String)>,
    exe: PathBuf,
    proxy: EventLoopProxy<UserEvent>,
    /// Declared last so it outlives every webview built from it.
    context: WebContext,
}

impl App {
    fn hwnd(&self) -> isize {
        self.window.hwnd()
    }

    fn show(&self) {
        self.window.set_visible(true);
        self.window.set_minimized(false);
        self.window.set_focus();
    }

    fn page_js(&self, js: &str) {
        let _ = self.view.evaluate_script(js);
    }

    fn run(&mut self, cmd: Cmd, target: &EventLoopWindowTarget<UserEvent>) {
        if matches!(&cmd, Cmd::PlayCatalog { .. }) && !self.page_ready {
            self.pending_catalog = Some(cmd);
            self.show();
            return;
        }
        match cmd {
            Cmd::Toggle => self.page_js("window.__allegra && __allegra.toggle()"),
            Cmd::Play => self.page_js("window.__allegra && __allegra.cmd('play')"),
            Cmd::Pause => self.page_js("window.__allegra && __allegra.cmd('pause')"),
            Cmd::Next => self.page_js("window.__allegra && __allegra.cmd('nexttrack')"),
            Cmd::Prev => self.page_js("window.__allegra && __allegra.cmd('previoustrack')"),
            Cmd::Seek(s) => {
                self.page_js(&format!("window.__allegra && __allegra.cmd('seekto', {s})"))
            }
            Cmd::PlayCatalog { id, queue } => {
                self.page_js(&format!(
                    "window.__allegra && __allegra.playCatalog({})",
                    json!({ "id": id, "queue": queue })
                ));
                self.show();
            }
            Cmd::Mini => {
                if self.mini.take().is_none() {
                    self.open_mini(target);
                }
            }
            Cmd::Expand => {
                self.mini = None;
                self.show();
            }
            Cmd::Show => self.show(),
            Cmd::Open(path) => {
                self.page_js(&format!(
                    "window.__allegra && __allegra.go({})",
                    json!(path)
                ));
                self.show();
            }
        }
    }

    fn open_mini(&mut self, target: &EventLoopWindowTarget<UserEvent>) {
        // Bottom-right corner of the work area, above the taskbar.
        let area = win::work_area();
        let scale = self.window.scale_factor();
        let (w, h, margin) = (360.0, 104.0, 20.0);
        let x = area.right as f64 - (w + margin) * scale;
        let y = area.bottom as f64 - (h + margin) * scale;
        let window = WindowBuilder::new()
            .with_title("Allegra mini player")
            .with_window_icon(Icon::from_resource(1, None).ok())
            .with_inner_size(LogicalSize::new(w, h))
            .with_position(PhysicalPosition::new(x, y))
            .with_decorations(false)
            .with_resizable(false)
            .with_always_on_top(true)
            .with_skip_taskbar(true)
            .build(target);
        let window = match window {
            Ok(w) => w,
            Err(_e) => {
                #[cfg(debug_assertions)]
                eprintln!("mini window: {_e}");
                return;
            }
        };
        // Windows 11 rounds the corners and draws the hairline border.
        win::style_frame(window.hwnd(), MINI_BG);
        let p = self.proxy.clone();
        let view = WebViewBuilder::new_with_web_context(&mut self.context)
            .with_html(MINI_HTML)
            .with_background_color((
                (MINI_BG >> 16) as u8,
                (MINI_BG >> 8) as u8,
                MINI_BG as u8,
                255,
            ))
            .with_devtools(cfg!(debug_assertions))
            .with_ipc_handler(move |req| {
                let _ = p.send_event(UserEvent::Mini(req.body().clone()));
            })
            .build(&window);
        let view = match view {
            Ok(v) => v,
            Err(_e) => {
                #[cfg(debug_assertions)]
                eprintln!("mini webview: {_e}");
                return;
            }
        };
        self.window.set_minimized(true);
        self.mini = Some(Mini { window, view });
    }

    fn push_now(&self) {
        if let Some(m) = &self.mini {
            let _ = m
                .view
                .evaluate_script(&format!("__now({})", self.now.to_json()));
        }
    }

    fn on_page(&mut self, body: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(body) else {
            return;
        };
        match msg.get("cmd").and_then(Value::as_str) {
            Some("ready") => {
                self.page_ready = true;
                if let Some(cmd) = self.pending_catalog.take() {
                    let _ = self.proxy.send_event(UserEvent::Cmd(cmd));
                }
            }
            Some("now") => {
                self.now = Now::from_json(&msg);
                if let Some(t) = &mut self.taskbar {
                    t.update(&self.now);
                }
                self.push_now();
                self.link.now(&self.now);
            }
            Some("visit") => {
                let path = msg.get("path").and_then(Value::as_str).and_then(clean_path);
                let title = msg.get("title").and_then(Value::as_str).unwrap_or("");
                if let Some(path) = path {
                    if remember(&mut self.recent, &path, title) {
                        save_recent(&self.recent);
                        let _ = win::set_jump_list(&self.exe, &self.recent);
                    }
                }
            }
            Some("persist") => {
                #[cfg(debug_assertions)]
                eprintln!("persistent storage granted: {}", msg["granted"]);
            }
            _ => {}
        }
    }

    fn on_mini(&mut self, body: &str) {
        match body {
            "drag" => {
                if let Some(m) = &self.mini {
                    let _ = m.window.drag_window();
                }
            }
            "ready" => self.push_now(),
            other => {
                if let Some(c) = Cmd::decode(other).filter(|c| !matches!(c, Cmd::Open(_))) {
                    let _ = self.proxy.send_event(UserEvent::Cmd(c));
                }
            }
        }
    }

    fn report_window(&self) {
        let shown = self.window.is_visible() && !self.window.is_minimized();
        self.link.window(shown, self.window.is_focused());
    }

    fn is_mini(&self, id: WindowId) -> bool {
        self.mini.as_ref().is_some_and(|m| m.window.id() == id)
    }
}

fn main() -> wry::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let first = Cmd::from_args(&args);
    if win::forward_to_existing(TITLE, first.as_ref()) {
        return Ok(());
    }
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("allegra.exe"));
    win::register_protocol(&exe);
    let site = std::env::var("ALLEGRA_URL").unwrap_or_else(|_| ALLEGRA_URL.into());
    let start = match &first {
        Some(Cmd::Open(p)) => format!("{}{p}", site.trim_end_matches('/')),
        _ => site,
    };

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title(TITLE)
        .with_window_icon(Icon::from_resource(1, None).ok())
        .with_inner_size(LogicalSize::new(1280.0, 820.0))
        .with_min_inner_size(LogicalSize::new(880.0, 600.0))
        .with_theme(Some(Theme::Dark))
        .build(&event_loop)
        .expect("window");
    win::style_frame(window.hwnd(), BG);
    let p = proxy.clone();
    win::hook(window.hwnd(), move |h| {
        let _ = p.send_event(match h {
            win::Hook::Cmd(c) => UserEvent::Cmd(c),
            win::Hook::TaskbarReady => UserEvent::TaskbarReady,
        });
    });
    win::register_hotkeys(window.hwnd());

    let mut context = WebContext::new(Some(data_dir().join("webview")));
    let p = proxy.clone();
    let view = WebViewBuilder::new_with_web_context(&mut context)
        .with_url(&start)
        .with_initialization_script(BRIDGE_JS)
        .with_background_color(((BG >> 16) as u8, (BG >> 8) as u8, BG as u8, 255))
        .with_devtools(cfg!(debug_assertions))
        .with_new_window_req_handler(|url, _| {
            open_external(&url);
            NewWindowResponse::Deny
        })
        .with_ipc_handler(move |req| {
            let _ = p.send_event(UserEvent::Page(req.body().clone()));
        })
        .build(&window)?;

    let p = proxy.clone();
    let link = link::Link::start(move |c| {
        let _ = p.send_event(UserEvent::Cmd(c));
    });
    let recent = load_recent();
    let _jump = win::set_jump_list(&exe, &recent);
    if first == Some(Cmd::Mini) {
        let _ = proxy.send_event(UserEvent::Cmd(Cmd::Mini));
    }

    let mut app = App {
        window,
        view,
        mini: None,
        taskbar: None,
        link,
        page_ready: false,
        pending_catalog: first
            .clone()
            .filter(|cmd| matches!(cmd, Cmd::PlayCatalog { .. })),
        now: Now::default(),
        recent,
        exe,
        proxy,
        context,
    };
    event_loop.run(move |event, target, flow| {
        *flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(UserEvent::Page(body)) => app.on_page(&body),
            Event::UserEvent(UserEvent::Mini(body)) => app.on_mini(&body),
            Event::UserEvent(UserEvent::Cmd(c)) => app.run(c, target),
            Event::UserEvent(UserEvent::TaskbarReady) => {
                app.taskbar = win::Taskbar::new(app.hwnd());
                if let Some(t) = &mut app.taskbar {
                    t.update(&app.now);
                }
            }
            Event::WindowEvent {
                window_id, event, ..
            } => {
                if app.is_mini(window_id) {
                    if let WindowEvent::CloseRequested = event {
                        app.mini = None;
                    }
                    return;
                }
                match event {
                    WindowEvent::CloseRequested => *flow = ControlFlow::Exit,
                    WindowEvent::Focused(_) | WindowEvent::Resized(_) => app.report_window(),
                    _ => {}
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn links_become_site_paths() {
        assert_eq!(
            link_path("allegra://playlist/abc"),
            Some("/playlist/abc".into())
        );
        assert_eq!(
            link_path("ALLEGRA://playlist/abc/"),
            Some("/playlist/abc".into())
        );
        assert_eq!(link_path("allegra://"), Some("/".into()));
        assert_eq!(
            link_path("allegra:////evil.example"),
            Some("/evil.example".into())
        );
        assert_eq!(link_path("allegra://x/https://evil.example"), None);
        assert_eq!(link_path("allegra://a b"), None);
        assert_eq!(link_path("https://allegravibe.vercel.app/x"), None);
        assert_eq!(link_path("short"), None);
    }

    #[test]
    fn command_line() {
        assert_eq!(Cmd::from_args(&[]), None);
        assert_eq!(
            Cmd::from_args(&args(&["--open", "/playlist/p1"])),
            Some(Cmd::Open("/playlist/p1".into()))
        );
        assert_eq!(Cmd::from_args(&args(&["--cmd", "next"])), Some(Cmd::Next));
        assert_eq!(Cmd::from_args(&args(&["--cmd", "bogus"])), None);
        assert_eq!(
            Cmd::from_args(&args(&[
                "--allegra-play",
                "saavn:track-1",
                "--allegra-queue",
                "saavn:track-1",
                "gaana:track-2",
            ])),
            Some(Cmd::PlayCatalog {
                id: "saavn:track-1".into(),
                queue: vec!["saavn:track-1".into(), "gaana:track-2".into()],
            })
        );
        assert_eq!(
            Cmd::from_args(&args(&["--allegra-play", "other:track"])),
            None
        );
        assert_eq!(
            Cmd::from_args(&args(&["allegra://liked"])),
            Some(Cmd::Open("/liked".into()))
        );
    }

    #[test]
    fn commands_survive_the_trip_to_the_running_app() {
        for c in [
            Cmd::Toggle,
            Cmd::Play,
            Cmd::Pause,
            Cmd::Next,
            Cmd::Prev,
            Cmd::Seek(61.5),
            Cmd::PlayCatalog {
                id: "gaana:track-2".into(),
                queue: vec!["saavn:track-1".into(), "gaana:track-2".into()],
            },
            Cmd::Mini,
            Cmd::Expand,
            Cmd::Show,
            Cmd::Open("/playlist/x".into()),
        ] {
            assert_eq!(Cmd::decode(&c.encode()), Some(c));
        }
        assert_eq!(Cmd::decode("seek NaN"), None);
        assert_eq!(Cmd::decode("open a b"), None);
    }

    #[test]
    fn recent_playlists_dedupe_and_cap() {
        let mut list = Vec::new();
        assert!(remember(&mut list, "/playlist/a", "Road trip"));
        assert!(!remember(&mut list, "/playlist/a", "Road trip"));
        assert!(remember(&mut list, "/liked", ""));
        assert_eq!(list[0], ("/liked".into(), "Liked songs".into()));
        assert!(remember(&mut list, "/playlist/a", "Road trip"));
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].0, "/playlist/a");
        for i in 0..10 {
            remember(&mut list, &format!("/playlist/{i}"), "");
        }
        assert_eq!(list.len(), RECENT_MAX);
        assert_eq!(list[0], ("/playlist/9".into(), "Playlist".into()));
    }

    #[test]
    fn page_report_parses() {
        let v: Value = serde_json::from_str(
            r#"{"cmd":"now","title":"T","artist":"A","album":"","cover":null,"playing":true,"duration":200,"position":3.5}"#,
        )
        .unwrap();
        let n = Now::from_json(&v);
        assert_eq!(n.title, "T");
        assert!(n.playing);
        assert_eq!(n.cover, None);
        assert_eq!(n.position, 3.5);
        assert_eq!(Now::from_json(&Value::Null), Now::default());
    }
}
