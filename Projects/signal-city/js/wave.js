// Signal City: the platoon visualiser (M7). A time-space diagram of the
// corridor: distance along the main street across, time down, the past
// above the "now" line and the plan's forecast below it. Each box is a
// column coloured by the head its through movements will show (eastbound
// on the left half, westbound on the right), a platoon line leaves every
// green's start at the speed a standard car holds and shows where it lands
// at the other box, and the dots are where the main street's cars actually
// were, sampled twice a second. The green wave is the picture where the
// line from one box's green start lands in the other box's green.
//
// `waveModel` and `WaveHistory` are pure and the suite steps them; `drawWave`
// is the one function that touches a canvas.

import { ARCHETYPES } from './cars.js';

export const WAVE = {
  past: 20,        // seconds of history drawn above the now line
  ahead: 50,       // seconds of forecast drawn below it
  dt: 0.25,        // the forecast's step
  every: 0.5,      // seconds between history samples
  speed: ARCHETYPES.standard.vmax,   // m/s the platoon line runs at
};

export const EAST = 'W-T';   // arriving from the west, heading east
export const WEST = 'E-T';

// Where a platoon released at x0 at t0 reaches x1 at `speed`.
export function arrival(x0, t0, x1, speed) { return t0 + Math.abs(x1 - x0) / speed; }

// The lines: one from the start of every green run at the releasing box to
// the box it feeds, eastbound from the first box and westbound from the
// last. `runs` are Controller.forecast runs in seconds from now.
export function platoonLines(nodes, speed) {
  const out = [];
  if (nodes.length < 2) return out;
  const first = nodes[0], last = nodes[nodes.length - 1];
  for (const r of first.east) if (r.head === 'green' && r.from > 0) out.push({ dir: 'east', x0: first.x, t0: r.from, x1: last.x, t1: arrival(first.x, r.from, last.x, speed) });
  for (const r of last.west) if (r.head === 'green' && r.from > 0) out.push({ dir: 'west', x0: last.x, t0: r.from, x1: first.x, t1: arrival(last.x, r.from, first.x, speed) });
  return out;
}

// The picture for a world: every node's position and the forecast of its
// two through heads, the lines between them, and the extent to draw.
export function waveModel(world, { ahead = WAVE.ahead, dt = WAVE.dt, speed = WAVE.speed } = {}) {
  const nodes = world.nodes.map((n, i) => {
    const ctl = world.controllers[i];
    return { x: n.origin[0], name: world.nodes.length === 2 ? (i === 0 ? 'West' : 'East') : `Box ${i + 1}`, east: ctl.forecast(EAST, ahead, dt), west: ctl.forecast(WEST, ahead, dt) };
  });
  const xs = nodes.map(n => n.x);
  const leg = world.nodes[0].legLength;
  return { nodes, lines: platoonLines(nodes, speed), extent: [Math.min(...xs) - leg, Math.max(...xs) + leg], ahead, speed };
}

// History: the main street's cars and each box's through heads, sampled
// every `every` seconds of world time and kept for `past` seconds.
export class WaveHistory {
  constructor({ past = WAVE.past, every = WAVE.every } = {}) {
    this.past = past;
    this.every = every;
    this.samples = [];   // [{ t, dots: [{ x, dir }], heads: [{ east, west }] }]
    this.lastT = -Infinity;
  }

  reset() { this.samples.length = 0; this.lastT = -Infinity; }

  // Records a sample if `every` seconds have passed since the last one.
  // Returns true when it did.
  sample(world) {
    if (world.t - this.lastT < this.every - 1e-9) return false;
    this.lastT = world.t;
    const dots = [];
    for (const c of world.cars) {
      if (c.done || c.crashed) continue;
      const e = c.path.entry;
      if (e !== 'W' && e !== 'E') continue;    // the side streets are not the wave's
      dots.push({ x: +c.path.at(c.s).x.toFixed(1), dir: e === 'W' ? 'east' : 'west' });
    }
    const heads = world.controllers.map(c => ({ east: c.head(EAST), west: c.head(WEST) }));
    this.samples.push({ t: world.t, dots, heads });
    while (this.samples.length && this.samples[0].t < world.t - this.past - 1e-9) this.samples.shift();
    return true;
  }
}

