// Signal City: the canvas. Reads the world, draws it, keeps nothing the sim
// needs. World units are metres with the intersection at the origin and y
// down; the camera is a scale (px per metre) and a centre, with a slow zoom.
//
// Draw order: grass, then per node asphalt, markings, the box and
// crosswalks, stop lines, the induction loops (lit when a car sits on them),
// signal heads, the walk lamps and call posts; then walkers, cars (cached
// sprites, rotated to the path tangent, the trailer drawn live behind the
// cab), then the effects layer: honks, hesitations, pickups, crash marks,
// the priority halo.
//
// The camera (M6): a single box shows the middle 72 m of its legs (#541); a
// corridor frames every box with 50 m of road either side, which on a
// 950 px board is about 3 px per metre, and the wheel zooms and a drag pans
// from there. The legs stay 110 m whatever is framed.

import { spriteFor, SPRITES } from './sprites.js';
import { LANE_WIDTH, CROSSWALK, legDir } from './network.js';
import { parseMovement } from './signals.js';
import { LOOP_LENGTH } from './sim.js';

const GRASS = '#5d7a4a';
const GRASS_2 = '#556f43';
const ASPHALT = '#3a3d42';
const ASPHALT_EDGE = '#2c2f33';
const LINE = '#e8e2c8';
const LINE_DIM = 'rgba(232,226,200,0.55)';
const LAMP = { red: '#ff3b30', yellow: '#ffc21f', green: '#2ee06b', off: '#2a2a2a' };
const LOOP = 'rgba(232,226,200,0.35)';
const LOOP_LIT = 'rgba(79,140,255,0.85)';
const WALKER_TINTS = ['#f2d16b', '#e8734a', '#7fc8f8', '#c9a0ff', '#9fe37a', '#f7f7f7'];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 4;        // px per metre
    this.cx = 0; this.cy = 0;
    this.dpr = 1;
    this.effects = [];     // { kind, x, y, t0, ttl, text }
    this.crashMarks = [];  // { x, y, heading }
    this.width = 0; this.height = 0;
    this.selected = null;  // a car id the pointer is over
  }

  resize(cssW, cssH, dpr = 1) {
    this.dpr = dpr;
    this.width = cssW; this.height = cssH;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
  }

  // Frame the middle of the map: the legs run 110 m each way, the camera
  // shows about 72 m of each, and cars arrive from off-screen. A corridor
  // frames every box, 50 m of road past the outer ones. The wheel zooms and
  // a drag pans from there.
  fit(world) {
    const view = Math.min(world.network.legLength, 72);
    const { minX, maxX, minY, maxY } = this.extent(world);
    const spanX = maxX - minX + 2 * (world.nodes.length > 1 ? 50 : view);
    const spanY = maxY - minY + 2 * view;
    this.scale = Math.max(2.5, Math.min(9, Math.min(this.width / spanX, this.height / spanY)));
    this.baseScale = this.scale;
    this.cx = (minX + maxX) / 2; this.cy = (minY + maxY) / 2;
  }

  // The world's aspect (width over height) as fit() frames it, for the page
  // to size the canvas by.
  aspect(world) {
    const view = Math.min(world.network.legLength, 72);
    const { minX, maxX, minY, maxY } = this.extent(world);
    return (maxX - minX + 2 * (world.nodes.length > 1 ? 50 : view)) / (maxY - minY + 2 * view);
  }

  extent(world) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of world.nodes) {
      minX = Math.min(minX, n.origin[0]); maxX = Math.max(maxX, n.origin[0]);
      minY = Math.min(minY, n.origin[1]); maxY = Math.max(maxY, n.origin[1]);
    }
    return { minX, maxX, minY, maxY };
  }

  zoomBy(f) {
    this.scale = Math.max(this.baseScale * 0.8, Math.min(this.baseScale * 3, this.scale * f));
  }

  panBy(dxPx, dyPx) {
    this.cx -= dxPx / this.scale; this.cy -= dyPx / this.scale;
  }

  toWorld(px, py) {
    return { x: (px - this.width / 2) / this.scale + this.cx, y: (py - this.height / 2) / this.scale + this.cy };
  }

  toScreen(x, y) {
    return { x: (x - this.cx) * this.scale + this.width / 2, y: (y - this.cy) * this.scale + this.height / 2 };
  }

  // Drain the world's event list into the effects layer.
  takeEvents(world) {
    for (const e of world.events) {
      const car = e.car ? world.cars.find(c => c.id === e.car) : null;
      const at = car ? car.path.at(car.s) : null;
      switch (e.kind) {
        case 'honk': if (at) this.effects.push({ kind: 'honk', x: at.x, y: at.y, t0: world.t, ttl: 1.6, car: e.car }); break;
        case 'hesitate': if (at) this.effects.push({ kind: 'text', text: '?', x: at.x, y: at.y, t0: world.t, ttl: 1.6, car: e.car }); break;
        case 'pickup': if (at) this.effects.push({ kind: 'text', text: '✋', x: at.x, y: at.y, t0: world.t, ttl: 3.5, car: e.car }); break;
        case 'cautious': if (at) this.effects.push({ kind: 'text', text: '…', x: at.x, y: at.y, t0: world.t, ttl: 1.4, car: e.car }); break;
        case 'collision': {
          this.effects.push({ kind: 'crash', x: e.where.x, y: e.where.y, t0: world.t, ttl: 2.2 });
          this.crashMarks.push({ x: e.where.x, y: e.where.y, heading: (e.cars[0] * 0.7) % 3.14 });
          break;
        }
        case 'priority': if (at) this.effects.push({ kind: 'text', text: 'PRIORITY', x: at.x, y: at.y, t0: world.t, ttl: 2.5, car: e.car }); break;
        case 'call': { const [x, y] = this.callPost(world.nodes[e.node], e.leg); this.effects.push({ kind: 'text', text: 'call', x, y, t0: world.t, ttl: 1.6 }); break; }
        case 'ped-late': { const [x, y] = this.callPost(world.nodes[e.node], e.leg); this.effects.push({ kind: 'text', text: 'still waiting', x, y, t0: world.t, ttl: 2.2 }); break; }
        case 'gridlock': this.effects.push({ kind: 'banner', text: 'GRIDLOCK', x: 0, y: 0, t0: world.t, ttl: 4 }); break;
        default: break;
      }
    }
    world.events.length = 0;
  }

  reset() { this.effects = []; this.crashMarks = []; }

  draw(world, now) {
    const { ctx } = this;
    const S = this.scale;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // grass
    ctx.fillStyle = GRASS;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.translate(this.width / 2 - this.cx * S, this.height / 2 - this.cy * S);
    ctx.scale(S, S);
    this._grassTexture(ctx, world);
    for (const net of world.nodes) {
      ctx.save();
      ctx.translate(net.origin[0], net.origin[1]);
      this._roads(ctx, world, net);
      this._loops(ctx, world, net);
      this._heads(ctx, world, net, now);
      if (world.controllers[net.node].hasPeds) this._pedHeads(ctx, world, net, now);
      ctx.restore();
    }
    this._walkers(ctx, world, now);
    this._cars(ctx, world, now);
    this._effects(ctx, world);
    ctx.restore();
  }

  // Where a leg's call post stands: the near-side corner as the driver
  // arrives, just outside the road, at the zebra.
  callPost(net, leg) {
    const d = legDir(leg);
    const rr = [d[1], -d[0]];
    const along = net.boxHalf + CROSSWALK / 2;
    return [net.origin[0] + d[0] * along + rr[0] * (net.halfRoad + 1.6), net.origin[1] + d[1] * along + rr[1] * (net.halfRoad + 1.6)];
  }

  _grassTexture(ctx, world) {
    const L = world.network.legLength + 40;
    ctx.fillStyle = GRASS_2;
    const { minX, maxX } = this.extent(world);
    const i0 = Math.floor((minX - 120) / 33), i1 = Math.ceil((maxX + 120) / 33);
    for (let i = i0; i <= i1; i++) {
      for (let j = -6; j <= 6; j++) {
        if (((i * 7 + j * 13) % 5 + 5) % 5 !== 0) continue;
        ctx.fillRect(i * 33 + 9, j * 29 + 4, 14, 10);
      }
    }
    // a few blocks, so the grid reads as a city and not a field
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (const net of world.nodes) {
      const b = net.halfRoad + 14;
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        for (let k = 0; k < 3; k++) {
          const x = sx * (b + 4 + k * 30), y = sy * (b + 4 + ((k * 2) % 3) * 22);
          ctx.fillRect(net.origin[0] + Math.min(x, x + sx * 22), net.origin[1] + Math.min(y, y + sy * 16), 22, 16);
          if (Math.abs(x) > L || Math.abs(y) > L) break;
        }
      }
    }
  }

  // One node's roads, drawn about its own origin (the caller translates).
  _roads(ctx, world, net) {
    const half = net.halfRoad;
    const L = net.legLength + 20;
    // asphalt legs
    ctx.fillStyle = ASPHALT;
    for (const leg of net.legs) {
      const d = legDir(leg);
      if (d[0] === 0) ctx.fillRect(-half, d[1] < 0 ? -L : 0, half * 2, L);
      else ctx.fillRect(d[0] < 0 ? -L : 0, -half, L, half * 2);
    }
    // box
    const bh = net.boxHalf;
    ctx.fillRect(-bh, -bh, bh * 2, bh * 2);
    ctx.strokeStyle = ASPHALT_EDGE; ctx.lineWidth = 0.6;
    for (const leg of net.legs) {
      const d = legDir(leg);
      ctx.beginPath();
      if (d[0] === 0) { const y0 = d[1] * bh, y1 = d[1] * L; ctx.moveTo(-half, y0); ctx.lineTo(-half, y1); ctx.moveTo(half, y0); ctx.lineTo(half, y1); }
      else { const x0 = d[0] * bh, x1 = d[0] * L; ctx.moveTo(x0, -half); ctx.lineTo(x1, -half); ctx.moveTo(x0, half); ctx.lineTo(x1, half); }
      ctx.stroke();
    }
    // lane markings: centre line (double yellow) and lane dashes
    for (const leg of net.legs) {
      const d = legDir(leg);
      const r = [-d[1], d[0]];
      const from = net.stopDist + CROSSWALK, to = L;
      // centre
      ctx.strokeStyle = '#e0b830'; ctx.lineWidth = 0.25;
      for (const off of [-0.35, 0.35]) {
        ctx.beginPath();
        ctx.moveTo(d[0] * from + r[0] * off, d[1] * from + r[1] * off);
        ctx.lineTo(d[0] * to + r[0] * off, d[1] * to + r[1] * off);
        ctx.stroke();
      }
      // lane lines between lanes of one direction
      if (net.lanesPerDir > 1) {
        ctx.strokeStyle = LINE_DIM; ctx.lineWidth = 0.2; ctx.setLineDash([2.5, 3]);
        for (let k = 1; k < net.lanesPerDir; k++) {
          for (const side of [-1, 1]) {
            const off = side * k * LANE_WIDTH;
            ctx.beginPath();
            ctx.moveTo(d[0] * from + r[0] * off, d[1] * from + r[1] * off);
            ctx.lineTo(d[0] * to + r[0] * off, d[1] * to + r[1] * off);
            ctx.stroke();
          }
        }
        ctx.setLineDash([]);
      }
      // crosswalk: zebra across the whole road just outside the box
      ctx.fillStyle = LINE;
      const cwFrom = bh + 0.4, cwTo = bh + CROSSWALK - 0.4;
      for (let off = -half + 0.6; off < half - 0.5; off += 1.4) {
        const p0 = [d[0] * cwFrom + r[0] * off, d[1] * cwFrom + r[1] * off];
        const p1 = [d[0] * cwTo + r[0] * off, d[1] * cwTo + r[1] * off];
        ctx.beginPath();
        ctx.lineWidth = 0.8; ctx.strokeStyle = LINE;
        ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      }
      // stop line across the inbound half
      const sd = net.stopDist;
      const inSide = r; // inbound lanes lie on the driver's right as they arrive: +r for legs where arrive heading = -d
      ctx.strokeStyle = LINE; ctx.lineWidth = 0.5;
      ctx.beginPath();
      // arriving heading is -d; right of (-d) is rotate(-d) = (d[1], -d[0])
      const rr = [d[1], -d[0]];
      ctx.moveTo(d[0] * sd, d[1] * sd);
      ctx.lineTo(d[0] * sd + rr[0] * half, d[1] * sd + rr[1] * half);
      ctx.stroke();
      // turn arrows on the inbound lanes
      ctx.fillStyle = LINE_DIM;
      for (let lane = 0; lane < net.lanesPerDir; lane++) {
        const pt = net.lanePoint(leg, lane, true, sd + 6);
        this._arrow(ctx, pt[0] - net.origin[0], pt[1] - net.origin[1], Math.atan2(-d[1], -d[0]), net.lanesForTurn('L').includes(lane), net.lanesForTurn('T').includes(lane), net.lanesForTurn('R').includes(lane));
      }
      void inSide;
    }
  }

  // The induction loops: a rectangle in each sensed inbound lane, the
  // LOOP_LENGTH metres before the stop line, lit while a car sits on it.
  _loops(ctx, world, net) {
    if (!world.sensors) return;
    const sd = net.stopDist;
    for (const leg of net.legs) {
      const d = legDir(leg);
      for (let lane = 0; lane < net.lanesPerDir; lane++) {
        if (!world.hasLoop(net.node, leg, lane)) continue;
        const a = net.lanePoint(leg, lane, true, sd + 0.6), b = net.lanePoint(leg, lane, true, sd + LOOP_LENGTH);
        const cx = (a[0] + b[0]) / 2 - net.origin[0], cy = (a[1] + b[1]) / 2 - net.origin[1];
        const lit = world.onLoop(net.node, leg, lane);
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(Math.atan2(-d[1], -d[0]));
        ctx.strokeStyle = lit ? LOOP_LIT : LOOP; ctx.lineWidth = lit ? 0.4 : 0.25;
        ctx.setLineDash([0.8, 0.5]);
        ctx.strokeRect(-(LOOP_LENGTH - 0.6) / 2, -(LANE_WIDTH - 1.2) / 2, LOOP_LENGTH - 0.6, LANE_WIDTH - 1.2);
        ctx.setLineDash([]);
        if (lit) { ctx.fillStyle = 'rgba(79,140,255,0.18)'; ctx.fillRect(-(LOOP_LENGTH - 0.6) / 2, -(LANE_WIDTH - 1.2) / 2, LOOP_LENGTH - 0.6, LANE_WIDTH - 1.2); }
        ctx.restore();
      }
    }
  }

  // The walk lamps and call posts: one post per leg on the near-side
  // corner, a ring that lights while a call waits, and a lamp above it that
  // shows the crossing's head: white for WALK, orange for the clearance
  // (flashing) and for don't walk.
  _pedHeads(ctx, world, net, now) {
    const ctl = world.controllers[net.node];
    const blink = Math.floor(now * 3) % 2 === 0;
    for (const leg of net.legs) {
      if (!ctl.phases.some(p => p.walks.includes(`P-${leg}`))) continue;
      const [x, y] = this.callPost(net, leg);
      const lx = x - net.origin[0], ly = y - net.origin[1];
      const head = ctl.pedHead(leg);
      const waiting = !!world.pedCalls[net.node][leg];
      ctx.save();
      ctx.translate(lx, ly);
      // the post and its call ring
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, 0, 0.35, 0, Math.PI * 2); ctx.fill();
      if (waiting) { ctx.strokeStyle = LAMP.yellow; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.arc(0, 0, 0.8 + (blink ? 0.15 : 0), 0, Math.PI * 2); ctx.stroke(); }
      // the lamp
      ctx.fillStyle = '#1c1c1e'; ctx.fillRect(-0.9, -2.6, 1.8, 1.6);
      let colour = '#6b3b1f';
      if (head === 'walk') colour = '#f4f4f4';
      else if (head === 'clear') colour = blink ? '#ff8c1a' : '#6b3b1f';
      else colour = '#ff8c1a';
      ctx.fillStyle = colour;
      if (head === 'walk') { ctx.beginPath(); ctx.arc(0, -2.05, 0.35, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-0.18, -1.85, 0.36, 0.7); }
      else { ctx.beginPath(); ctx.arc(0, -1.8, 0.45, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }

  _walkers(ctx, world, now) {
    for (const w of world.walkers) {
      if (w.done) continue;
      const bob = w.v > 0 ? Math.sin(now * 9 + w.id) * 0.12 : 0;
      ctx.save();
      ctx.translate(w.x, w.y + bob);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(0.15, 0.2, 0.45, 0.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = WALKER_TINTS[w.tint % WALKER_TINTS.length]; ctx.beginPath(); ctx.arc(0, 0, 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3a2a22'; ctx.beginPath(); ctx.arc(0, -0.05, 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  _arrow(ctx, x, y, heading, left, through, right) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(heading);
    ctx.lineWidth = 0.35; ctx.strokeStyle = LINE_DIM; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(1.2, 0); ctx.stroke();
    if (through) { ctx.beginPath(); ctx.moveTo(1.2, 0); ctx.lineTo(0.4, -0.6); ctx.moveTo(1.2, 0); ctx.lineTo(0.4, 0.6); ctx.stroke(); }
    // left of the driver, heading forward, is +y rotated... in screen coords left of heading (1,0) is (0,-1)
    if (left) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -1.3); ctx.lineTo(-0.5, -0.8); ctx.moveTo(0, -1.3); ctx.lineTo(0.5, -0.8); ctx.stroke(); }
    if (right) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 1.3); ctx.lineTo(-0.5, 0.8); ctx.moveTo(0, 1.3); ctx.lineTo(0.5, 0.8); ctx.stroke(); }
    ctx.restore();
  }

  // One head per leg on the far side of the box (where the driver looks),
  // on the driver's right, on a pole. Three lamps for the leg's through (or,
  // on a stem with no through, its right), plus an arrow lamp for a leg
  // whose left has a phase of its own: it draws that movement's head, red
  // arrow included, whatever the through is showing.
  _heads(ctx, world, net, now) {
    const ctl = world.controllers[net.node];
    const blink = Math.floor(now * 2) % 2 === 0;
    for (const leg of net.legs) {
      const d = legDir(leg);
      const rr = [d[1], -d[0]];                       // driver's right, arriving
      const across = -1;                              // far side of the box
      const base = [d[0] * across * (net.boxHalf + 1.2) + rr[0] * (net.halfRoad + 1.8), d[1] * across * (net.boxHalf + 1.2) + rr[1] * (net.halfRoad + 1.8)];
      const heading = Math.atan2(-d[1], -d[0]);        // facing the driver: the head points back up the leg
      const mainMv = ['T', 'R', 'L'].map(t => `${leg}-${t}`).find(m => ctl.movements.includes(m));
      const main = ctl.head(mainMv);
      const leftMv = `${leg}-L`;
      const showArrow = ctl.movements.includes(leftMv) && protectedLeft(ctl, leftMv);
      ctx.save();
      ctx.translate(base[0], base[1]);
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, 0, 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(heading + Math.PI);
      this._headBody(ctx, main, blink, 0);
      if (showArrow) {
        // a left that is permissive right now (the 'both' phase set) shows a
        // flashing yellow arrow: take a gap, the arrow comes later
        const lh = ctl.head(leftMv);
        this._headBody(ctx, lh === 'green' && ctl.current.permissive.includes(leftMv) ? 'flash-yellow' : lh, blink, 1);
      }
      ctx.restore();
    }
  }

  _headBody(ctx, state, blink, slot) {
    const w = 1.6, h = 4.2;
    const x = slot * (w + 0.3);
    ctx.fillStyle = '#1c1c1e';
    ctx.fillRect(x - w / 2, -h / 2, w, h);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 0.15; ctx.strokeRect(x - w / 2, -h / 2, w, h);
    const lamps = ['red', 'yellow', 'green'];
    for (let i = 0; i < 3; i++) {
      const cy = -h / 2 + 0.75 + i * 1.35;
      let on = false;
      const isArrow = slot === 1;
      if (state === 'red' || state === 'flash-red') on = lamps[i] === 'red' && (state === 'red' || blink);
      else if (state === 'yellow' || state === 'yellow-arrow' || state === 'flash-yellow') on = lamps[i] === 'yellow' && (state !== 'flash-yellow' || blink);
      else if (state === 'green' || state === 'green-arrow') on = lamps[i] === 'green';
      ctx.fillStyle = on ? LAMP[lamps[i]] : LAMP.off;
      ctx.beginPath(); ctx.arc(x, cy, 0.5, 0, Math.PI * 2); ctx.fill();
      if (on) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(x - 0.15, cy - 0.15, 0.2, 0, Math.PI * 2); ctx.fill(); }
      if (isArrow && on) { ctx.fillStyle = '#111'; ctx.font = '0.9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('←', x, cy + 0.05); }
    }
  }

  _cars(ctx, world, now) {
    const S = this.scale;
    const px = Math.round(S * 2) / 2 * 2;   // sprite resolution: 2x the map scale, rounded
    for (const car of world.cars) {
      if (car.done) continue;
      const rects = car.rects();
      // trailer first, so the cab sits on top of the hitch
      if (car.stats.trailer && rects[1]) {
        const tr = rects[1];
        const pal = SPRITES.trucker.palettes[car.variant % SPRITES.trucker.palettes.length];
        ctx.save();
        ctx.translate(tr.x, tr.y); ctx.rotate(tr.heading);
        SPRITES.trucker.trailer.draw(ctx, pal);
        ctx.restore();
      }
      const body = rects[0];
      const sp = spriteFor(car.archetype, car.variant, px, now);
      ctx.save();
      ctx.translate(body.x, body.y); ctx.rotate(body.heading);
      if (car.crashed) ctx.globalAlpha = 0.8;
      if (car.archetype === 'emergency' && !car.priority) {
        ctx.strokeStyle = blinkColor(now); ctx.lineWidth = 0.5;
        ctx.strokeRect(-body.length / 2 - 0.6, -body.width / 2 - 0.6, body.length + 1.2, body.width + 1.2);
      }
      if (this.selected === car.id) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.3;
        ctx.strokeRect(-body.length / 2 - 0.4, -body.width / 2 - 0.4, body.length + 0.8, body.width + 0.8);
      }
      ctx.scale(1 / px, 1 / px);
      ctx.drawImage(sp.canvas, -sp.ox, -sp.oy);
      ctx.restore();
      if (car.crashed) {
        ctx.save(); ctx.translate(body.x, body.y);
        ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 0.35;
        ctx.beginPath(); ctx.moveTo(-1.2, -1.2); ctx.lineTo(1.2, 1.2); ctx.moveTo(1.2, -1.2); ctx.lineTo(-1.2, 1.2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  _effects(ctx, world) {
    const t = world.t;
    for (const m of this.crashMarks) {
      ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.heading);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(-3, -0.6); ctx.lineTo(2, -0.9); ctx.moveTo(-3, 0.6); ctx.lineTo(2, 0.9); ctx.stroke();
      ctx.restore();
    }
    this.effects = this.effects.filter(e => t - e.t0 < e.ttl);
    for (const e of this.effects) {
      const age = (t - e.t0) / e.ttl;
      let x = e.x, y = e.y;
      if (e.car) { const c = world.cars.find(c => c.id === e.car); if (c) { const p = c.path.at(c.s); x = p.x; y = p.y; } }
      ctx.save();
      ctx.globalAlpha = 1 - age * age;
      if (e.kind === 'honk') {
        ctx.translate(x, y - 3 - age * 2);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#222'; ctx.lineWidth = 0.15;
        ctx.beginPath(); ctx.ellipse(0, 0, 2.2, 1.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#222'; ctx.font = 'bold 1.4px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('!!', 0, 0.05);
      } else if (e.kind === 'text') {
        ctx.translate(x, y - 3.2 - age);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 1.6px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.3; ctx.strokeText(e.text, 0, 0); ctx.fillText(e.text, 0, 0);
      } else if (e.kind === 'crash') {
        ctx.translate(x, y);
        const r = 2 + age * 6;
        ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 0.6;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.stroke();
      } else if (e.kind === 'banner') {
        ctx.translate(x, y - 20);
        ctx.fillStyle = '#ff3b30'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000'; ctx.lineWidth = 0.6; ctx.strokeText(e.text, 0, 0); ctx.fillText(e.text, 0, 0);
      }
      ctx.restore();
    }
  }
}

function blinkColor(now) { return Math.floor(now * 6) % 2 ? '#ff3b30' : '#2f6fe6'; }

// Does this left have a phase of its own (one that carries it and does not
// list it as permissive)? Then it has an arrow lamp.
export function protectedLeft(ctl, movement) {
  return ctl.phases.some(p => p.movements.includes(movement) && !p.permissive.includes(movement));
}

export { parseMovement };
