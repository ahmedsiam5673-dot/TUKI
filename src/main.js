// Tuki UI: draws the character and reacts to events coming from the Rust bridge.
const { listen } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;

const $ = (id) => document.getElementById(id);
const island = $("island");
const canvas = $("tuki");
const ctx = canvas.getContext("2d");

const PILL = { w: 220, h: 64 };
const WIDE = { w: 440, h: 64 };
const CARD = { w: 440, h: 236 };

// ---- state -----------------------------------------------------------------
let mood = "sleep"; // sleep | idle | work | wait | done | alert
let moodUntil = 0;
let lastActivity = 0;
const queue = []; // pending permission requests

function setMood(m, label, detail, ms = 0) {
  mood = m;
  moodUntil = ms ? performance.now() + ms : 0;
  const cls = { sleep: "idle", idle: "idle", work: "working", wait: "waiting", done: "idle", alert: "alert" }[m];
  island.className = cls;
  $("state").textContent = label;
  $("detail").textContent = detail || "";
  resizeFor(detail ? WIDE : PILL);
}

let currentSize = null;
function resizeFor(size) {
  if (queue.length) size = CARD;
  if (currentSize === size) return;
  currentSize = size;
  invoke("set_size", { width: size.w, height: size.h });
}

function projectName(cwd) {
  if (!cwd) return "";
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

// ---- events ----------------------------------------------------------------
listen("tuki-activity", ({ payload: p }) => {
  lastActivity = performance.now();
  if (queue.length) return; // the approval card has priority
  const proj = projectName(p.cwd);
  switch (p.event) {
    case "PreToolUse":
      setMood("work", "Working", `${p.tool}${p.summary ? ": " + p.summary : ""}`.slice(0, 80));
      break;
    case "Stop":
      setMood("done", "Done", proj ? `${proj} finished` : "Finished", 5000);
      break;
    case "Notification":
      setMood("alert", "Needs you", (typeof p.message === "string" ? p.message : proj) || "", 8000);
      break;
    case "SessionStart":
      setMood("idle", "Hello", proj, 4000);
      break;
    default:
      break;
  }
});

listen("tuki-permission", ({ payload: p }) => {
  lastActivity = performance.now();
  queue.push(p);
  showCard();
});

listen("tuki-permission-done", ({ payload: p }) => {
  const i = queue.findIndex((q) => q.id === p.id);
  if (i >= 0) queue.splice(i, 1);
  showCard();
});

function showCard() {
  const card = $("card");
  if (!queue.length) {
    card.hidden = true;
    currentSize = null;
    setMood("idle", "Back to work", "", 2500);
    return;
  }
  const p = queue[0];
  card.hidden = false;
  $("card-tool").textContent = p.tool || "Permission";
  $("card-body").textContent = p.summary || "";
  $("card-cwd").textContent = p.cwd || "";
  $("card-count").textContent = queue.length > 1 ? `+${queue.length - 1} more waiting` : "";
  setMood("wait", "Waiting for you", "");
  resizeFor(CARD);
}

function answer(decision) {
  const p = queue[0];
  if (!p) return;
  invoke("decide", { id: p.id, decision });
  // The backend will also emit tuki-permission-done; remove now so the UI feels instant.
  queue.shift();
  showCard();
}
$("allow").onclick = () => answer("allow");
$("deny").onclick = () => answer("deny");
$("terminal").onclick = () => answer("ask");

// ---- Tuki, the character ---------------------------------------------------
// A teal bean with a little leaf on top. Drawn by hand with canvas paths.
const COLORS = {
  sleep: "#5fa793", idle: "#3ddbb0", work: "#3ddbb0", wait: "#ffb84d", done: "#7be39a", alert: "#ff8a6b",
};

function draw(t) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2 + 6);

  let bob = 0, squash = 1;
  if (mood === "idle") bob = Math.sin(t / 700) * 1.5;
  if (mood === "sleep") { bob = Math.sin(t / 1400) * 1; squash = 1 + Math.sin(t / 1400) * 0.02; }
  if (mood === "work") { bob = Math.abs(Math.sin(t / 160)) * -4; }
  if (mood === "wait") { bob = Math.sin(t / 260) * 2; }
  if (mood === "done") { bob = -Math.abs(Math.sin(t / 220)) * 10; }
  if (mood === "alert") { ctx.translate(Math.sin(t / 45) * 2, 0); }
  ctx.translate(0, bob);
  ctx.scale(1 / squash, squash);

  // leaf
  ctx.save();
  ctx.translate(2, -34);
  ctx.rotate(Math.sin(t / 500) * 0.15 - 0.2);
  ctx.fillStyle = "#8af0cf";
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.quadraticCurveTo(-4, -12, 12, -18);
  ctx.quadraticCurveTo(14, -2, 0, 4);
  ctx.fill();
  ctx.restore();

  // body: a bean
  ctx.fillStyle = COLORS[mood] || COLORS.idle;
  ctx.beginPath();
  ctx.ellipse(0, 0, 32, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  // belly highlight
  ctx.fillStyle = "rgba(255,255,255,.18)";
  ctx.beginPath();
  ctx.ellipse(-8, -12, 14, 8, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // eyes
  const blink = (t % 3800) < 140;
  ctx.fillStyle = "#0d1d19";
  ctx.strokeStyle = "#0d1d19";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  const ex = 11, ey = -2;
  if (mood === "sleep" || blink) {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * ex, ey + 2, 5, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  } else if (mood === "done") {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * ex, ey + 4, 5, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
    }
  } else {
    const look = mood === "work" ? Math.sin(t / 300) * 2 : 0;
    const r = mood === "alert" ? 6 : 5;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * ex + look, ey, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // mouth
  ctx.beginPath();
  if (mood === "done" || mood === "idle" || mood === "work") {
    ctx.arc(0, 8, 6, 0.1 * Math.PI, 0.9 * Math.PI);
  } else if (mood === "wait") {
    ctx.arc(0, 14, 4, 0, Math.PI * 2);
  } else if (mood === "alert") {
    ctx.moveTo(-6, 14); ctx.lineTo(6, 14);
  } else {
    ctx.arc(0, 11, 2, 0, Math.PI * 2);
  }
  ctx.stroke();

  // sleeping Zs
  if (mood === "sleep") {
    ctx.fillStyle = "#8fa5a0";
    ctx.font = "bold 14px sans-serif";
    const k = (t / 900) % 1;
    ctx.globalAlpha = 1 - k;
    ctx.fillText("z", 26, -22 - k * 12);
  }
  ctx.restore();
}

function frame(t) {
  if (moodUntil && t > moodUntil && !queue.length) {
    setMood("idle", "Idle", "");
  }
  if (!queue.length && mood === "idle" && lastActivity && t - lastActivity > 30000) {
    setMood("sleep", "Sleeping", "");
  }
  draw(t);
  requestAnimationFrame(frame);
}

setMood("sleep", "Sleeping", "");
requestAnimationFrame(frame);