const HEAD = { green: '#2ee06b', 'green-arrow': '#2ee06b', yellow: '#ffc21f', 'yellow-arrow': '#ffc21f', red: '#7a2a25', 'flash-red': '#7a2a25', 'flash-yellow': '#8a6a10', dark: '#2a2a2a' };
const DOT = { east: 'rgba(127,200,248,0.9)', west: 'rgba(242,209,107,0.9)' };
const LINE = { east: 'rgba(127,200,248,0.5)', west: 'rgba(242,209,107,0.5)' };

// Draws the model and the history on a 2d context of `w` by `h` CSS px.
export function drawWave(ctx, model, history, now, w, h) {
  const past = history.past;
  const [x0, x1] = model.extent;
  const px = x => 28 + (x - x0) / (x1 - x0) * (w - 36);
  const py = t => 14 + (t + past) / (past + model.ahead) * (h - 28);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1a1d22';
  ctx.fillRect(0, 0, w, h);
  // the road
  ctx.strokeStyle = 'rgba(232,226,200,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px(x0), py(-past)); ctx.lineTo(px(x0), py(model.ahead)); ctx.moveTo(px(x1), py(-past)); ctx.lineTo(px(x1), py(model.ahead)); ctx.stroke();
  // the columns: past from the samples, the future from the forecast
  const col = 9;
  for (const [i, n] of model.nodes.entries()) {
    const cx = px(n.x);
    for (let k = 0; k < history.samples.length; k++) {
      const s = history.samples[k], next = history.samples[k + 1];
      const t0 = s.t - now, t1 = (next ? next.t : now) - now;
      ctx.fillStyle = HEAD[s.heads[i].east] || HEAD.dark; ctx.fillRect(cx - col, py(t0), col, Math.max(1, py(t1) - py(t0)));
      ctx.fillStyle = HEAD[s.heads[i].west] || HEAD.dark; ctx.fillRect(cx, py(t0), col, Math.max(1, py(t1) - py(t0)));
    }
    for (const r of n.east) { ctx.fillStyle = HEAD[r.head] || HEAD.dark; ctx.fillRect(cx - col, py(r.from), col, Math.max(1, py(r.to) - py(r.from))); }
    for (const r of n.west) { ctx.fillStyle = HEAD[r.head] || HEAD.dark; ctx.fillRect(cx, py(r.from), col, Math.max(1, py(r.to) - py(r.from))); }
    ctx.fillStyle = '#9aa3ad'; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(n.name, cx, 10);
  }
  // the platoon lines
  ctx.lineWidth = 1.5;
  for (const l of model.lines) {
    ctx.strokeStyle = LINE[l.dir];
    ctx.beginPath(); ctx.moveTo(px(l.x0), py(l.t0)); ctx.lineTo(px(l.x1), py(l.t1)); ctx.stroke();
  }
  // the cars that were
  for (const s of history.samples) {
    const y = py(s.t - now);
    for (const d of s.dots) { ctx.fillStyle = DOT[d.dir]; ctx.fillRect(px(d.x) - 1, y - 1, 2, 2); }
  }
  // now
  ctx.strokeStyle = 'rgba(233,236,239,0.7)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(4, py(0)); ctx.lineTo(w - 4, py(0)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#9aa3ad'; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('now', 4, py(0) - 3);
  ctx.fillText(`+${model.ahead} s`, 4, h - 4);
  ctx.fillText(`-${past} s`, 4, py(-past) + 10);
  ctx.textAlign = 'right';
  ctx.fillStyle = DOT.east; ctx.fillText('east →', w - 4, h - 15);
  ctx.fillStyle = DOT.west; ctx.fillText('← west', w - 4, h - 4);
}
