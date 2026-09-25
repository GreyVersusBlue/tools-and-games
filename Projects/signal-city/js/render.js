// Signal City: the canvas. Reads the world, draws it, keeps nothing the sim
// needs. World units are metres with the intersection at the origin and y
// down; the camera is a scale (px per metre) and a centre, with a slow zoom.
//
// Draw order: grass, then per node asphalt, markings, the box and
// crosswalks, stop lines, the induction loops (lit when a car sits on them),
// signal heads, the walk lamps and call posts; then walkers, cars (cached
// sprites, rotated to the path tangent, the trailer drawn live behind the
// cab), then the effects layer: honks, hesitations, pickups, crash marks,
// the priority halo. A lane closure's cones and a school zone's beacons
// (M7) draw with the node's roads, from the world's active events.
//
// The UI pass: every inbound lane whose movement is green now is washed
// green from its stop line back, amber on yellow, so the board says what
// the panel says; a hovered phase card's movements draw as arrows over the
// box (`preview`); event banners are a queue the page draws in the DOM,
// kept here as `banners` and no longer painted over the box.
//
// The visual pass (increment 2): everything that does not move is drawn
// once onto the ground canvas under the board (grass, sidewalks and curbs,
// the asphalt with a faint noise, the markings, rooftops with drop
// shadows, trees, and the light: dusk on Rush Hour, night in an outage),
// and redrawn only when the camera, the world or the light changes
// (`staticBuilds` counts them). The board above it is transparent and
// carries only what moves: the lane washes and a coloured wash at every
// stop line, soft shadows under the cars, the cars (tinted car by car to
// the light), then over them the lights: signal lamps with a glow, brake
// lamps from each car's `braking`, indicators from its `indicator` (both
// read-only fields in cars.js), and at night the headlamps. A ground on
// its own canvas costs nothing a frame; blitting it, or tinting the whole
// board, cost 6.7 and 9.3 ms of a frame under a software Chromium.
//
// A roundabout (M8, #595) is drawn by `_ring` in place of the box: the
// ring's asphalt, a cobbled apron and a grass island in the middle, each
// leg flaring round a splitter island to a dashed yield line with its
// triangles, and no heads, washes or zebras (its controller is dark).
//
// The camera (M6): a single box shows the middle 72 m of its legs (#541); a
// corridor frames every box with 50 m of road either side, which on a
// 950 px board is about 3 px per metre, and the wheel zooms and a drag pans
// from there. The legs stay 110 m whatever is framed.

import { spriteFor, SPRITES } from './sprites.js';
import { LANE_WIDTH, CROSSWALK, legDir, RING_R, RING_W, YIELD_D, SPLIT, SPLIT_TAPER } from './network.js';
import { parseMovement } from './signals.js';
import { LOOP_LENGTH, TAPER } from './sim.js';

const GRASS = '#5d7a4a';
const GRASS_2 = '#556f43';
const ASPHALT = '#3a3d42';
const LINE = '#e8e2c8';
const LINE_DIM = 'rgba(232,226,200,0.55)';
const LAMP = { red: '#ff3b30', yellow: '#ffc21f', green: '#2ee06b', off: '#2a2a2a' };
const LOOP = 'rgba(232,226,200,0.35)';
const LOOP_LIT = 'rgba(79,140,255,0.85)';
const SIDEWALK = '#a9a79d';
const CURB = '#d6d4c8';
const SIDEWALK_W = 2.6;                         // metres of pavement outside the curb
const ROOFS = ['#8f8b84', '#a27453', '#707b88', '#9d968a', '#7d6f63', '#b3aca0'];
const GLOW = { red: '255,59,48', yellow: '255,194,31', green: '46,224,107' };
// multiply: over the whole ground; over: the same light laid on each car's own pixels
const TINT = { dusk: { multiply: '#e0b49e', over: 'rgba(110,60,45,0.22)' }, night: { multiply: '#3a4266', over: 'rgba(14,18,40,0.62)' } };
const WALKER_TINTS = ['#f2d16b', '#e8734a', '#7fc8f8', '#c9a0ff', '#9fe37a', '#f7f7f7'];

export class Renderer {
  constructor(canvas, ground = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ground = ground;  // a canvas under this one for the static layer; without one it is drawn off-screen and blitted
    this.scale = 4;        // px per metre
    this.cx = 0; this.cy = 0;
    this.dpr = 1;
    this.effects = [];     // { kind, x, y, t0, ttl, text }
    this.crashMarks = [];  // { x, y, heading }
    this.width = 0; this.height = 0;
    this.selected = null;  // a car id the pointer is over
    this.banners = [];     // { id, text, tone, t0, ttl }: the page shows these in a queue
    this.bannerN = 0;
    this.preview = null;   // { node, movements, permissive } while a phase card is hovered
    this.staticCanvas = null; this.staticKey = ''; this.staticWorld = null;
    this.staticBuilds = 0; // how many times the static layer has been drawn: once per camera change
    this.light = 'day';    // 'day' | 'dusk' | 'night', as last drawn
  }

