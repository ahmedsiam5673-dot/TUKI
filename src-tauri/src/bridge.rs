// Loopback bridge: receives hook events from `tuki-hook` and, for permission
// requests, waits for the user's decision from the UI.
//
// Kept free of Tauri types so it can be tested on its own.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const ADDR: &str = "127.0.0.1:47831";
const PERMISSION_TIMEOUT: Duration = Duration::from_secs(110);

#[derive(Default)]
pub struct Pending {
    map: Mutex<HashMap<String, Sender<String>>>,
    counter: AtomicU64,
}

impl Pending {
    fn register(&self) -> (String, std::sync::mpsc::Receiver<String>) {
        let id = format!("p{}", self.counter.fetch_add(1, Ordering::Relaxed) + 1);
        let (tx, rx) = channel();
        self.map.lock().unwrap().insert(id.clone(), tx);
        (id, rx)
    }

    fn forget(&self, id: &str) {
        self.map.lock().unwrap().remove(id);
    }

    /// Called from the UI. Returns false if the request is gone (already answered or timed out).
    pub fn resolve(&self, id: &str, decision: &str) -> bool {
        match self.map.lock().unwrap().remove(id) {
            Some(tx) => tx.send(decision.to_string()).is_ok(),
            None => false,
        }
    }
}

/// Builds the JSON line Claude Code expects for a PermissionRequest hook.
/// Returns an empty string for "ask", which makes Claude Code fall back to its own prompt.
pub fn permission_reply(decision: &str) -> String {
    match decision {
        "allow" => json!({"hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {"behavior": "allow"}
        }})
        .to_string(),
        "deny" => json!({"hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {"behavior": "deny", "message": "Denied from Tuki"}
        }})
        .to_string(),
        _ => String::new(),
    }
}

/// Short human summary of a tool call, for the approval card.
pub fn summarize(tool: &str, input: &Value) -> String {
    let pick = |k: &str| input.get(k).and_then(|v| v.as_str()).map(|s| s.to_string());
    let s = match tool {
        "Bash" => pick("command"),
        "Read" | "Write" | "Edit" | "MultiEdit" => pick("file_path"),
        "Glob" | "Grep" => pick("pattern"),
        "WebFetch" => pick("url"),
        "WebSearch" => pick("query"),
        _ => None,
    };
    let s = s.unwrap_or_else(|| input.to_string());
    if s.chars().count() > 400 {
        let cut: String = s.chars().take(400).collect();
        format!("{cut}…")
    } else {
        s
    }
}

fn handle<F>(stream: TcpStream, pending: &Pending, emit: &F)
where
    F: Fn(&str, Value),
{
    let mut writer = match stream.try_clone() {
        Ok(w) => w,
        Err(_) => return,
    };
    let mut line = String::new();
    if BufReader::new(stream).read_line(&mut line).is_err() {
        return;
    }
    let event: Value = match serde_json::from_str(line.trim()) {
        Ok(v) => v,
        Err(_) => return,
    };

    let name = event.get("hook_event_name").and_then(|v| v.as_str()).unwrap_or("");
    let session = event.get("session_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let cwd = event.get("cwd").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let tool = event.get("tool_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let input = event.get("tool_input").cloned().unwrap_or(Value::Null);

    if name == "PermissionRequest" {
        let (id, rx) = pending.register();
        emit(
            "tuki-permission",
            json!({
                "id": id, "session": session, "cwd": cwd,
                "tool": tool, "summary": summarize(&tool, &input)
            }),
        );
        let decision = rx.recv_timeout(PERMISSION_TIMEOUT).unwrap_or_else(|_| "ask".into());
        pending.forget(&id);
        emit("tuki-permission-done", json!({ "id": id, "decision": decision }));
        let _ = writer.write_all(permission_reply(&decision).as_bytes());
        let _ = writer.write_all(b"\n");
        return;
    }

    emit(
        "tuki-activity",
        json!({
            "event": name, "session": session, "cwd": cwd, "tool": tool,
            "summary": if tool.is_empty() { String::new() } else { summarize(&tool, &input) },
            "message": event.get("message").cloned().unwrap_or(Value::Null)
        }),
    );
}

/// Starts the listener on a background thread. Each connection gets its own thread
/// because a permission request can block for a long time.
pub fn serve<F>(addr: &str, pending: Arc<Pending>, emit: F) -> std::io::Result<()>
where
    F: Fn(&str, Value) + Send + Sync + 'static,
{
    let listener = TcpListener::bind(addr)?;
    let emit = Arc::new(emit);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let pending = pending.clone();
            let emit = emit.clone();
            std::thread::spawn(move || handle(stream, &pending, &*emit));
        }
    });
    Ok(())
}
