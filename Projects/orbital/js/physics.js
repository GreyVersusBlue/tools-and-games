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

  g.OrbitalPhysics = {
    G, SOFT2, SUBSTEPS, DT, MAXSPEED, MAXDRAG, W, H, PAD,
    isSolid, posBodies, substep, solve
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