  resize(cssW, cssH, dpr = 1) {
    this.dpr = dpr;
    this.width = cssW; this.height = cssH;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    if (this.ground) { this.ground.style.width = cssW + 'px'; this.ground.style.height = cssH + 'px'; }
  }

  // Frame the middle of the map: the legs run 110 m each way, the camera
  // shows about 72 m of each, and cars arrive from off-screen. A corridor
  // frames every box, 50 m of road past the outer ones. The wheel zooms and
  // a drag pans from there. A grid of more than two boxes (M9) may go
  // down to 1.2 px a metre to get them all in: a 4 by 3 district is 760 m
  // across, and at 2.5 its corners were off a 1,000 px board.
  fit(world) {
    const view = Math.min(world.network.legLength, 72);
    const { minX, maxX, minY, maxY } = this.extent(world);
    const spanX = maxX - minX + 2 * (world.nodes.length > 1 ? 50 : view);
    const spanY = maxY - minY + 2 * view;
    this.scale = Math.max(world.nodes.length > 2 ? 1.2 : 2.5, Math.min(9, Math.min(this.width / spanX, this.height / spanY)));
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
    this._slideGround();
  }

  // A drag slides the ground canvas under the board with a CSS transform
  // and redraws it once, on release: a ground redrawn every drag frame
  // costs about 40 ms a frame under a software Chromium.
  beginPan() { if (this.ground && !this.panFrom) this.panFrom = { cx: this.cx, cy: this.cy, scale: this.scale }; }
  endPan() { this.panFrom = null; this._slideGround(); }
  _slideGround() {
    if (!this.ground) return;
    const p = this.panFrom;
    this.ground.style.transform = p && p.scale === this.scale ? `translate(${(p.cx - this.cx) * this.scale}px, ${(p.cy - this.cy) * this.scale}px)` : '';
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
        case 'gridlock': this.banners.push({ id: ++this.bannerN, text: 'GRIDLOCK', tone: 'alarm', t0: world.t, ttl: 4 }); break;
        case 'event': {
          // a scripted moment (M7) announces itself in the banner queue
          const text = BANNERS[e.event] ? BANNERS[e.event][e.on ? 0 : 1] : null;
          if (text) this.banners.push({ id: ++this.bannerN, text, tone: e.on ? 'on' : 'off', t0: world.t, ttl: 3 });
          break;
        }
        // a scripted emergency on a district (#617): at 1.3 px/m among
        // twelve boxes it is 6 px long, so the banner names where it came in
        case 'spawn':
          if (e.scheduled && e.archetype === 'emergency' && car && world.level.network && world.level.network.cells) {
            this.banners.push({ id: ++this.bannerN, text: `Ambulance at Box ${car.path.node + 1} ${car.path.entry}`, tone: 'on', t0: world.t, ttl: 4 });
          }
          break;
        case 'ambulance-late': if (at) this.effects.push({ kind: 'text', text: 'LATE', x: at.x, y: at.y, t0: world.t, ttl: 2.5, car: e.car }); break;
        case 'split': if (at) this.effects.push({ kind: 'text', text: 'SPLIT', x: at.x, y: at.y, t0: world.t, ttl: 3, car: e.car }); break;
        default: break;
      }
    }
    world.events.length = 0;
    this.banners = this.banners.filter(b => world.t - b.t0 < b.ttl);
  }

  reset() { this.effects = []; this.crashMarks = []; this.banners = []; this.preview = null; this.staticWorld = null; }

  // The light a world is drawn in: night while the power is out, else the
  // level's own `light` ('dusk' on Rush Hour, R5), day when it has none.
  lightFor(world) { return world.powerOut ? 'night' : world.level && world.level.light === 'dusk' ? 'dusk' : 'day'; }

  // The layer nothing moves on, drawn at device resolution for the camera
  // as it is, and kept until the camera or the world changes.
  _staticLayer(world) {
    const light = this.lightFor(world);
    // mid-drag the ground stands where the drag began (see beginPan); a zoom mid-drag ends the slide
    if (this.panFrom && this.panFrom.scale !== this.scale) this.panFrom = null;
    const keyAt = cam => [this.width, this.height, this.dpr, this.scale, cam.cx, cam.cy, light].join('|');
    if (this.staticCanvas && this.staticWorld === world && this.staticKey === keyAt(this.panFrom || this)) return this.staticCanvas;
    // a rebuild (a first frame, a new world, the light turning) mid-drag draws where the camera is and slides on from there
    if (this.panFrom) this.panFrom = { cx: this.cx, cy: this.cy, scale: this.scale };
    this._slideGround();
    const key = keyAt(this);
    const W = Math.max(1, Math.round(this.width * this.dpr)), H = Math.max(1, Math.round(this.height * this.dpr));
    if (this.ground) { this.staticCanvas = this.ground; if (this.ground.width !== W) this.ground.width = W; if (this.ground.height !== H) this.ground.height = H; }
    else if (!this.staticCanvas || this.staticCanvas.width !== W || this.staticCanvas.height !== H) this.staticCanvas = makeCanvas(W, H);
    const g = this.staticCanvas.getContext('2d');
    const S = this.scale;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = GRASS;
    g.fillRect(0, 0, this.width, this.height);
    g.translate(this.width / 2 - this.cx * S, this.height / 2 - this.cy * S);
    g.scale(S, S);
    this._grassTexture(g, world);
    for (const net of world.nodes) {
      g.save();
      g.translate(net.origin[0], net.origin[1]);
      this._roads(g, world, net);
      g.restore();
    }
    const blocks = this._blocks(g, world);
    this._trees(g, world, blocks);
    if (light !== 'day') {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = TINT[light].multiply;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
    this.staticWorld = world; this.staticKey = key; this.staticBuilds++;
    return this.staticCanvas;
  }

  draw(world, now) {
    const { ctx } = this;
    const S = this.scale;
    const layer = this._staticLayer(world);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.ground) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    else ctx.drawImage(layer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.width / 2 - this.cx * S, this.height / 2 - this.cy * S);
    ctx.scale(S, S);
    const perNode = fn => { for (const net of world.nodes) { ctx.save(); ctx.translate(net.origin[0], net.origin[1]); fn(net); ctx.restore(); } };
    perNode(net => {
      this._greenLanes(ctx, world, net);
      this._stopWash(ctx, world, net);
      this._closures(ctx, world, net);
      this._loops(ctx, world, net);
    });
    this._walkers(ctx, world, now);
    this._carShadows(ctx, world);
    this._cars(ctx, world, now);
    // the light: the ground was tinted when it was drawn; each car and
    // walker is tinted here over its own body (source-atop touches only
    // what is already drawn), and everything after glows through it
    this.light = this.lightFor(world);
    if (this.light !== 'day') this._tintMovers(ctx, world);
    perNode(net => {
      this._beacons(ctx, world, net, now);
      if (!net.roundabout) this._heads(ctx, world, net, now);
      if (world.controllers[net.node].hasPeds) this._pedHeads(ctx, world, net, now);
    });
    this._carLamps(ctx, world);
    this._preview(ctx, world);
    this._effects(ctx, world);
    ctx.restore();
  }

  // A wash across each inbound lane just behind its stop line, in the
  // colour that lane is showing: red, amber or green. Nothing while dark.
  _stopWash(ctx, world, net) {
    const ctl = world.controllers[net.node];
    if (ctl.stage === 'dark') return;
    const sd = net.stopDist;
    for (const leg of net.legs) {
      const d = legDir(leg);
      const flashing = ctl.stage === 'flash';
      for (let lane = 0; lane < net.lanesPerDir; lane++) {
        let st = this.laneState(world, net, leg, lane) || 'red';
        if (flashing) st = ['L', 'T', 'R'].some(t => ctl.movements.includes(`${leg}-${t}`) && ctl.head(`${leg}-${t}`) === 'flash-yellow') ? 'yellow' : 'red';
        const a = net.lanePoint(leg, lane, true, sd - 0.2), b = net.lanePoint(leg, lane, true, sd + 2.6);
        const ax = a[0] - net.origin[0], ay = a[1] - net.origin[1], bx = b[0] - net.origin[0], by = b[1] - net.origin[1];
        const w = LANE_WIDTH - 0.3, px = -d[1] * w / 2, py = d[0] * w / 2;
        const g = ctx.createLinearGradient(ax, ay, bx, by);
        g.addColorStop(0, `rgba(${GLOW[st]},0.55)`); g.addColorStop(1, `rgba(${GLOW[st]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(ax + px, ay + py); ctx.lineTo(bx + px, by + py); ctx.lineTo(bx - px, by - py); ctx.lineTo(ax - px, ay - py); ctx.closePath();
        ctx.fill();
      }
    }
  }

  _tintMovers(ctx, world) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = TINT[this.light].over;
    for (const car of world.cars) {
      if (car.done) continue;
      for (const r of car.rects()) {
        if (!r) continue;
        ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.heading);
        ctx.fillRect(-r.length / 2 - 0.3, -r.width / 2 - 0.3, r.length + 0.6, r.width + 0.6);
        ctx.restore();
      }
    }
    for (const w of world.walkers) if (!w.done) ctx.fillRect(w.x - 0.6, w.y - 0.7, 1.2, 1.4);
    ctx.restore();
  }

  // A soft shadow under every car and trailer: two offset rounded shapes,
  // the wider one fainter, so the edge reads soft without a blur.
  _carShadows(ctx, world) {
    for (const car of world.cars) {
      if (car.done) continue;
      for (const r of car.rects()) {
        if (!r) continue;
        ctx.save();
        ctx.translate(r.x + 0.35, r.y + 0.55); ctx.rotate(r.heading);
        ctx.fillStyle = 'rgba(0,0,0,0.13)';
        roundRect(ctx, -r.length / 2 - 0.35, -r.width / 2 - 0.35, r.length + 0.7, r.width + 0.7, 0.9); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        roundRect(ctx, -r.length / 2, -r.width / 2, r.length, r.width, 0.6); ctx.fill();
        ctx.restore();
      }
    }
  }

  // The lamps on the cars, over the tint: brake lamps from `car.braking`
  // (on the trailer's tail when there is one), the indicator from
  // `car.indicator` at the front and rear corners on that side, blinking on
  // the world's clock so a paused board holds still, and at night a pool
  // of headlamp ahead of every car.
  _carLamps(ctx, world) {
    const blinkOn = Math.floor(world.t * 3) % 2 === 0;
    const night = this.light === 'night';
    for (const car of world.cars) {
      if (car.done) continue;
      const rects = car.rects();
      const body = rects[0], tail = rects[1] || body;
      if (night) {
        ctx.save();
        ctx.translate(body.x, body.y); ctx.rotate(body.heading);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,214,140,0.13)';
        ctx.beginPath(); ctx.ellipse(body.length / 2 + 4, 0, 4.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,214,140,0.16)';
        ctx.beginPath(); ctx.ellipse(body.length / 2 + 2.2, 0, 2.4, 1.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      if (car.braking) {
        ctx.save();
        ctx.translate(tail.x, tail.y); ctx.rotate(tail.heading);
        const x = -tail.length / 2 + 0.12;
        for (const side of [-1, 1]) {
          const y = side * (tail.width / 2 - 0.4);
          ctx.fillStyle = 'rgba(255,40,20,0.32)'; ctx.beginPath(); ctx.arc(x - 0.2, y, 0.85, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ff2a1a'; ctx.fillRect(x - 0.12, y - 0.28, 0.3, 0.56);
        }
        ctx.restore();
      }
      const ind = car.indicator;
      if (ind && blinkOn) {
        const side = ind === 'L' ? -1 : 1;   // +y is the car's right
        for (const [r, x] of [[body, body.length / 2 - 0.3], [tail, -tail.length / 2 + 0.3]]) {
          ctx.save();
          ctx.translate(r.x, r.y); ctx.rotate(r.heading);
          const y = side * (r.width / 2 - 0.1);
          ctx.fillStyle = 'rgba(255,179,26,0.35)'; ctx.beginPath(); ctx.arc(x, y, 0.8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffb31a'; ctx.beginPath(); ctx.arc(x, y, 0.3, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  // Which way each inbound lane is going right now: 'green' if any
  // movement it carries is green (arrow or ball), else 'yellow' if any is
  // yellow, else null. Read from the controller's heads, nothing else.
  laneState(world, net, leg, lane) {
    const ctl = world.controllers[net.node];
    let st = null;
    for (const turn of ['L', 'T', 'R']) {
      const m = `${leg}-${turn}`;
      if (!ctl.movements.includes(m) || !net.lanesForTurn(turn).includes(lane)) continue;
      const h = ctl.head(m);
      if (h === 'green' || h === 'green-arrow') return 'green';
      if (h === 'yellow' || h === 'yellow-arrow') st = 'yellow';
    }
    return st;
  }

  // The wash on every lane that may go: from the stop line back up the
  // approach, fading out over 36 m.
  _greenLanes(ctx, world, net) {
    const sd = net.stopDist, len = 36;
    for (const leg of net.legs) {
      const d = legDir(leg);
      for (let lane = 0; lane < net.lanesPerDir; lane++) {
        const st = this.laneState(world, net, leg, lane);
        if (!st) continue;
        const a = net.lanePoint(leg, lane, true, sd), b = net.lanePoint(leg, lane, true, sd + len);
        const ax = a[0] - net.origin[0], ay = a[1] - net.origin[1], bx = b[0] - net.origin[0], by = b[1] - net.origin[1];
        const g = ctx.createLinearGradient(ax, ay, bx, by);
        const rgb = st === 'green' ? '46,224,107' : '255,194,31';
        g.addColorStop(0, `rgba(${rgb},0.42)`); g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        const w = LANE_WIDTH - 0.5;
        const px = -d[1] * w / 2, py = d[0] * w / 2;   // across the lane
        ctx.beginPath();
        ctx.moveTo(ax + px, ay + py); ctx.lineTo(bx + px, by + py); ctx.lineTo(bx - px, by - py); ctx.lineTo(ax - px, ay - py); ctx.closePath();
        ctx.fill();
      }
    }
  }

  // A hovered phase card's movements as arrows over the box: each along a
  // real path of that movement, from 8 m before its stop line to 6 m past
  // the box, with a head at the end. A permissive left is dashed.
  _preview(ctx, world) {
    const pv = this.preview;
    if (!pv) return;
    const net = world.nodes[pv.node];
    if (!net) return;
    for (const m of pv.movements) {
      let path = null;
      for (const p of net.paths.values()) if (p.movement === m) { path = p; break; }
      if (!path) continue;
      const s0 = path.stopLine - 8, s1 = path.boxExit + 6;
      const pts = [];
      for (let s = s0; s < s1; s += 1) pts.push(path.at(s));
      const end = path.at(s1);
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const [w, colour] of [[1.9, 'rgba(10,14,20,0.55)'], [1.1, '#7fd4ff']]) {
        ctx.strokeStyle = colour; ctx.lineWidth = w;
        ctx.setLineDash(pv.permissive.includes(m) ? [1.6, 1.2] : []);
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.lineTo(end.x, end.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.translate(end.x, end.y); ctx.rotate(end.heading);
      ctx.fillStyle = '#7fd4ff'; ctx.strokeStyle = 'rgba(10,14,20,0.55)'; ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.moveTo(2.6, 0); ctx.lineTo(-0.6, -1.7); ctx.lineTo(-0.6, 1.7); ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.restore();
    }
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
    ctx.fillStyle = GRASS_2;
    const { minX, maxX, minY, maxY } = this.extent(world);
    const i0 = Math.floor((minX - 120) / 33), i1 = Math.ceil((maxX + 120) / 33);
    // -6 to 6 is the band one street needs; a grid (M9) runs further south
    const j0 = Math.min(-6, Math.floor((minY - 150) / 29)), j1 = Math.max(6, Math.ceil((maxY + 150) / 29));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        if (((i * 7 + j * 13) % 5 + 5) % 5 !== 0) continue;
        ctx.fillRect(i * 33 + 9, j * 29 + 4, 14, 10);
      }
    }
  }

  // The blocks, so the grid reads as a city and not a field: the same
  // places they always stood, drawn now as rooftops with a drop shadow to
  // the south-east, a parapet and a unit or two on the roof. Returns the
  // rectangles, for the trees to keep out of.
  _blocks(ctx, world) {
    const L = world.network.legLength + 40;
    const out = [];
    let n = 0;
    for (const net of world.nodes) {
      const b = net.halfRoad + 14;
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        for (let k = 0; k < 3; k++) {
          const x = sx * (b + 4 + k * 30), y = sy * (b + 4 + ((k * 2) % 3) * 22);
          out.push({ x: net.origin[0] + Math.min(x, x + sx * 22), y: net.origin[1] + Math.min(y, y + sy * 16), w: 22, h: 16, n: n++ });
          if (Math.abs(x) > L || Math.abs(y) > L) break;
        }
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (const r of out) ctx.fillRect(r.x + 1.1, r.y + 1.5, r.w, r.h);
    for (const r of out) {
      const h = hash2(r.n, 7);
      const roof = ROOFS[h % ROOFS.length];
      ctx.fillStyle = roof; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.5; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(r.x + 0.8, r.y + 0.8, r.w - 1.6, (r.h - 1.6) / 2);
      // one or two rooftop units, each with its own small shadow
      for (let u = 0; u < 1 + (h >>> 3) % 2; u++) {
        const ux = r.x + 3 + ((h >>> (4 + u * 3)) % 12), uy = r.y + 3 + ((h >>> (6 + u * 2)) % 7), uw = 2.6 + u, uh = 2;
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(ux + 0.4, uy + 0.6, uw, uh);
        ctx.fillStyle = '#c7cacd'; ctx.fillRect(ux, uy, uw, uh);
      }
    }
    return out;
  }

  // Trees on the grass: a jittered 9 m grid in world coordinates (so a pan
  // does not reshuffle them), about a third kept, none on a road, its
  // pavement or a block.
  _trees(ctx, world, blocks) {
    const tl = this.toWorld(0, 0), br = this.toWorld(this.width, this.height);
    const G = 9;
    const trees = [];
    for (let i = Math.floor(tl.x / G) - 1; i <= Math.ceil(br.x / G) + 1; i++) {
      for (let j = Math.floor(tl.y / G) - 1; j <= Math.ceil(br.y / G) + 1; j++) {
        const h = hash2(i, j);
        if (h % 100 >= 34) continue;
        const x = i * G + ((h >>> 8) % 60) / 10, y = j * G + ((h >>> 14) % 60) / 10, r = 1.5 + ((h >>> 20) % 10) / 10;
        const clear = r + 1.2;
        if (world.nodes.some(net => Math.abs(x - net.origin[0]) < net.halfRoad + SIDEWALK_W + clear || Math.abs(y - net.origin[1]) < net.halfRoad + SIDEWALK_W + clear)) continue;
        // a ring's disc, and its legs' flare round the splitter
        if (world.nodes.some(net => net.roundabout && (Math.hypot(x - net.origin[0], y - net.origin[1]) < RING_R + RING_W / 2 + SIDEWALK_W + clear
          || Math.abs(x - net.origin[0]) < net.halfRoad + SPLIT + SIDEWALK_W + clear || Math.abs(y - net.origin[1]) < net.halfRoad + SPLIT + SIDEWALK_W + clear))) continue;
        if (blocks.some(b => x > b.x - clear && x < b.x + b.w + clear && y > b.y - clear && y < b.y + b.h + clear)) continue;
        trees.push({ x, y, r, h });
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (const t of trees) { ctx.beginPath(); ctx.arc(t.x + 0.8, t.y + 1.1, t.r, 0, Math.PI * 2); ctx.fill(); }
    for (const t of trees) {
      ctx.fillStyle = (t.h >>> 5) % 2 ? '#3d6a34' : '#456f37'; ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(150,200,110,0.3)'; ctx.beginPath(); ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.55, 0, Math.PI * 2); ctx.fill();
    }
  }

  // One node's roads, drawn about its own origin (the caller translates).
  _roads(ctx, world, net) {
    if (net.roundabout) { this._ring(ctx, world, net); return; }
    const half = net.halfRoad;
    const L = net.legLength + 60;   // past the map edge: a board sized to the window can show 130 m of a cross street
    const bh = net.boxHalf, R = net.cornerRadius, sw = SIDEWALK_W;
    const has = leg => net.legs.includes(leg);
    // the pavement along both edges of every leg, from the box out
    ctx.fillStyle = SIDEWALK;
    for (const leg of net.legs) {
      const d = legDir(leg);
      if (d[0] === 0) { const y = d[1] < 0 ? -L : bh; ctx.fillRect(-half - sw, y, sw, L - bh); ctx.fillRect(half, y, sw, L - bh); }
      else { const x = d[0] < 0 ? -L : bh; ctx.fillRect(x, -half - sw, L - bh, sw); ctx.fillRect(x, half, L - bh, sw); }
    }
    // asphalt legs, with the faint noise over them
    const asphalt = draw => { ctx.fillStyle = ASPHALT; draw(); ctx.fillStyle = noisePattern(ctx); draw(); };
    asphalt(() => {
      for (const leg of net.legs) {
        const d = legDir(leg);
        if (d[0] === 0) ctx.fillRect(-half, d[1] < 0 ? -L : 0, half * 2, L);
        else ctx.fillRect(d[0] < 0 ? -L : 0, -half, L, half * 2);
      }
      ctx.fillRect(-bh, -bh, bh * 2, bh * 2);
    });
    // each corner of the box: the curb turns on a radius R about the
    // block's corner, with the pavement inside it and grass inside that;
    // a side of the box with no leg (the Stem's) is a straight curb
    ctx.strokeStyle = CURB; ctx.lineWidth = 0.28;
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const vert = has(sy < 0 ? 'N' : 'S'), horiz = has(sx < 0 ? 'W' : 'E');
      const cx = sx * bh, cy = sy * bh;
      const u0 = [-sx, 0], u1 = [0, -sy];          // from the block's corner toward the two legs
      const sector = (r0, r1) => {
        ctx.beginPath();
        for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI / 2; ctx.lineTo(cx + (u0[0] * Math.cos(a) + u1[0] * Math.sin(a)) * r1, cy + (u0[1] * Math.cos(a) + u1[1] * Math.sin(a)) * r1); }
        for (let k = 12; k >= 0; k--) { const a = (k / 12) * Math.PI / 2; ctx.lineTo(cx + (u0[0] * Math.cos(a) + u1[0] * Math.sin(a)) * r0, cy + (u0[1] * Math.cos(a) + u1[1] * Math.sin(a)) * r0); }
        ctx.closePath();
      };
      ctx.fillStyle = SIDEWALK; sector(Math.max(0, R - sw), R); ctx.fill();
      ctx.fillStyle = GRASS; sector(0, Math.max(0, R - sw)); ctx.fill();
      if (!horiz) { ctx.fillStyle = SIDEWALK; ctx.fillRect(sx > 0 ? bh : -bh - sw, Math.min(0, sy * half), sw, half); }
      if (!vert) { ctx.fillStyle = SIDEWALK; ctx.fillRect(Math.min(0, sx * half), sy > 0 ? bh : -bh - sw, half, sw); }
      ctx.beginPath();
      for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI / 2; ctx.lineTo(cx + (u0[0] * Math.cos(a) + u1[0] * Math.sin(a)) * R, cy + (u0[1] * Math.cos(a) + u1[1] * Math.sin(a)) * R); }
      ctx.stroke();
      if (!horiz) { ctx.beginPath(); ctx.moveTo(sx * bh, sy * half); ctx.lineTo(sx * bh, 0); ctx.stroke(); }
      if (!vert) { ctx.beginPath(); ctx.moveTo(sx * half, sy * bh); ctx.lineTo(0, sy * bh); ctx.stroke(); }
    }
    // the curb down both edges of every leg
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

  // A roundabout's ground, about its own origin (see the header).
  _ring(ctx, world, net) {
    const half = net.halfRoad, L = net.legLength + 60, sw = SIDEWALK_W;
    const outer = RING_R + RING_W / 2, island = RING_R - RING_W / 2;
    const flare = YIELD_D + SPLIT_TAPER, wide = half + SPLIT;
    // each leg's outline: its full width out to the flare's start, tapering
    // to `wide` at the yield line and holding it into the ring
    const outline = (leg, grow) => {
      const d = legDir(leg), r = [-d[1], d[0]];
      const at = (along, lat) => [d[0] * along + r[0] * lat, d[1] * along + r[1] * lat];
      return [at(L, half + grow), at(flare, half + grow), at(YIELD_D, wide + grow), at(RING_R, wide + grow),
        at(RING_R, -wide - grow), at(YIELD_D, -wide - grow), at(flare, -half - grow), at(L, -half - grow)];
    };
    const poly = pts => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    const disc = r => { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); };
    ctx.fillStyle = SIDEWALK;
    for (const leg of net.legs) { poly(outline(leg, sw)); ctx.fill(); }
    disc(outer + sw); ctx.fill();
    const asphalt = draw => { ctx.fillStyle = ASPHALT; draw(); ctx.fillStyle = noisePattern(ctx); draw(); };
    asphalt(() => { for (const leg of net.legs) { poly(outline(leg, 0)); ctx.fill(); } disc(outer); ctx.fill(); });
    // the curbs: every leg's two edges, and the ring's outer edge between legs
    ctx.strokeStyle = CURB; ctx.lineWidth = 0.28;
    for (const leg of net.legs) {
      const o = outline(leg, 0);
      ctx.beginPath(); ctx.moveTo(...o[0]); ctx.lineTo(...o[1]); ctx.lineTo(...o[2]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...o[7]); ctx.lineTo(...o[6]); ctx.lineTo(...o[5]); ctx.stroke();
    }
    const legAng = net.legs.map(l => Math.atan2(legDir(l)[1], legDir(l)[0])).sort((a, b) => a - b);
    const gap = Math.asin(Math.min(1, (wide + 0.3) / outer));
    legAng.forEach((a, i) => {
      const b = i + 1 < legAng.length ? legAng[i + 1] : legAng[0] + 2 * Math.PI;
      ctx.beginPath(); ctx.arc(0, 0, outer, a + gap, b - gap); ctx.stroke();
    });
    // the island: a cobbled apron a truck's trailer may cut, grass inside it
    ctx.fillStyle = '#8c857a'; disc(island); ctx.fill();
    ctx.fillStyle = GRASS; disc(island - 1.4); ctx.fill();
    ctx.strokeStyle = CURB; disc(island); ctx.stroke(); disc(island - 1.4); ctx.stroke();
    for (const leg of net.legs) {
      const d = legDir(leg), r = [-d[1], d[0]];
      const at = (along, lat) => [d[0] * along + r[0] * lat, d[1] * along + r[1] * lat];
      // the splitter island between the way in and the way out
      const tip = flare - 4, edge = SPLIT - 0.35;
      ctx.fillStyle = SIDEWALK; ctx.strokeStyle = CURB;
      poly([at(tip, 0), at(YIELD_D, edge), at(outer + 0.6, edge), at(outer + 0.6, -edge), at(YIELD_D, -edge)]); ctx.fill(); ctx.stroke();
      // the centre line out from the splitter's tip
      ctx.strokeStyle = '#e0b830'; ctx.lineWidth = 0.25;
      for (const off of [-0.35, 0.35]) { ctx.beginPath(); ctx.moveTo(...at(tip, off)); ctx.lineTo(...at(L, off)); ctx.stroke(); }
      // the yield line across the way in (on the driver's right arriving:
      // -r here), dashed, with its triangles pointing at the driver
      const inSide = -1;
      ctx.strokeStyle = LINE; ctx.lineWidth = 0.4; ctx.setLineDash([0.6, 0.5]);
      ctx.beginPath(); ctx.moveTo(...at(YIELD_D, inSide * edge)); ctx.lineTo(...at(YIELD_D, inSide * wide)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = LINE_DIM;
      for (let lat = edge + 0.5; lat < wide - 0.4; lat += 1.1) {
        poly([at(YIELD_D + 0.6, inSide * (lat - 0.4)), at(YIELD_D + 0.6, inSide * (lat + 0.4)), at(YIELD_D + 1.6, inSide * lat)]); ctx.fill();
      }
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

  // A lane closure's cones (M7): a taper from the curb across the closed
  // lane, then a line of cones down the lane's inner edge to the stop line,
  // the closed stretch tinted, and a sign at the curb where the taper
  // begins. Geometry from the event: `d0` is the first cone's distance
  // from the centre, `length` the coned stretch back from the stop line.
  _closures(ctx, world, net) {
    for (const e of world.active) {
      if (e.kind !== 'closure' || e.node !== net.node) continue;
      const d = legDir(e.leg);
      const rr = [d[1], -d[0]];                          // the driver's right, arriving: toward the curb
      const inner = (net.lanesPerDir - e.lane - 0.5) * LANE_WIDTH;   // the closed lane's centre, along rr
      const at = (dist, off) => [d[0] * dist + rr[0] * (inner + off), d[1] * dist + rr[1] * (inner + off)];
      const sd = net.stopDist, d0 = e.d0, half = LANE_WIDTH / 2;
      // the tint
      ctx.save();
      ctx.fillStyle = 'rgba(255,140,0,0.14)';
      ctx.beginPath();
      const c0 = at(sd, -half), c1 = at(d0 - TAPER, -half), c2 = at(d0, half), c3 = at(sd, half);
      ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(c3[0], c3[1]); ctx.closePath(); ctx.fill();
      ctx.restore();
      // the cones: the taper, then the line
      const cones = [];
      for (let k = 0; k <= 4; k++) cones.push(at(d0 - TAPER * k / 4, half - LANE_WIDTH * k / 4));
      for (let dist = d0 - TAPER - 3; dist > sd + 0.8; dist -= 3) cones.push(at(dist, -half + 0.2));
      for (const [x, y] of cones) {
        ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(x, y, 0.36, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.1; ctx.beginPath(); ctx.arc(x, y, 0.2, 0, Math.PI * 2); ctx.stroke();
      }
      // the sign at the curb
      const [sx, sy] = at(d0 + 4, half + 1.6);
      ctx.save();
      ctx.translate(sx, sy); ctx.rotate(Math.atan2(-d[1], -d[0]) + Math.PI / 4);
      ctx.fillStyle = '#ff7a1a'; ctx.fillRect(-1.3, -1.3, 2.6, 2.6);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 0.15; ctx.strokeRect(-1.3, -1.3, 2.6, 2.6);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#111'; ctx.font = 'bold 0.62px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('LANE', 0, -0.35); ctx.fillText('CLOSED', 0, 0.4);
      ctx.restore();
    }
  }

  // A school zone's beacons (M7): on every leg, a yellow diamond at the
  // curb 14 m before the stop line with a lamp above it, flashing while the
  // zone is in force. Nothing draws when it is not.
  _beacons(ctx, world, net, now) {
    const zone = world.activeEvent('school');
    if (!zone) return;
    const on = Math.floor(now * 2) % 2 === 0;
    for (const leg of net.legs) {
      const d = legDir(leg);
      const rr = [d[1], -d[0]];
      const dist = net.stopDist + 14;
      const x = d[0] * dist + rr[0] * (net.halfRoad + 2.0), y = d[1] * dist + rr[1] * (net.halfRoad + 2.0);
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, 0, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffd21e'; ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 0.14; ctx.strokeRect(-1.2, -1.2, 2.4, 2.4);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#111'; ctx.font = 'bold 0.5px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('SCHOOL', 0, 0.05);
      ctx.fillStyle = on ? LAMP.yellow : '#4a3d10';
      ctx.beginPath(); ctx.arc(0, -2.3, 0.55, 0, Math.PI * 2); ctx.fill();
      if (on) { ctx.fillStyle = 'rgba(255,194,31,0.25)'; ctx.beginPath(); ctx.arc(0, -2.3, 1.1, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
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
      if (on) {
        ctx.fillStyle = `rgba(${GLOW[lamps[i]]},0.16)`; ctx.beginPath(); ctx.arc(x, cy, 1.9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(${GLOW[lamps[i]]},0.3)`; ctx.beginPath(); ctx.arc(x, cy, 1.05, 0, Math.PI * 2); ctx.fill();
      }
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
      if ((car.archetype === 'emergency' || car.archetype === 'motorcade') && !car.priority) {
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
      }
      ctx.restore();
    }
  }
}

