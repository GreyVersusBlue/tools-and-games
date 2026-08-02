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

function drawBody(b, t) {
  const [sx, sy] = W2S(b.x, b.y), R = b.r * view.s;
  const spin = reduced ? 0 : t * 0.001;

  if (b.type === "blackhole") {
    glowCircle(b.x, b.y, b.r, "rgba(124,92,255,0.55)", 4.2);
    // accretion ring
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(spin * 2);
    for (let k = 0; k < 2; k++) {
      ctx.strokeStyle = k ? "rgba(200,180,255,.5)" : "rgba(255,230,255,.85)";
      ctx.lineWidth = (k ? 2 : 3) * DPR;
      ctx.beginPath(); ctx.ellipse(0, 0, R * (1.5 + k * 0.4), R * (0.7 + k * 0.2), 0, 0.3, 5.5); ctx.stroke();
    }
    ctx.restore();
    // core
    const core = ctx.createRadialGradient(sx, sy, R * 0.1, sx, sy, R);
    core.addColorStop(0, "#000005"); core.addColorStop(.7, "#05010f"); core.addColorStop(1, "#2a1a5c");
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(sx, sy, R, 0, 6.28); ctx.fill();
    ctx.strokeStyle = "rgba(160,140,255,.9)"; ctx.lineWidth = 1.5 * DPR;
    ctx.beginPath(); ctx.arc(sx, sy, R, 0, 6.28); ctx.stroke();
    return;
  }

  if (b.type === "wormhole") {
    glowCircle(b.x, b.y, b.r, "rgba(102,255,224,0.5)", 2.2);
    ctx.save(); ctx.translate(sx, sy);
    for (let k = 0; k < 3; k++) {
      ctx.rotate(spin * (k % 2 ? -3 : 3) + k);
      ctx.strokeStyle = `rgba(102,255,224,${0.75 - k * 0.18})`;
      ctx.lineWidth = 2 * DPR; ctx.setLineDash([6 * DPR, 7 * DPR]);
      ctx.beginPath(); ctx.arc(0, 0, R * (1 - k * 0.22), 0, 6.28); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
    const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.7);
    core.addColorStop(0, "#04211d"); core.addColorStop(1, "rgba(4,33,29,0)");
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(sx, sy, R * 0.7, 0, 6.28); ctx.fill();
    return;
  }

  if (b.type === "booster") {
    glowCircle(b.x, b.y, b.r, "rgba(255,224,102,0.4)", 2.0);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(b.dir);
    // gate ring
    ctx.strokeStyle = "rgba(255,224,102,.85)"; ctx.lineWidth = 2.5 * DPR;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.28); ctx.stroke();
    // flowing chevrons pointing +dir
    const flow = reduced ? 0 : (t * 0.004) % 1;
    for (let k = 0; k < 3; k++) {
      const off = (k + flow) / 3, a = 0.35 + off * 0.6;
      ctx.globalAlpha = 1 - off; ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 3 * DPR;
      const cxp = (off - 0.5) * R * 1.6;
      ctx.beginPath();
      ctx.moveTo(cxp - R * 0.35, -R * a); ctx.lineTo(cxp + R * 0.2, 0); ctx.lineTo(cxp - R * 0.35, R * a);
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.restore();
    return;
  }

  // gravity bodies (planet / star / rock / repulse)
  const col = COLOR[b.type];
  const rgb = col === "#63d8ff" ? "99,216,255" : col === "#ffb257" ? "255,178,87"
            : col === "#9aa0b8" ? "154,160,184" : "255,94,200";
  glowCircle(b.x, b.y, b.r, `rgba(${rgb},0.5)`, b.type === "star" ? 3.4 : 2.4);
  const g = ctx.createRadialGradient(sx - R * 0.3, sy - R * 0.3, R * 0.1, sx, sy, R);
  if (b.type === "repulse") { g.addColorStop(0, "#ffd0f0"); g.addColorStop(1, "#c01d86"); }
  else if (b.type === "star") { g.addColorStop(0, "#fff2d0"); g.addColorStop(.6, "#ffb257"); g.addColorStop(1, "#c9701a"); }
  else if (b.type === "rock") { g.addColorStop(0, "#c3c8db"); g.addColorStop(1, "#5c6178"); }
  else { g.addColorStop(0, "#c9f2ff"); g.addColorStop(.7, "#63d8ff"); g.addColorStop(1, "#1f7ea6"); }
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, R, 0, 6.28); ctx.fill();
  if (b.type === "repulse") {
    ctx.strokeStyle = "rgba(255,150,225,.7)"; ctx.lineWidth = 1.5 * DPR;
    ctx.setLineDash([4 * DPR, 5 * DPR]); ctx.beginPath(); ctx.arc(sx, sy, R * 1.5, 0, 6.28); ctx.stroke();
    ctx.setLineDash([]);
  }
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
  drawTrail();
  drawProbe();
  drawParticles();
  if (mode === "fly") stepFly();
  stepParticles();
  requestAnimationFrame(frame);
}
