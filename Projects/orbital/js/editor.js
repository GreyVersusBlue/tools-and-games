/* Orbital — the sector editor. Shares scope with game.js (state), render.js
   and input.js, and is loaded before game.js, which calls initEditor() once
   its state exists.

   The draft lives in the address bar, not in localStorage: every edit rewrites
   `#e=<code>` through replaceState, so a reload keeps the level and a share
   link is the same string under `#l=`. That is the whole reason there is no
   new save key here — the only storage Orbital has is still
   `orbital_progress_v2`, and locked decision #36 stays untouched.

   Every top-level name in this file starts `ed`, because these are plain
   scripts sharing one global lexical environment and a second `const view`
   anywhere in the folder is a SyntaxError that takes the whole page down. */

const EDC = OrbitalCode;

// Palette order is the order they read in the intro legend, so the two agree.
// The legend is planet, star, repulsor, asteroid, black hole, wormhole,
// booster; this list was written in a different order and the comment above it
// was simply false until 2026-09-14.
const ED_PLACERS = ["planet", "star", "repulse", "rock", "blackhole", "wormhole", "booster"];
const ED_LABEL = {
  move: "Move", planet: "Planet", star: "Star", rock: "Asteroid", repulse: "Repulsor",
  blackhole: "Black hole", wormhole: "Wormhole", booster: "Booster"
};
const ED_LINKS = ["a", "b", "c", "d"];
const ED_HANDLE = 20;              // world px: the smallest thing you can grab

let edOn = false;                  // the editor owns the screen
let edTesting = false;             // test flight from inside the editor
let edTool = "move";
let edSel = null;                  // { kind: "body"|"start"|"goal", body? }
let edDrag = null;                 // { kind, body, dx, dy }
let edSearch = null, edSearchTimer = 0;
let edReturn = 0;                  // campaign level to come back to

const edPanel = () => document.getElementById("edPanel");

// How much of the window the rail is holding. resize() in game.js reads this
// and shifts the playfield right by it, so the field is never behind the rail.
function edInset() {
  const p = document.getElementById("edPanel");
  return (p && p.classList.contains("show")) ? p.offsetWidth : 0;
}

// ---- hash ---------------------------------------------------------------
// `#e=` is a draft, `#l=` is a level to play. Both carry the same codec
// string; which letter it arrives under is the whole difference between
// "open this in the editor" and "play this".
function edSetHash(letter, code) {
  const h = "#" + letter + "=" + code;
  try { history.replaceState(null, "", h); } catch (e) { location.hash = h; }
}
// The editor writes the hash with replaceState, which does not fire
// hashchange — so an event here is somebody pasting a link into a tab that is
// already open, which is the ordinary way a shared level arrives.
function edOnHashChange() {
  const read = edReadHash();
  if (!read) return;
  if (read.error || EDC.validate(read.level).length) return;   // leave a bad paste alone
  if (read.how === "e") edEnter(read.level);
  else { edOn = false; edTesting = false; edPanel().classList.remove("show");
         edPanel().setAttribute("aria-hidden", "true");
         document.getElementById("edBack").classList.remove("show");
         resize(); loadShared(read.level); }
}

