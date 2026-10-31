//! Link to the Notch (a separate Windows app with a Dynamic Island). The notch serves two named
//! pipes; we are the client of both:
//!
//! - `\\.\pipe\notch-allegra`: we write one JSON line per change (`now`, `window`).
//! - `\\.\pipe\notch-allegra-cmd`: the notch writes commands (`play`, `toggle`, `next`, `seek`,
//!   `open`, ...) and we apply them.
//!
//! The notch's side is `notch/src/link.rs` in the Notch project; field names must match it, and
//! it rejects a line with any field missing. When the notch isn't running both threads just retry
//! every two seconds, and on (re)connect the latest line of each type is sent again so the notch
//! catches up at once.
use crate::{Cmd, Now};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

const IN_PIPE: &str = r"\\.\pipe\notch-allegra";
const CMD_PIPE: &str = r"\\.\pipe\notch-allegra-cmd";
const RETRY: Duration = Duration::from_secs(2);

pub struct Link {
    /// (line type, line) for the writer thread.
    tx: mpsc::Sender<(&'static str, String)>,
}

impl Link {
    /// Starts both pipe threads; commands from the notch are handed to `on_cmd`.
    pub fn start(on_cmd: impl Fn(Cmd) + Send + 'static) -> Link {
        let (tx, rx) = mpsc::channel::<(&'static str, String)>();
        thread::spawn(move || {
            let mut pipe: Option<File> = None;
            let mut latest: BTreeMap<&'static str, String> = BTreeMap::new();
            loop {
                match rx.recv_timeout(RETRY) {
                    Ok((kind, line)) => {
                        latest.insert(kind, line.clone());
                        if let Some(p) = &mut pipe {
                            if p.write_all(line.as_bytes()).is_err() {
                                pipe = None;
                            }
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
                if pipe.is_none() {
                    pipe = OpenOptions::new().write(true).open(IN_PIPE).ok();
                    if let Some(p) = &mut pipe {
                        if latest.values().any(|l| p.write_all(l.as_bytes()).is_err()) {
                            pipe = None;
                        }
                    }
                }
            }
        });
        thread::spawn(move || loop {
            if let Ok(f) = File::open(CMD_PIPE) {
                for line in BufReader::new(f).lines() {
                    let Ok(line) = line else { break };
                    if let Some(c) = parse_cmd(&line) {
                        on_cmd(c);
                    }
                }
            }
            thread::sleep(RETRY);
        });
        Link { tx }
    }

    pub fn now(&self, now: &Now) {
        if let Some(line) = now_line(now) {
            let _ = self.tx.send(("now", line));
        }
    }

    pub fn window(&self, shown: bool, foreground: bool) {
        let line = json!({"type": "window", "shown": shown, "foreground": foreground});
        let _ = self.tx.send(("window", format!("{line}\n")));
    }
}

/// The `now` line, or None while nothing is loaded (the notch requires a title).
fn now_line(n: &Now) -> Option<String> {
    if n.title.is_empty() {
        return None;
    }
    let ms = |s: f64| (s.max(0.0) * 1000.0).round() as u64;
    let line = json!({
        "type": "now",
        // The site doesn't publish song ids to the OS; title + artist is stable per song.
        "id": format!("{}|{}", n.title, n.artist),
        "title": n.title,
        "artist": n.artist,
        "album": n.album,
        "duration_ms": ms(n.duration),
        "position_ms": ms(n.position),
        "playing": n.playing,
        "cover": n.cover,
    });
    Some(format!("{line}\n"))
}

/// One notch command line. Catalog picks are routed through Allegra's web player.
fn parse_cmd(line: &str) -> Option<Cmd> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    Some(match v.get("type")?.as_str()? {
        "play" => Cmd::Play,
        "pause" => Cmd::Pause,
        "toggle" => Cmd::Toggle,
        "next" => Cmd::Next,
        "prev" => Cmd::Prev,
        "seek" => Cmd::Seek(v.get("position_ms")?.as_f64()? / 1000.0),
        "open" => Cmd::Show,
        "enqueue" => {
            if v.get("mode")?.as_str()? != "now" {
                return None;
            }
            let id = crate::clean_catalog_ref(v.get("id")?.as_str()?)?;
            let mut queue = match v.get("queue") {
                Some(Value::Array(items)) => {
                    if items.len() > 50 {
                        return None;
                    }
                    items
                        .iter()
                        .map(|item| crate::clean_catalog_ref(item.as_str()?))
                        .collect::<Option<Vec<_>>>()?
                }
                None => vec![id.clone()],
                _ => return None,
            };
            queue.dedup();
            if !queue.contains(&id) {
                queue.insert(0, id.clone());
            }
            Cmd::PlayCatalog { id, queue }
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_line_has_every_field_the_notch_requires() {
        assert_eq!(now_line(&Now::default()), None);
        let n = Now {
            title: "Song".into(),
            artist: "Artist".into(),
            album: String::new(),
            cover: None,
            playing: true,
            duration: 200.5,
            position: 12.25,
        };
        let v: Value = serde_json::from_str(&now_line(&n).unwrap()).unwrap();
        assert_eq!(v["type"], "now");
        assert_eq!(v["id"], "Song|Artist");
        assert_eq!(v["album"], "");
        assert_eq!(v["duration_ms"], 200500);
        assert_eq!(v["position_ms"], 12250);
        assert_eq!(v["playing"], true);
        assert!(v["cover"].is_null());
    }

    #[test]
    fn parses_notch_commands() {
        assert_eq!(parse_cmd(r#"{"type":"toggle"}"#), Some(Cmd::Toggle));
        assert_eq!(parse_cmd(r#"{"type":"play","id":"x"}"#), Some(Cmd::Play));
        assert_eq!(
            parse_cmd(r#"{"type":"seek","position_ms":61500}"#),
            Some(Cmd::Seek(61.5))
        );
        assert_eq!(
            parse_cmd(r#"{"type":"open","target":"now"}"#),
            Some(Cmd::Show)
        );
        assert_eq!(
            parse_cmd(r#"{"type":"enqueue","id":"saavn:x","mode":"next"}"#),
            None
        );
        assert_eq!(
            parse_cmd(
                r#"{"type":"enqueue","id":"gaana:b","mode":"now","queue":["saavn:a","gaana:b"]}"#
            ),
            Some(Cmd::PlayCatalog {
                id: "gaana:b".into(),
                queue: vec!["saavn:a".into(), "gaana:b".into()],
            })
        );
        assert_eq!(parse_cmd("not json"), None);
    }
}
