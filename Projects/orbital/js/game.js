/* Orbital — game orchestrator. Owns state + DOM, flattens the registered
   level packs, drives the loop, and wires the UI. Loaded last, after
   physics.js, the level packs, render.js and input.js. */
"use strict";

// physics constants (single source of truth)
const { MAXSPEED, MAXDRAG, SUBSTEPS, W, H, PAD } = OrbitalPhysics;

// ---- build the level list from every registered pack ----
const PACKS = (globalThis.OrbitalPacks || []);
const LEVELS = [];
PACKS.forEach(p => p.levels.forEach((lv, i) => {
  LEVELS.push(Object.assign({}, lv, {
    pack: p.name, packId: p.id, packLen: p.levels.length, localIdx: i, key: p.id + "#" + i
  }));
}));

// ---- persistence (by stable key, so new packs never shift old progress) ----
const SAVE_KEY = "orbital_progress_v2";
function loadSave() {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY)); if (v) return v;
    const old = JSON.parse(localStorage.getItem("orbital_progress_v1") || "null");
    if (old && typeof old === "object") {           // migrate old numeric saves
      const mig = {}; for (const k in old) if (/^\d+$/.test(k)) mig["basics#" + k] = old[k];
      return mig;
    }
  } catch (e) {}
  return {};
}
function writeSave(o) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(o)); } catch (e) {} }
let progress = loadSave();
const starsFor = a => a <= 1 ? 3 : a <= 3 ? 2 : 1;
function starStr(n) { let s = ""; for (let i = 0; i < 3; i++) s += i < n ? "★" : "☆"; return s; }
const starMarkup = n => starStr(n).replace(/☆/g, '<span class="off">☆</span>');

// ---- canvas / view ----
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
let DPR = 1, view = { s: 1, ox: 0, oy: 0 };
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  cv.width = Math.floor(w * DPR); cv.height = Math.floor(h * DPR);
  const s = Math.min(w / W, h / H);
  view = { s, ox: (w - W * s) / 2, oy: (h - H * s) / 2 };
}
const toWorld = (px, py) => ({ x: (px - view.ox) / view.s, y: (py - view.oy) / view.s });

// ---- state ----
let L, curIndex = 0, bodies = [], probe = null, vel = null, flyState = null;
let trail = [], particles = [];
let mode = "aim", aim = null, plan = [];
let attempts = 0, tSim = 0, shake = 0, won = false, planPow = 0, planAng = 0;
const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;
const COARSE = matchMedia("(pointer:coarse)").matches;
const stars = Array.from({ length: 160 }, () => ({ x: Math.random() * W, y: Math.random() * H, z: Math.random(), tw: Math.random() * 6.28 }));

// ---- level control ----
function loadLevel(gi) {
  curIndex = gi; L = LEVELS[gi];
  bodies = L.bodies.map(b => Object.assign({}, b));
  attempts = 0; won = false;
  resetProbe(); mode = "aim"; hideNext();
  document.getElementById("packName").textContent = L.pack;
  document.getElementById("lvlNum").textContent = String(L.localIdx + 1).padStart(2, "0");
  document.getElementById("lvlTotal").textContent = String(L.packLen);
  document.getElementById("lvlName").textContent = L.name;
  document.getElementById("lvlSub").textContent = L.sub || "";
  updateHUD();
  showHint(gi === 0 ? "Drag anywhere to aim · release to launch"
                    : "Read the flight plan — thread the wells");
}
function resetProbe() {
  probe = { x: L.start.x, y: L.start.y }; vel = { x: 0, y: 0 }; flyState = null;
  trail = []; plan = []; aim = null; tSim = 0; mode = "aim";
  if (typeof hideNext === "function") hideNext();
}
function updateHUD() {
  document.getElementById("attempts").textContent = attempts;
  const best = progress[L.key];
  document.getElementById("hudStars").innerHTML = best ? starMarkup(starsFor(best)) : '<span class="off">☆☆☆</span>';
}
let hintTimer = null;
function showHint(t, ttl = 0) {
  const el = document.getElementById("hint"); el.textContent = t; el.style.opacity = "1";
  if (hintTimer) clearTimeout(hintTimer);
  if (ttl) hintTimer = setTimeout(() => el.style.opacity = "0", ttl);
}
function flash(text, cls) {
  const el = document.getElementById("flash"); el.textContent = text; el.className = "flash " + cls;
  el.style.opacity = "1"; el.style.transition = "none"; el.style.transform = "translate(-50%,-50%) scale(.8)";
  requestAnimationFrame(() => {
    el.style.transition = "opacity .5s, transform .5s";
    el.style.transform = "translate(-50%,-50%) scale(1)";
    setTimeout(() => el.style.opacity = "0", 900);
  });
}

