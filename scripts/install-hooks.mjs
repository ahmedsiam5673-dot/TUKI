// Installs (or removes) Tuki's Claude Code hooks.
//
//   node scripts/install-hooks.mjs              install
//   node scripts/install-hooks.mjs --dry-run    show what would change, write nothing
//   node scripts/install-hooks.mjs --uninstall  remove Tuki's hooks again
//
// It backs up ~/.claude/settings.json first and never touches hooks that are not Tuki's.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const dry = args.has("--dry-run");
const uninstall = args.has("--uninstall");

const home = os.homedir();
const settingsPath = path.join(home, ".claude", "settings.json");
const exeName = process.platform === "win32" ? "tuki-hook.exe" : "tuki-hook";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = path.join(root, "hook", "target", "release", exeName);
const installed = path.join(home, ".tuki", "bin", exeName);
const MARK = "tuki-hook";

// Events Tuki listens to. PermissionRequest is the one that waits for your click.
const EVENTS = ["SessionStart", "PreToolUse", "Notification", "Stop", "PermissionRequest"];

function readSettings() {
  if (!fs.existsSync(settingsPath)) return {};
  const raw = fs.readFileSync(settingsPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Cannot parse ${settingsPath}: ${e.message}\nFix or remove it, then run again. Nothing was changed.`);
    process.exit(1);
  }
}

const isTuki = (entry) => (entry.hooks || []).some((h) => typeof h.command === "string" && h.command.includes(MARK));

const settings = readSettings();
const before = JSON.stringify(settings, null, 2);
settings.hooks ??= {};

for (const ev of EVENTS) {
  const list = (settings.hooks[ev] ??= []);
  settings.hooks[ev] = list.filter((e) => !isTuki(e)); // remove old Tuki entries (idempotent)
  if (!uninstall) {
    const command = process.platform === "win32" ? `"${installed}"` : `'${installed}'`;
    settings.hooks[ev].push({ matcher: "", hooks: [{ type: "command", command }] });
  }
  if (settings.hooks[ev].length === 0) delete settings.hooks[ev];
}
if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

const after = JSON.stringify(settings, null, 2);
if (before === after) {
  console.log("Nothing to change.");
  process.exit(0);
}

// Tiny line diff, enough to review.
const a = before.split("\n"), b = after.split("\n");
const aset = new Set(a), bset = new Set(b);
console.log(`Changes to ${settingsPath}:`);
for (const l of a) if (!bset.has(l)) console.log("  - " + l);
for (const l of b) if (!aset.has(l)) console.log("  + " + l);

if (dry) {
  console.log("\n(dry run, nothing written)");
  process.exit(0);
}

if (!uninstall) {
  if (!fs.existsSync(built)) {
    console.error(`\nHook binary not found at ${built}\nRun "npm run hook" first.`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.copyFileSync(built, installed);
  if (process.platform !== "win32") fs.chmodSync(installed, 0o755);
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
if (fs.existsSync(settingsPath)) {
  const backup = `${settingsPath}.tuki-backup-${Date.now()}`;
  fs.copyFileSync(settingsPath, backup);
  console.log(`\nBackup: ${backup}`);
}
fs.writeFileSync(settingsPath, after + "\n");
console.log(uninstall ? "Tuki hooks removed." : `Tuki hooks installed (binary: ${installed}).`);