// A canvas in the page, or anywhere OffscreenCanvas exists.
function makeCanvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}

// A small deterministic hash of two integers, for the trees and the roofs.
function hash2(i, j) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return; }
  ctx.rect(x, y, w, h);
}

// The asphalt's noise: a 96 px tile of dark and light specks from a fixed
// seed, made once, laid in device pixels whatever the zoom (the pattern's
// transform undoes the context's), so it reads as grain and not as blocks.
let NOISE = null;
function noisePattern(ctx) {
  if (!NOISE) {
    const c = makeCanvas(96, 96), g = c.getContext('2d'), img = g.createImageData(96, 96);
    let s = 12345;
    for (let i = 0; i < img.data.length; i += 4) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      const v = (s >>> 16) & 255;
      const light = v > 200, dark = v < 70;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = light ? 255 : 0;
      img.data[i + 3] = light ? (v - 200) * 0.22 : dark ? (70 - v) * 0.26 : 0;
    }
    g.putImageData(img, 0, 0);
    NOISE = c;
  }
  const p = ctx.createPattern(NOISE, 'repeat');
  if (p.setTransform) p.setTransform(ctx.getTransform().inverse());
  return p;
}

function blinkColor(now) { return Math.floor(now * 6) % 2 ? '#ff3b30' : '#2f6fe6'; }

// What each scripted moment (M7) announces in the banner queue, on and off.
const BANNERS = {
  surge: ['RUSH HOUR', 'RUSH HOUR OVER'], outage: ['POWER OUT', 'POWER BACK'], ambulance: ['AMBULANCE', null],
  motorcade: ['MOTORCADE', null], procession: ['PROCESSION', null],
  closure: ['LANE CLOSED', 'LANE OPEN'], school: ['SCHOOL ZONE', 'SCHOOL ZONE OVER'],
};

// Does this left have a phase of its own (one that carries it and does not
// list it as permissive)? Then it has an arrow lamp.
export function protectedLeft(ctl, movement) {
  return ctl.phases.some(p => p.movements.includes(movement) && !p.permissive.includes(movement));
}

export { parseMovement };
