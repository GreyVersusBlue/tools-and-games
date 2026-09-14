/* ============================================================
   Orbital — physics core (deterministic)
   The SAME stepper drives the aiming preview and the live flight,
   which is what makes the dotted flight plan an honest prediction.
   Pure module: no DOM. Attaches to globalThis so it also loads
   under Node for the solvability tests.
   ============================================================ */
;(function (g) {
  "use strict";

  const G = 90000, SOFT2 = 400, SUBSTEPS = 8, DT = 1 / (60 * SUBSTEPS);
  const MAXSPEED = 520, MAXDRAG = 260;          // logical px
  const W = 1000, H = 640, PAD = 240;           // playfield + escape margin

  const SOLID = { planet: 1, star: 1, rock: 1, blackhole: 1 };
  const isSolid = t => !!SOLID[t];

  // moving bodies (orbit) resolved to positions at time t
  function posBodies(list, t) {
    const out = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.orbit) {
        const a = b.orbit.a0 + b.orbit.speed * t;
        out[i] = Object.assign({}, b, {
          x: b.orbit.cx + Math.cos(a) * b.orbit.r,
          y: b.orbit.cy + Math.sin(a) * b.orbit.r
        });
      } else out[i] = b;
    }
    return out;
  }

  // Advance state one substep. Mutates st {x,y,vx,vy,t,lock}.
  // Returns "WIN" | "CRASH" | "OUT" | null, and sets st.jumped when a
  // wormhole teleport happened this step (so the renderer can break the line).
  function substep(st, level) {
    const posed = posBodies(level.bodies, st.t);
    st.jumped = false;

    // gravity (skip massless specials)
    let ax = 0, ay = 0;
    for (let i = 0; i < posed.length; i++) {
      const b = posed[i];
      if (!b.mass) continue;
      const dx = b.x - st.x, dy = b.y - st.y, d2 = dx * dx + dy * dy + SOFT2;
      const inv = G * b.mass / (d2 * Math.sqrt(d2));
      ax += dx * inv; ay += dy * inv;
    }
    st.vx += ax * DT; st.vy += ay * DT;
    st.x += st.vx * DT; st.y += st.vy * DT; st.t += DT;
    if (st.lock > 0) st.lock--;

    // goal first
    if (Math.hypot(level.goal.x - st.x, level.goal.y - st.y) < level.goal.r) return "WIN";

    // specials + solid collisions
    for (let i = 0; i < posed.length; i++) {
      const b = posed[i];
      const d = Math.hypot(b.x - st.x, b.y - st.y);
      if (b.type === "wormhole") {
        if (st.lock <= 0 && d < b.r) {
          let partner = null;
          for (let j = 0; j < posed.length; j++)
            if (posed[j] !== b && posed[j].link === b.link) { partner = posed[j]; break; }
          if (partner) {
            const sp = Math.hypot(st.vx, st.vy);
            let ang = Math.atan2(st.vy, st.vx) + (b.exitTurn || 0);
            const off = partner.r + 16;
            st.x = partner.x + Math.cos(ang) * off;
            st.y = partner.y + Math.sin(ang) * off;
            st.vx = Math.cos(ang) * sp; st.vy = Math.sin(ang) * sp;
            st.lock = 48; st.jumped = true;
            break;
          }
        }
      } else if (b.type === "booster") {
        if (st.lock <= 0 && d < b.r) {
          st.vx += Math.cos(b.dir) * b.boost;
          st.vy += Math.sin(b.dir) * b.boost;
          st.lock = 40;
        }
      } else if (isSolid(b.type)) {
        if (d < b.r) return "CRASH";
      }
    }

    if (st.x < -PAD || st.x > W + PAD || st.y < -PAD || st.y > H + PAD) return "OUT";
    return null;
  }

  // Full deterministic solve. Returns sampled points + outcome + end state.
  // `segs` groups points between teleports so a renderer can avoid drawing
  // a line across the jump.
  function solve(start, v0, level, maxSub) {
    maxSub = maxSub || 5200;
    const st = { x: start.x, y: start.y, vx: v0.x, vy: v0.y, t: 0, lock: 0, jumped: false };
    const pts = [{ x: st.x, y: st.y }];
    let outcome = "OUT";
    for (let i = 0; i < maxSub; i++) {
      const o = substep(st, level);
      if (i % 3 === 0 || o || st.jumped) pts.push({ x: st.x, y: st.y, cut: st.jumped });
      if (o) { outcome = o; break; }
    }
    return { pts, outcome, x: st.x, y: st.y, vx: st.vx, vy: st.vy, t: st.t };
  }

  // ============================================================
  // Solvability search
  // ============================================================
  // One implementation, two callers: the CI suite's "every level has a
  // winning launch vector" pass and the editor's Check button. They have to
  // agree — a level the editor calls winnable and the suite calls dead would
  // be a link that ships broken — so neither owns a copy.
  //
  // Coarse angle x power grid first; most levels resolve there. Any cell that
  // misses reports how close its whole sampled path got, which seeds a
  // shrinking local search around the closest miss for the ones a grid alone
  // does not crack (timed orbits, wormhole exits, boosted lines).

  function closestApproach(level, angle, power) {
    const sp = power * MAXSPEED;
    const r = solve(level.start, { x: Math.cos(angle) * sp, y: Math.sin(angle) * sp }, level);
    if (r.outcome === "WIN") return { win: true, dist: 0 };
    let best = Infinity;
    for (let i = 0; i < r.pts.length; i++) {
      const d = Math.hypot(r.pts[i].x - level.goal.x, r.pts[i].y - level.goal.y);
      if (d < best) best = d;
    }
    return { win: false, dist: best };
  }

  // A search you drive a slice at a time, so the editor can run it across
  // animation frames with a progress bar instead of freezing the tab.
  // step(budget) spends at most `budget` trial launches and returns
  // { done, shot, progress, tried }. `shot` is null until one wins.
  function makeSearch(level, opts) {
    const o = Object.assign({ angleSteps: 240, powerSteps: 20, rounds: 60 }, opts || {});
    const total = o.angleSteps * o.powerSteps;
    let phase = "grid", ai = 0, pi = 1, best = null, tried = 0;
    let center = null, bestDist = Infinity, dAngle = 0, dPower = 0, round = 0, di = 0, improved = false;

    function progress() {
      if (phase === "grid") return 0.8 * (ai * o.powerSteps + pi) / total;
      if (phase === "refine") return 0.8 + 0.2 * (round / o.rounds);
      return 1;
    }
    function startRefine() {
      phase = "refine";
      center = { angle: best.angle, power: best.power };
      bestDist = best.dist;
      dAngle = (Math.PI * 2) / o.angleSteps; dPower = 1 / o.powerSteps;
      round = 0; di = 0; improved = false;
    }

    function step(budget) {
      for (let n = 0; n < (budget || 1); n++) {
        if (phase === "spent") break;
        if (phase === "grid") {
          const angle = (ai / o.angleSteps) * Math.PI * 2, power = pi / o.powerSteps;
          const r = closestApproach(level, angle, power); tried++;
          if (r.win) { phase = "spent"; return { done: true, shot: { angle, power }, progress: 1, tried }; }
          if (!best || r.dist < best.dist) best = { angle, power, dist: r.dist };
          if (++pi > o.powerSteps) { pi = 1; if (++ai >= o.angleSteps) startRefine(); }
        } else {
          // The centre moves the moment a neighbour improves on it, mid-round,
          // which is what the search this replaced did and what the 22 shipped
          // levels are known to pass under.
          const da = ((di / 3) | 0) - 1, dp = (di % 3) - 1;
          di++;
          if (da || dp) {
            const angle = center.angle + da * dAngle;
            const power = Math.min(1, Math.max(0.01, center.power + dp * dPower));
            const r = closestApproach(level, angle, power); tried++;
            if (r.win) { phase = "spent"; return { done: true, shot: { angle, power }, progress: 1, tried }; }
            if (r.dist < bestDist) { bestDist = r.dist; center = { angle, power }; improved = true; }
          }
          if (di >= 9) {
            di = 0;
            if (!improved) { dAngle *= 0.6; dPower *= 0.6; }
            improved = false;
            round++;
            if (round >= o.rounds || (dAngle < 1e-6 && dPower < 1e-6)) phase = "spent";
          }
        }
      }
      return { done: phase === "spent", shot: null, progress: progress(), tried };
    }
    return { step, get tried() { return tried; }, get closest() { return bestDist; } };
  }

  // The whole search in one call. Returns a { angle, power } or null.
  function findWinningShot(level, opts) {
    const s = makeSearch(level, opts);
    for (;;) {
      const r = s.step(256);
      if (r.shot) return r.shot;
      if (r.done) return null;
    }
  }

  g.OrbitalPhysics = {
    G, SOFT2, SUBSTEPS, DT, MAXSPEED, MAXDRAG, W, H, PAD,
    isSolid, posBodies, substep, solve, closestApproach, makeSearch, findWinningShot
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
