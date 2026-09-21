// Signal City: the canvas. Reads the world, draws it, keeps nothing the sim
// needs. World units are metres with the intersection at the origin and y
// down; the camera is a scale (px per metre) and a centre, with a slow zoom.
//
// Draw order: grass, asphalt, markings, the box and crosswalks, stop lines,
// signal heads, cars (cached sprites, rotated to the path tangent, the
// trailer drawn live behind the cab), then the effects layer: honks,
// hesitations, pickups, crash marks, the priority halo.

import { spriteFor, SPRITES } from './sprites.js';
import { LANE_WIDTH, CROSSWALK, legDir } from './network.js';
import { parseMovement, exitLeg } from './signals.js';

const GRASS = '#5d7a4a';
const GRASS_2 = '#556f43';
const ASPHALT = '#3a3d42';
const ASPHALT_EDGE = '#2c2f33';
const LINE = '#e8e2c8';
const LINE_DIM = 'rgba(232,226,200,0.55)';
const LAMP = { red: '#ff3b30', yellow: '#ffc21f', green: '#2ee06b', off: '#2a2a2a' };

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
  // shows about 72 m of each, and cars arrive from off-screen. The wheel
  // zooms from there.
  fit(world) {
    const view = Math.min(world.network.legLength, 72);
    const px = Math.min(this.width, this.height);
    this.scale = Math.max(2.5, Math.min(9, px / (view * 2)));
    this.baseScale = this.scale;
    this.cx = 0; this.cy = 0;
  }

  zoomBy(f) {
    this.scale = Math.max(this.baseScale * 0.8, Math.min(this.baseScale * 3, this.scale * f));
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
    this._roads(ctx, world);
    this._heads(ctx, world, now);
    this._cars(ctx, world, now);
    this._effects(ctx, world);
    ctx.restore();
  }

  _grassTexture(ctx, world) {
    const L = world.network.legLength + 40;
    ctx.fillStyle = GRASS_2;
    for (let i = -6; i <= 6; i++) {
      for (let j = -6; j <= 6; j++) {
        if ((i * 7 + j * 13) % 5 !== 0) continue;
        ctx.fillRect(i * 33 + 9, j * 29 + 4, 14, 10);
      }
    }
    // a few blocks, so the grid reads as a city and not a field
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    const b = world.network.halfRoad + 14;
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      for (let k = 0; k < 3; k++) {
        const x = sx * (b + 4 + k * 30), y = sy * (b + 4 + ((k * 2) % 3) * 22);
        ctx.fillRect(Math.min(x, x + sx * 22), Math.min(y, y + sy * 16), 22, 16);
        if (Math.abs(x) > L || Math.abs(y) > L) break;
      }
    }
  }

  _roads(ctx, world) {
    const net = world.network;
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
        this._arrow(ctx, pt[0], pt[1], Math.atan2(-d[1], -d[0]), net.lanesForTurn('L').includes(lane), net.lanesForTurn('T').includes(lane), net.lanesForTurn('R').includes(lane));
      }
      void inSide;
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
  // on the driver's right, on a pole. Three lamps, plus an arrow lamp when
  // the left has its own state.
  _heads(ctx, world, now) {
    const net = world.network, ctl = world.controller;
    const blink = Math.floor(now * 2) % 2 === 0;
    for (const leg of net.legs) {
      const d = legDir(leg);
      const rr = [d[1], -d[0]];                       // driver's right, arriving
      const across = -1;                              // far side of the box
      const base = [d[0] * across * (net.boxHalf + 1.2) + rr[0] * (net.halfRoad + 1.8), d[1] * across * (net.boxHalf + 1.2) + rr[1] * (net.halfRoad + 1.8)];
      const heading = Math.atan2(-d[1], -d[0]);        // facing the driver: the head points back up the leg
      const through = ctl.head(`${leg}-T`);
      const left = net.legs.includes(exitLeg(leg, 'L')) ? ctl.head(`${leg}-L`) : null;
      const showArrow = left && left !== through && (left.includes('arrow') || through === 'red');
      ctx.save();
      ctx.translate(base[0], base[1]);
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, 0, 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(heading + Math.PI);
      this._headBody(ctx, through, blink, 0);
      if (showArrow) this._headBody(ctx, left, blink, 1);
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

export { parseMovement };
