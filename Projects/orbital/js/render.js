/* Orbital — rendering. All canvas drawing + the frame loop.
   Shares scope with game.js (state) and input.js; loaded before game.js,
   which owns the state and starts the loop. */

const COLOR = {
  planet: "#63d8ff", star: "#ffb257", rock: "#9aa0b8", repulse: "#ff5ec8",
  blackhole: "#7c5cff", wormhole: "#66ffe0", booster: "#ffe066"
};

function W2S(x, y) { return [view.ox + x * view.s, view.oy + y * view.s]; }

function glowCircle(x, y, r, color, glow) {
  const [sx, sy] = W2S(x, y), R = r * view.s;
  const g = ctx.createRadialGradient(sx, sy, R * 0.2, sx, sy, R * glow);
  g.addColorStop(0, color);
  g.addColorStop(0.5, color.replace(/[\d.]+\)$/, "0.18)"));
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, R * glow, 0, 6.28); ctx.fill();
}

function drawBg(t) {
  const g = ctx.createLinearGradient(0, 0, 0, cv.height);
  g.addColorStop(0, "#07070f"); g.addColorStop(.5, "#0b0f22"); g.addColorStop(1, "#0e1430");
  ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
  for (const [cx, cy, rr, col] of [[0.28, 0.30, 0.5, "rgba(80,60,180,.10)"], [0.75, 0.72, 0.55, "rgba(20,120,150,.10)"]]) {
    const [sx, sy] = [cx * cv.width, cy * cv.height], R = rr * Math.max(cv.width, cv.height);
    const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
    rg.addColorStop(0, col); rg.addColorStop(1, "transparent");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, cv.width, cv.height);
  }
  for (const s of stars) {
    const [sx, sy] = W2S(s.x, s.y);
    const tw = reduced ? 0.7 : (0.5 + 0.5 * Math.sin(t * 0.001 + s.tw));
    ctx.globalAlpha = (0.25 + 0.6 * s.z) * tw; ctx.fillStyle = "#cdd6ff";
    const r = (0.6 + s.z * 1.4) * DPR; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.28); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* The body sheet (tools/blender/, #717 to #720). One frame per COLOR key, each
   a drawBody without its glow at spin 0 and dir 0; the atlas gives the frame's
   box, its anchor and r, the body's radius in frame pixels. game.js waits on
   loadSprites() before the first frame, and a sheet that will not load stops
   the game with the reason on screen: there are no gradients to fall back to
   (#646, #735). */
const SPRITES = { src: "assets/sprites/bodies", img: null, atlas: null };

function loadSprites() {
  const img = new Image();
  const pixels = new Promise((ok, no) => {
    img.onload = () => ok();
    img.onerror = () => no(new Error(SPRITES.src + ".png did not load"));
  });
  img.src = SPRITES.src + ".png";
  const atlas = fetch(SPRITES.src + ".json").then(r => {
    if (!r.ok) throw new Error(SPRITES.src + ".json answered " + r.status);
    return r.json();
  });
  return Promise.all([pixels, atlas]).then(([, a]) => {
    for (const type in COLOR) if (!a[type]) throw new Error(SPRITES.src + ".json has no frame for " + type);
    SPRITES.img = img; SPRITES.atlas = a;
  });
}

// The glow each body wears: its rgba and its reach in radii. The frame carries
// none of it (#720), so drawBody lays it over the frame. The black hole is the
// exception and keeps its glow behind: over the frame it turned the core
// violet (#736).
const GLOW = {
  planet: ["rgba(99,216,255,0.5)", 2.4], star: ["rgba(255,178,87,0.5)", 3.4],
  rock: ["rgba(154,160,184,0.5)", 2.4], repulse: ["rgba(255,94,200,0.5)", 2.4],
  blackhole: ["rgba(124,92,255,0.55)", 4.2], wormhole: ["rgba(102,255,224,0.5)", 2.2],
  booster: ["rgba(255,224,102,0.4)", 2.0]
};

// How far a body's frame is turned (#737). The accretion rings and the
// wormhole's dashes turn with the clock, the booster points along its dir, and
// the four gravity bodies are lit from one side and stay put.
function bodyTurn(b, t) {
  const spin = reduced ? 0 : t * 0.001;
  return b.type === "blackhole" ? spin * 2 : b.type === "wormhole" ? spin * 3
       : b.type === "booster" ? b.dir : 0;
}

function drawBody(b, t) {
  const [sx, sy] = W2S(b.x, b.y), f = SPRITES.atlas[b.type];
  const k = (b.r * view.s) / f.r, turn = bodyTurn(b, t);
  const under = b.type === "blackhole";
  if (under) glowCircle(b.x, b.y, b.r, GLOW[b.type][0], GLOW[b.type][1]);
  ctx.save(); ctx.translate(sx, sy); if (turn) ctx.rotate(turn);
  ctx.drawImage(SPRITES.img, f.x, f.y, f.w, f.h, -f.ax * k, -f.ay * k, f.w * k, f.h * k);
  ctx.restore();
  if (!under) glowCircle(b.x, b.y, b.r, GLOW[b.type][0], GLOW[b.type][1]);
}

function drawGoal(t) {
  const [sx, sy] = W2S(L.goal.x, L.goal.y), R = L.goal.r * view.s;
  const pulse = reduced ? 1 : (1 + 0.06 * Math.sin(t * 0.004));
  glowCircle(L.goal.x, L.goal.y, L.goal.r, "rgba(93,255,166,0.5)", 2.2 * pulse);
  ctx.strokeStyle = "rgba(93,255,166,.95)"; ctx.lineWidth = 2.4 * DPR;
  ctx.beginPath(); ctx.arc(sx, sy, R * pulse, 0, 6.28); ctx.stroke();
  ctx.strokeStyle = "rgba(93,255,166,.4)"; ctx.lineWidth = 1.2 * DPR;
  ctx.beginPath(); ctx.arc(sx, sy, R * 0.62, 0, 6.28); ctx.stroke();
  ctx.strokeStyle = "rgba(93,255,166,.85)"; ctx.lineWidth = 2 * DPR;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + (reduced ? 0 : t * 0.0006);
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(a) * R * 1.15, sy + Math.sin(a) * R * 1.15);
    ctx.lineTo(sx + Math.cos(a) * R * 1.5, sy + Math.sin(a) * R * 1.5); ctx.stroke();
  }
}