// ---- launch flow (preview + live share OrbitalPhysics) ----
function computePlan() {
  if (!aim) { plan = []; return; }
  const len = Math.hypot(aim.dx, aim.dy);
  planPow = Math.min(len / MAXDRAG, 1);
  planAng = Math.atan2(aim.dy, aim.dx);
  const sp = planPow * MAXSPEED;
  const r = OrbitalPhysics.solve(probe, { x: Math.cos(planAng) * sp, y: Math.sin(planAng) * sp }, L);
  plan = r.pts; plan.outcome = r.outcome;
}
function launch() {
  if (!aim || planPow < 0.02) return;
  const sp = planPow * MAXSPEED;
  vel = { x: Math.cos(planAng) * sp, y: Math.sin(planAng) * sp };
  flyState = { x: probe.x, y: probe.y, vx: vel.x, vy: vel.y, t: 0, lock: 0, jumped: false };
  mode = "fly"; attempts++; updateHUD(); trail = []; tSim = 0;
  document.getElementById("hint").style.opacity = "0";
}
function stepFly() {
  for (let s = 0; s < SUBSTEPS; s++) {
    const o = OrbitalPhysics.substep(flyState, L);
    probe.x = flyState.x; probe.y = flyState.y; tSim = flyState.t;
    if (o === "WIN") return win();
    if (o === "CRASH") return fail("CRASH");
    if (o === "OUT") return fail("OUT");
  }
  trail.push({ x: probe.x, y: probe.y });
  if (trail.length > 140) trail.shift();
}
function win() {
  mode = "done"; won = true;
  const st = starsFor(attempts);
  if (!progress[L.key] || attempts < progress[L.key]) { progress[L.key] = attempts; writeSave(progress); }
  updateHUD(); burst(L.goal.x, L.goal.y, "goal");
  flash("MARKER REACHED", "win");
  document.getElementById("hint").style.opacity = "0";
  const nb = document.getElementById("btnNext");
  nb.textContent = curIndex >= LEVELS.length - 1 ? "Sector map ▶" : "Next sector ▶";
  nb.classList.add("show");
}
function hideNext() { document.getElementById("btnNext").classList.remove("show"); }
function advance() {
  hideNext();
  if (curIndex < LEVELS.length - 1) loadLevel(curIndex + 1); else openLevels();
}
function fail(kind) {
  mode = "done";
  burst(probe.x, probe.y, "warm");
  if (!reduced) shake = 10;
  flash(kind === "CRASH" ? "IMPACT" : "LOST TO SPACE", "fail");
  setTimeout(() => { if (mode === "done" && !won) resetProbe(); }, 720);
}

// ---- particles ----
function burst(x, y, kind) {
  const n = reduced ? 14 : 34;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, s = 1 + Math.random() * 4.5;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, kind });
  }
}
function stepParticles() {
  for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy *= 0.95; p.life -= 0.025; }
  particles = particles.filter(p => p.life > 0);
}

// ---- sector map (grouped by pack) ----
function buildGrid() {
  const grid = document.getElementById("lvlGrid"); grid.innerHTML = "";
  let gi = 0;
  PACKS.forEach(p => {
    const h = document.createElement("div"); h.className = "pack-h";
    h.innerHTML = `<span>${p.name}</span><span class="pk-blurb">${p.blurb || ""}</span>`;
    grid.appendChild(h);
    p.levels.forEach((lv, li) => {
      const idx = gi;
      const prevKey = idx > 0 ? LEVELS[idx - 1].key : null;
      const unlocked = idx === 0 || progress[prevKey] != null || progress[LEVELS[idx].key] != null;
      const cell = document.createElement(unlocked ? "button" : "div");
      cell.className = "cell" + (unlocked ? "" : " locked");
      const best = progress[LEVELS[idx].key];
      cell.innerHTML = `<span class="n">${String(li + 1).padStart(2, "0")}</span>
        <span class="st">${best ? starMarkup(starsFor(best)) : "&nbsp;"}</span>`;
      if (unlocked) cell.addEventListener("click", () => { closeLevels(); loadLevel(idx); });
      grid.appendChild(cell);
      gi++;
    });
  });
}
const lvlScrim = document.getElementById("lvlScrim");
function openLevels() { buildGrid(); lvlScrim.classList.add("show"); }
function closeLevels() { lvlScrim.classList.remove("show"); }
function toggleLevels() { lvlScrim.classList.contains("show") ? closeLevels() : openLevels(); }

// ---- init ----
document.getElementById("btnNext").addEventListener("click", advance);
document.getElementById("btnLevels").addEventListener("click", openLevels);
document.getElementById("btnClose").addEventListener("click", closeLevels);
document.getElementById("btnReset").addEventListener("click", () => { if (mode !== "fly") { resetProbe(); mode = "aim"; } });
document.getElementById("btnWipe").addEventListener("click", () => {
  if (!confirm("Erase all saved progress? Every sector's stars will be reset. This can't be undone.")) return;
  progress = {}; writeSave(progress); buildGrid(); updateHUD();
});
document.getElementById("btnStart").addEventListener("click", () => {
  document.getElementById("introScrim").classList.remove("show"); loadLevel(0);
});
lvlScrim.addEventListener("click", e => { if (e.target === lvlScrim) closeLevels(); });

window.addEventListener("resize", () => { resize(); checkOrient(); });

resize();
initInput();
loadLevel(0);              // set up level 0 behind the intro
requestAnimationFrame(frame);
