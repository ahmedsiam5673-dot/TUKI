// tuki-hook: tiny relay between Claude Code hooks and the Tuki app.
//
// Claude Code runs this for every hook event and passes the event JSON on stdin.
// We forward it to Tuki over a loopback TCP socket. For PermissionRequest events
// we wait for the user's click and print Tuki's answer on stdout.
//
// If Tuki is not running, we exit 0 immediately and print nothing, so Claude Code
// is never blocked.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

const ADDR: &str = "127.0.0.1:47831";

fn main() {
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        return;
    }
    let value: serde_json::Value = match serde_json::from_str(&input) {
        Ok(v) => v,
        Err(_) => return,
    };
    let wants_answer = value.get("hook_event_name").and_then(|v| v.as_str()) == Some("PermissionRequest");

    let addr: SocketAddr = ADDR.parse().unwrap();
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(300)) {
        Ok(s) => s,
        Err(_) => return, // Tuki is not running
    };

    // One compact JSON line.
    let mut line = serde_json::to_string(&value).unwrap_or_default();
    line.push('\n');
    if stream.write_all(line.as_bytes()).is_err() {
        return;
    }
    let _ = stream.flush();

    if !wants_answer {
        return;
    }

    // Wait for the answer (Tuki times out by itself).
    let _ = stream.set_read_timeout(Some(Duration::from_secs(125)));
    let mut reply = String::new();
    if BufReader::new(stream).read_line(&mut reply).is_ok() {
        let reply = reply.trim();
        if !reply.is_empty() {
            println!("{reply}");
        }
    }
}