function edReadHash() {
  const h = (location.hash || "").replace(/^#/, "");
  const m = /^([el])=([\s\S]*)$/.exec(h);
  if (!m) return null;
  try { return { how: m[1], level: EDC.decode(m[2]) }; }
  catch (err) { return { how: m[1], error: err.message }; }
}
const edCode = () => EDC.encode(L);

// ---- entering and leaving ----------------------------------------------
function edEnter(src) {
  edReturn = edOn ? edReturn : curIndex;
  edOn = true; edTesting = false; edSel = null; edTool = "move";
  closeLevels();
  document.getElementById("introScrim").classList.remove("show");
  L = EDC.clean(src || EDC.blank());
  Object.assign(L, { pack: "Draft", packId: "draft", packLen: 1, localIdx: 0, key: null, ephemeral: true });
  curIndex = -1;
  bodies = L.bodies;                       // same array: an edit shows next frame
  edStop();
  resetProbe(); mode = "edit"; hideNext();
  trail = []; particles = [];
  document.getElementById("edName").value = L.name;
  document.getElementById("edSub").value = L.sub;
  edPanel().classList.add("show");
  edPanel().setAttribute("aria-hidden", "false");
  resize();
  document.getElementById("hint").style.opacity = "0";
  edTouch();
  edInspect();
  edStatus("Place bodies, drag them, then Check.", "");
}
function edLeave() {
  edStop();
  edOn = false; edTesting = false; edSel = null;
  edPanel().classList.remove("show");
  edPanel().setAttribute("aria-hidden", "true");
  resize();
  try { history.replaceState(null, "", location.pathname + location.search); }
  catch (e) { location.hash = ""; }
  loadLevel(Math.max(0, edReturn));
}

// Called after every change: the address bar IS the draft.
function edTouch() {
  edSetHash("e", edCode());
  edStop();
  document.getElementById("lvlName").textContent = L.name || "Untitled";
  document.getElementById("lvlSub").textContent = L.sub || "";
}

// ---- the draft as a playable level --------------------------------------
function edTest() {
  const bad = EDC.validate(L);
  if (bad.length) { edStatus(bad[0], "bad"); return; }
  edTesting = true;
  edPanel().classList.remove("show");
  resize();                                 // the flight gets the whole field
  resetProbe(); mode = "aim";
  attempts = 0; won = false; updateHUD();
  showHint("Test flight — drag to aim. Esc returns to the editor.");
  document.getElementById("edBack").classList.add("show");
}
function edBackToEdit() {
  edTesting = false;
  document.getElementById("edBack").classList.remove("show");
  edPanel().classList.add("show");
  resize();
  resetProbe(); mode = "edit"; hideNext();
  document.getElementById("hint").style.opacity = "0";
}

// ---- solvability --------------------------------------------------------
// The same search CI runs, at the same budget, stepped across frames so the
// tab stays alive. Equal budgets is the point: a draft the editor calls
// winnable is one test/physics.mjs would call winnable too.
function edStop() {
  if (edSearchTimer) clearTimeout(edSearchTimer);
  edSearchTimer = 0; edSearch = null;
  const b = document.getElementById("edCheck");
  if (b) b.textContent = "Check";
}
function edCheck() {
  if (edSearch) { edStop(); edStatus("Check cancelled.", ""); return; }
  const bad = EDC.validate(L);
  if (bad.length) { edStatus(bad.join(" "), "bad"); return; }
  const level = EDC.clean(L);
  edSearch = OrbitalPhysics.makeSearch(level);
  document.getElementById("edCheck").textContent = "Cancel";
  // A slice is 12 milliseconds of work, not a fixed number of trial launches,
  // and the next one is a setTimeout rather than a frame. Both of those are
  // measurements: under the software-rendered headless Chromium the suites use,
  // requestAnimationFrame fires 5 times a second against setTimeout's 244, so a
  // per-frame budget put a 5-second search at over a minute and looked like a
  // hang. Timing the slice instead of counting it also means a slow machine
  // yields as often as a fast one, just with less done in between.
  const now = () => (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  const tick = () => {
    if (!edSearch) return;
    const t0 = now();
    let r;
    do { r = edSearch.step(8); } while (!r.done && !r.shot && now() - t0 < 12);
    if (r.shot) {
      const deg = ((r.shot.angle * 180 / Math.PI) % 360 + 360) % 360;
      edStop();
      edStatus(`Winnable: ${deg.toFixed(0)}° at ${(r.shot.power * 100) | 0}% power, found in ${r.tried} trial launches.`, "good");
      return;
    }
    if (r.done) {
      edStop();
      edStatus(`No winning shot in ${r.tried} trial launches. That is the budget CI uses, not a proof — but it is the same answer the suite would give.`, "bad");
      return;
    }
    edStatus(`Checking… ${(r.progress * 100) | 0}%`, "");
    edSearchTimer = setTimeout(tick, 0);
  };
  edSearchTimer = setTimeout(tick, 0);
}

// ---- sharing ------------------------------------------------------------
function edShare() {
  const bad = EDC.validate(L);
  if (bad.length) { edStatus(bad.join(" "), "bad"); return; }
  const code = edCode();
  if (code.length > EDC.MAX_CODE) { edStatus(`This level is ${code.length} characters, over the ${EDC.MAX_CODE} a link may carry.`, "bad"); return; }
  edSetHash("l", code);
  const done = ok => {
    edStatus(ok ? `Link copied — ${code.length} characters, the whole level in it.`
                : `The link is in the address bar now — ${code.length} characters. Copy that line.`, "good");
    edSetHash("e", code);        // back to drafting; the share link is on the clipboard
  };
  if (navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(location.href).then(() => done(true), () => done(false));
  else done(false);
}

// ---- status line --------------------------------------------------------
function edStatus(msg, cls) {
  const el = document.getElementById("edStatus");
  el.textContent = msg; el.className = "ed-status " + (cls || "");
}

// ---- selection + inspector ----------------------------------------------
function edSelect(sel) { edSel = sel; edInspect(); }

function edRow(label, value) {
  const r = document.createElement("div"); r.className = "ed-row";
  const l = document.createElement("span"); l.className = "ed-lab"; l.textContent = label;
  const v = document.createElement("span"); v.className = "ed-val"; v.textContent = value;
  r.appendChild(l); r.appendChild(v);
  return { row: r, val: v };
}
function edSlider(label, min, max, step, get, set, fmt) {
  const { row, val } = edRow(label, (fmt || String)(get()));
  const input = document.createElement("input");
  input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = get();
  input.setAttribute("aria-label", label);
  input.addEventListener("input", () => {
    set(parseFloat(input.value));
    val.textContent = (fmt || String)(get());
    edTouch();
  });
  const wrap = document.createElement("div"); wrap.className = "ed-ctl";
  wrap.appendChild(row); wrap.appendChild(input);
  return wrap;
}

function edInspect() {
  const box = document.getElementById("edInsp");
  box.innerHTML = "";
  const deg = v => `${(v * 180 / Math.PI).toFixed(0)}°`;
  const px = v => `${Math.round(v)}`;

  if (!edSel) {
    const p = document.createElement("p"); p.className = "ed-none";
    p.textContent = edTool === "move"
      ? "Nothing selected. Click a body, the probe or the marker."
      : `Click the field to place a ${ED_LABEL[edTool].toLowerCase()}.`;
    box.appendChild(p);
    return;
  }

  const head = document.createElement("div"); head.className = "ed-selname";
  head.textContent = edSel.kind === "body" ? ED_LABEL[edSel.body.type]
                   : edSel.kind === "start" ? "Launch point" : "Marker";
  box.appendChild(head);

  if (edSel.kind === "goal") {
    box.appendChild(edSlider("Radius", EDC.RANGE.goalR[0], EDC.RANGE.goalR[1], 1,
      () => L.goal.r, v => L.goal.r = v, px));
    return;
  }
  if (edSel.kind === "start") {
    const p = document.createElement("p"); p.className = "ed-none";
    p.textContent = "Drag it. Every shot starts here.";
    box.appendChild(p);
    return;
  }

  const b = edSel.body;
  box.appendChild(edSlider("Radius", EDC.RANGE.r[0], EDC.RANGE.r[1], 1, () => b.r, v => b.r = v, px));
  if (EDC.GRAVITY[b.type])
    box.appendChild(edSlider("Mass", EDC.RANGE.mass[0], EDC.RANGE.mass[1], 2, () => b.mass, v => b.mass = v, px));
  if (b.type === "booster") {
    box.appendChild(edSlider("Heading", -3.14, 3.14, 0.02, () => b.dir, v => b.dir = v, deg));
    box.appendChild(edSlider("Kick", EDC.RANGE.boost[0], EDC.RANGE.boost[1], 5, () => b.boost, v => b.boost = v, px));
  }
  if (b.type === "wormhole") {
    const { row, val } = edRow("Link", b.link);
    const sel = document.createElement("div"); sel.className = "ed-links";
    ED_LINKS.forEach(id => {
      const btn = document.createElement("button");
      btn.textContent = id; btn.className = b.link === id ? "on" : "";
      btn.addEventListener("click", () => { b.link = id; val.textContent = id; edTouch(); edInspect(); });
      sel.appendChild(btn);
    });
    const wrap = document.createElement("div"); wrap.className = "ed-ctl";
    wrap.appendChild(row); wrap.appendChild(sel);
    box.appendChild(wrap);
    box.appendChild(edSlider("Exit turn", -3.14, 3.14, 0.02, () => b.exitTurn, v => b.exitTurn = v, deg));
  }

  // Orbit: switching it on parks the centre so the body does not jump — at
  // t = 0 an orbit of radius r about (x - r, y) puts it exactly where it was.
  const orb = document.createElement("button");
  orb.className = "ed-toggle" + (b.orbit ? " on" : "");
  orb.textContent = b.orbit ? "Orbiting" : "Make it orbit";
  orb.addEventListener("click", () => {
    if (b.orbit) delete b.orbit;
    else b.orbit = { cx: b.x - 140, cy: b.y, r: 140, speed: 0.9, a0: 0 };
    edTouch(); edInspect();
  });
  box.appendChild(orb);
  if (b.orbit) {
    box.appendChild(edSlider("Orbit radius", 20, EDC.RANGE.orbitR[1], 5,
      () => b.orbit.r, v => { b.orbit.r = v; edOrbitPose(b); }, px));
    box.appendChild(edSlider("Orbit speed", EDC.RANGE.orbitSpeed[0], EDC.RANGE.orbitSpeed[1], 0.05,
      () => b.orbit.speed, v => b.orbit.speed = v, v => v.toFixed(2)));
  }

  const del = document.createElement("button");
  // Plain "Delete": Space Mono has no glyph for U+232B and drew a tofu box.
  del.className = "ed-del"; del.textContent = "Delete";
  del.title = "Delete the selection (Backspace)";
  del.addEventListener("click", edDelete);
  box.appendChild(del);
}

// An orbiting body's x/y is derived at t=0 so the editor draws it where the
// flight will start it. Without this the sliders move the path and leave the
// dot behind.
function edOrbitPose(b) {
  if (!b.orbit) return;
  b.x = b.orbit.cx + Math.cos(b.orbit.a0) * b.orbit.r;
  b.y = b.orbit.cy + Math.sin(b.orbit.a0) * b.orbit.r;
}

function edDelete() {
  if (!edSel || edSel.kind !== "body") return;
  const i = L.bodies.indexOf(edSel.body);
  if (i >= 0) L.bodies.splice(i, 1);
  edSelect(null); edTouch();
}

// ---- pointer ------------------------------------------------------------
const edClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function edHit(w) {
  for (let i = L.bodies.length - 1; i >= 0; i--) {
    const b = L.bodies[i];
    if (Math.hypot(b.x - w.x, b.y - w.y) <= Math.max(b.r, ED_HANDLE)) return { kind: "body", body: b };
  }
  if (Math.hypot(L.start.x - w.x, L.start.y - w.y) <= ED_HANDLE) return { kind: "start" };
  if (Math.hypot(L.goal.x - w.x, L.goal.y - w.y) <= Math.max(L.goal.r, ED_HANDLE)) return { kind: "goal" };
  return null;
}

function edPlace(w) {
  if (L.bodies.length >= EDC.MAX_BODIES) {
    edStatus(`${EDC.MAX_BODIES} bodies is the limit a link may carry.`, "bad");
    return;
  }
  const d = EDC.DEFAULTS[edTool];
  const b = Object.assign({ type: edTool, x: Math.round(w.x), y: Math.round(w.y) }, d);
  // A second mouth on the same link is what makes a wormhole work at all, so
  // a fresh one takes the first link id that is not already a pair.
  if (edTool === "wormhole") {
    const count = {};
    L.bodies.forEach(o => { if (o.type === "wormhole") count[o.link] = (count[o.link] || 0) + 1; });
    b.link = ED_LINKS.find(id => (count[id] || 0) < 2) || "a";
  }
  L.bodies.push(b);
  edSelect({ kind: "body", body: b });
  edTouch();
}

function edDown(e) {
  if (!edOn || mode !== "edit") return;
  const w = toWorld(e.clientX, e.clientY);
  const hit = edHit(w);
  if (edTool !== "move" && !hit) { edPlace(w); e.preventDefault(); return; }
  if (!hit) { edSelect(null); return; }
  edSelect(hit);
  const at = hit.kind === "body" ? hit.body : hit.kind === "start" ? L.start : L.goal;
  edDrag = { sel: hit, dx: at.x - w.x, dy: at.y - w.y };
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
}
function edMove(e) {
  if (!edDrag) return;
  const w = toWorld(e.clientX, e.clientY);
  edPut(edDrag.sel, w.x + edDrag.dx, w.y + edDrag.dy);
  e.preventDefault();
}
function edUp() {
  if (!edDrag) return;
  edDrag = null; edTouch();
}
function edPut(sel, x, y) {
  const M = EDC.MARGIN;
  if (sel.kind === "start") {
    L.start.x = edClamp(x, 0, EDC.W); L.start.y = edClamp(y, 0, EDC.H);
    probe = { x: L.start.x, y: L.start.y };
  } else if (sel.kind === "goal") {
    L.goal.x = edClamp(x, 0, EDC.W); L.goal.y = edClamp(y, 0, EDC.H);
  } else {
    const b = sel.body;
    const nx = edClamp(x, -M, EDC.W + M), ny = edClamp(y, -M, EDC.H + M);
    if (b.orbit) { b.orbit.cx += nx - b.x; b.orbit.cy += ny - b.y; }
    b.x = nx; b.y = ny;
  }
}

// ---- keys ---------------------------------------------------------------
function edKey(e) {
  if (!edOn) return;
  if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (edTesting) {
    if (e.key === "Escape") { edBackToEdit(); e.preventDefault(); }
    return;
  }
  if (mode !== "edit") return;
  if (e.key === "Escape") { edLeave(); e.preventDefault(); return; }
  if (e.key === "Delete" || e.key === "Backspace") { edDelete(); e.preventDefault(); return; }
  if (e.key === "Enter") { edTest(); e.preventDefault(); return; }
  const step = e.shiftKey ? 10 : 2;
  const d = e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0]
          : e.key === "ArrowUp" ? [0, -step] : e.key === "ArrowDown" ? [0, step] : null;
  if (!d || !edSel) return;
  const at = edSel.kind === "body" ? edSel.body : edSel.kind === "start" ? L.start : L.goal;
  edPut(edSel, at.x + d[0], at.y + d[1]);
  edTouch(); e.preventDefault();
}

// ---- overlay drawing ----------------------------------------------------
// Called from frame() in render.js, after the bodies and before the probe.
function edDraw() {
  if (!edOn || mode !== "edit") return;
  const [x0, y0] = W2S(0, 0), [x1, y1] = W2S(EDC.W, EDC.H);

  ctx.save();
  ctx.strokeStyle = "rgba(120,132,200,.16)"; ctx.lineWidth = 1 * DPR;
  for (let gx = 100; gx < EDC.W; gx += 100) {
    const [sx] = W2S(gx, 0);
    ctx.beginPath(); ctx.moveTo(sx, y0); ctx.lineTo(sx, y1); ctx.stroke();
  }
  for (let gy = 100; gy < EDC.H; gy += 100) {
    const [, sy] = W2S(0, gy);
    ctx.beginPath(); ctx.moveTo(x0, sy); ctx.lineTo(x1, sy); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(140,160,255,.45)"; ctx.lineWidth = 1.5 * DPR;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

  // orbit paths, so a timed body's whole sweep is visible while you tune it
  ctx.setLineDash([5 * DPR, 7 * DPR]);
  ctx.strokeStyle = "rgba(140,160,255,.4)"; ctx.lineWidth = 1.2 * DPR;
  for (const b of L.bodies) {
    if (!b.orbit) continue;
    const [cx, cy] = W2S(b.orbit.cx, b.orbit.cy);
    ctx.beginPath(); ctx.arc(cx, cy, b.orbit.r * view.s, 0, 6.28); ctx.stroke();
  }
  // wormhole link letters
  ctx.setLineDash([]);
  ctx.font = `${12 * DPR}px "Space Mono", monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(102,255,224,.95)";
  for (const b of L.bodies) {
    if (b.type !== "wormhole") continue;
    const [sx, sy] = W2S(b.x, b.y);
    ctx.fillText(b.link, sx, sy);
  }
  ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";

  // selection ring
  if (edSel) {
    const at = edSel.kind === "body" ? edSel.body : edSel.kind === "start" ? L.start : L.goal;
    const r = edSel.kind === "body" ? Math.max(at.r, ED_HANDLE)
            : edSel.kind === "goal" ? Math.max(L.goal.r, ED_HANDLE) : ED_HANDLE;
    const [sx, sy] = W2S(at.x, at.y);
    ctx.setLineDash([6 * DPR, 5 * DPR]);
    ctx.strokeStyle = "rgba(255,207,122,.95)"; ctx.lineWidth = 2 * DPR;
    ctx.beginPath(); ctx.arc(sx, sy, (r + 8) * view.s, 0, 6.28); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// ---- wiring -------------------------------------------------------------
function edBuildTools() {
  const box = document.getElementById("edTools");
  box.innerHTML = "";
  ["move"].concat(ED_PLACERS).forEach(k => {
    const b = document.createElement("button");
    b.className = "ed-tool" + (edTool === k ? " on" : "");
    b.dataset.tool = k;
    b.textContent = ED_LABEL[k];
    if (k !== "move") b.style.setProperty("--tc", `var(--${k === "rock" ? "rock" : k})`);
    b.addEventListener("click", () => { edTool = k; edBuildTools(); edInspect(); });
    box.appendChild(b);
  });
}

function initEditor() {
  edBuildTools();
  cv.addEventListener("pointerdown", edDown);
  cv.addEventListener("pointermove", edMove);
  cv.addEventListener("pointerup", edUp);
  cv.addEventListener("pointercancel", edUp);
  window.addEventListener("keydown", edKey);
  window.addEventListener("hashchange", edOnHashChange);
  document.getElementById("edName").addEventListener("input", e => { L.name = e.target.value.slice(0, EDC.MAX_TEXT); edTouch(); });
  document.getElementById("edSub").addEventListener("input", e => { L.sub = e.target.value.slice(0, EDC.MAX_TEXT); edTouch(); });
  document.getElementById("edCheck").addEventListener("click", edCheck);
  document.getElementById("edTestBtn").addEventListener("click", edTest);
  document.getElementById("edShare").addEventListener("click", edShare);
  document.getElementById("edExit").addEventListener("click", edLeave);
  document.getElementById("edBack").addEventListener("click", edBackToEdit);
  document.getElementById("btnDesign").addEventListener("click", () => edEnter(null));
  document.getElementById("btnRemix").addEventListener("click", () => edEnter(L));
}