function drawPlan() {
  if (mode !== "aim" || !plan.length) return;
  const good = plan.outcome === "WIN";
  for (let i = 1; i < plan.length; i++) {
    const [x, y] = W2S(plan[i].x, plan[i].y);
    const f = i / plan.length;
    ctx.globalAlpha = (1 - f) * 0.9 + 0.08;
    ctx.fillStyle = good ? "rgba(93,255,166,1)" : "rgba(180,200,255,0.9)";
    const r = (good ? 2.2 : 1.8) * DPR * (1 - 0.4 * f);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const len = Math.hypot(aim.dx, aim.dy), ux = aim.dx / (len || 1), uy = aim.dy / (len || 1);
  const [px, py] = W2S(probe.x, probe.y);
  const tip = Math.min(len, MAXDRAG) * view.s;
  const grad = ctx.createLinearGradient(px, py, px + ux * tip, py + uy * tip);
  grad.addColorStop(0, "rgba(255,246,224,.9)"); grad.addColorStop(1, "rgba(255,207,122,.25)");
  ctx.strokeStyle = grad; ctx.lineWidth = 3 * DPR; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ux * tip, py + uy * tip); ctx.stroke();
  const pw = Math.min(len / MAXDRAG, 1);
  const label = `Δv ${(pw * 100) | 0}%`, fs = (COARSE ? 15 : 11) * DPR;
  const lx = px + ux * tip + 8 * DPR, ly = py + uy * tip + 4 * DPR;
  ctx.font = `${fs}px "Space Mono", monospace`; ctx.textBaseline = "middle";
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(6,8,18,.6)"; ctx.fillRect(lx - 4 * DPR, ly - fs * 0.6, tw + 8 * DPR, fs * 1.2);
  ctx.fillStyle = "rgba(255,207,122,.95)"; ctx.fillText(label, lx, ly);
  ctx.textBaseline = "alphabetic";
}

function drawTrail() {
  for (let i = 1; i < trail.length; i++) {
    const [x, y] = W2S(trail[i].x, trail[i].y);
    ctx.globalAlpha = (i / trail.length) * 0.8; ctx.fillStyle = "rgba(255,246,224,0.9)";
    ctx.beginPath(); ctx.arc(x, y, 1.9 * DPR, 0, 6.28); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawProbe() {
  const [sx, sy] = W2S(probe.x, probe.y);
  glowCircle(probe.x, probe.y, 10, "rgba(255,246,224,0.6)", 2.2);
  ctx.fillStyle = "#fff6e0"; ctx.beginPath(); ctx.arc(sx, sy, 4.6 * DPR, 0, 6.28); ctx.fill();
  ctx.strokeStyle = "rgba(255,246,224,.5)"; ctx.lineWidth = 1.4 * DPR;
  ctx.beginPath(); ctx.arc(sx, sy, 7.5 * DPR, 0, 6.28); ctx.stroke();
}

function drawParticles() {
  for (const p of particles) {
    const [x, y] = W2S(p.x, p.y);
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.kind === "warm" ? "rgba(255,150,90,1)" : "rgba(120,255,180,1)";
    ctx.beginPath(); ctx.arc(x, y, (2.4 * p.life + 0.6) * DPR, 0, 6.28); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function frame(t) {
  if (shake > 0 && !reduced) { shake *= 0.85; if (shake < 0.4) shake = 0; }
  const sx = shake ? (Math.random() * 2 - 1) * shake * DPR : 0;
  const sy = shake ? (Math.random() * 2 - 1) * shake * DPR : 0;
  ctx.setTransform(1, 0, 0, 1, sx, sy);
  drawBg(t);
  const posed = OrbitalPhysics.posBodies(bodies, mode === "fly" ? tSim : 0);
  drawGoal(t);
  for (const b of posed) drawBody(b, t);
  drawPlan();
  edDraw();                 // grid, orbit paths, selection ring — edit mode only
  drawTrail();
  drawProbe();
  drawParticles();
  if (mode === "fly") stepFly();
  stepParticles();
  requestAnimationFrame(frame);
}
