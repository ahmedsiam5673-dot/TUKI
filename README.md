# Tuki

A tiny companion that sits at the top of your screen and watches your Claude Code sessions.
It shows what Claude is doing, and lets you **Allow / Deny** permission requests with one click.
Everything stays on your PC: a loopback socket (`127.0.0.1:47831`), no account, no network.

Made for personal use. Name, character and icon are original.

## Quick start (Windows)

Double-click **`Start-Tuki.bat`**. The first run installs Node.js, Rust and the C++ Build Tools if missing (Windows asks for permission once), builds Tuki, adds the Claude Code hooks (with a backup) and starts it. Later runs just start Tuki.

## Build by hand on Windows 10/11

Install once:

1. [Rust](https://rustup.rs) (default MSVC toolchain)
2. [Node.js](https://nodejs.org) 20+
3. Visual Studio **Build Tools** with the "Desktop development with C++" workload
4. WebView2 (already on Windows 11 and recent Windows 10)

Then, in PowerShell inside this folder:

```powershell
npm install
npm run pack            # builds the hook relay + the app; installers land in src-tauri\target\release\bundle\
npm run install-hooks   # backs up ~/.claude/settings.json, then adds Tuki's hooks
```

Run the installer from `bundle\nsis\` (or `bundle\msi\`), start Tuki, and start a Claude Code session.
To try it without installing: `npm run dev`.

Check what `install-hooks` will change first with `node scripts/install-hooks.mjs --dry-run`.
Remove everything again with `npm run uninstall-hooks`.

## How it works

```
Claude Code --hook JSON--> tuki-hook.exe --TCP 127.0.0.1:47831--> Tuki (Rust) --events--> UI
                                ^                                              |
                                +---------- allow / deny (PermissionRequest) --+
```

- `hook/`: tiny relay. If Tuki is not running it exits instantly and prints nothing, so Claude Code is never blocked.
- `src-tauri/src/bridge.rs`: socket server + pending permission requests (110 s timeout, then Claude Code asks in the terminal as usual).
- `src/`: the UI and the character, drawn on a canvas.
- "Ask in terminal" hands the decision back to Claude Code's normal prompt.

## Notes

- Any local process can write to the loopback port. That is fine for a single-user PC, but do not expose the port.
- Tuki sits at the top centre of the monitor it opens on. Quit it from the tray icon.
