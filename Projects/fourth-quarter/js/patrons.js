// patrons.js — the crowd and the crew.
// Patrons: spawn at the door → claim a seat → sit → want something →
// ticket goes to kitchen/bar → a carrier (server NPC or the boss) delivers →
// eat/drink → maybe another round → head home. Impatient patrons walk.
// Servers: claim ready tickets, fetch from the pass, deliver, repeat.

import * as THREE from "three";
import { flat, glow } from "./materials.js";
import { seats, DOOR, DOOR_OUT, PASS_FOOD, PASS_DRINK, currentLayout, floorY } from "./world.js";
import { pathToward, WALKER_R, SNAP_R } from "./layout.js";
import { MENU } from "./engine.js";
import * as audio from "./audio.js";

const ITEM_COLORS = { wings: 0xd97a2b, burger: 0x9c6b3f, nachos: 0xe3c14f, fries: 0xf0d264, beer: 0xe8a33d, soda: 0x5aa7d6 };
const SHIRTS = [0x5a6b8c, 0x6b8c5a, 0x8c5a6b, 0x7a7a7a, 0x8c7a5a, 0x4f7d7d];
const MULES_AMBER = 0xe8a33d;
const REGULAR_JACKET = 0x8a3548;   // a regular who is not a Mules fan still reads as somebody

const WALK = 1.55, SERVER_WALK = 2.0;
let _pid = 0;

/** An open stool the floor actually joins to the door. world.js hangs
 *  `reachable` on every seat from layout.js's nav grid; a stool walled off by
 *  the fit-out is not offered rather than claimed by a patron who then walks
 *  into the wall in front of it. */
export function freeSeat(prefer = null) {
  const open = seats.filter(s => !s.taken && s.reachable !== false);
  // a regular takes their usual stool: one at the bar, when the bar has one
  const liked = prefer ? open.filter(s => s.kind === prefer) : [];
  const pool = liked.length ? liked : open;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

export function itemMesh(itemId) {
  const kind = MENU[itemId].kind;
  const grp = new THREE.Group();
  if (kind === "drink") {
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.16, 10), flat(ITEM_COLORS[itemId], 0.2));
    glass.position.y = 0.08; grp.add(glass);
    if (itemId === "beer") {
      const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.05, 0.03, 10), flat(0xf6ecd8, 0.9));
      foam.position.y = 0.17; grp.add(foam);
    }
  } else {
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 12), flat(0xd8d2c6, 0.7));
    tray.position.y = 0.015; grp.add(tray);
    const heap = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), flat(ITEM_COLORS[itemId], 0.85));
    heap.scale.y = 0.55; heap.position.y = 0.07; grp.add(heap);
  }
  return grp;
}

export function personMesh(shirtColor, isServer = false) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.78, 10), flat(shirtColor, 0.9));
  body.position.y = 0.75; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), flat(0xd9a878, 0.8));
  head.position.y = 1.32; head.castShadow = true; g.add(head);
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.4, 8), flat(0x22252c, 0.9));
  legs.position.y = 0.2; g.add(legs);
  if (isServer) {
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.02), flat(0x14100c, 0.9));
    apron.position.set(0, 0.7, 0.19); g.add(apron);
  }
  return g;
}

/** The name over a regular's head: a sprite, so it faces you from any side
 *  of the room. Sits above the order bubble (1.75) and the boss's marker
 *  cone (2.15). */
export function nameplate(text) {
  const c = document.createElement("canvas"); c.width = 384; c.height = 96;
  const ctx = c.getContext("2d");
  ctx.font = "bold 44px Impact, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#f2e9dc"; ctx.shadowColor = "#000"; ctx.shadowBlur = 10;
  ctx.fillText(text, 192, 48);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(1.3, 0.325, 1);
  sp.position.y = 2.45;
  sp.name = "nameplate";
  return sp;
}

function bubble(itemId) {
  // floating "I want this" marker above a patron's head
  const g = new THREE.Group();
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 12), glow(0xf2e9dc, 0.35));
  g.add(puck);
  const im = itemMesh(itemId); im.scale.setScalar(0.9); im.position.y = 0.03; g.add(im);
  g.position.y = 1.75;
  return g;
}

// ---------------------------------------------------------------- Patron
export class Patron {
  /** `regular` is one of campaign.js's regulars, when this body is one: they
   *  wear a name, sit at the bar when it has a stool, and order the usual. */
  constructor(scene, engine, mulesFan, regular = null) {
    this.id = ++_pid;
    this.engine = engine;
    this.scene = scene;
    this.mulesFan = mulesFan;
    this.regular = regular;
    this.snubbed = false;      // came in for the usual and the shelf was bare
    this.comped = false;       // the boss put the first round on the house
    this.compPending = false;  // comped before the order was in: the ticket opens at $0
    this.mesh = personMesh(mulesFan ? MULES_AMBER : regular ? REGULAR_JACKET : SHIRTS[Math.floor(Math.random() * SHIRTS.length)]);
    if (regular) this.mesh.add(nameplate(regular.name.split(" ")[0]));
    this.mesh.position.copy(DOOR);
    this.mesh.position.x += (Math.random() - 0.5) * 0.6;
    scene.add(this.mesh);
    this.state = "entering";
    this.seat = freeSeat(regular ? "bar" : null);
    this.round = 0;
    this.timer = 0;
    this.ticket = null;
    this.bubbleMesh = null;
    this.consumeMesh = null;
    this.cheer = 0;
    this.bob = Math.random() * Math.PI * 2;
    this.route = new Route();
    if (!this.seat) { this.state = "leaving"; engine.walkout(this.id); }
    else this.seat.taken = true;
  }

  get pos() { return this.mesh.position; }

  wantsNext() {
    this.state = "deciding";
    this.timer = 2 + Math.random() * 6;
  }

  placeOrder() {
    const r = this.regular;
    const opts = { regularId: r ? r.id : null, comped: this.compPending };
    // a regular's first round is the usual, pre-filled; the engine says so
    // when the shelf is bare and picks what anyone else would get instead
    let itemId = r ? this.engine.usualFor(r, this.round) : this.engine.chooseOrder(this.round);
    let ticket = itemId ? this.engine.placeTicket(this.id, itemId, opts) : null;
    if (!ticket && itemId) { // lost the last serving in a race — pick again
      itemId = r ? this.engine.usualFor(r, this.round) : this.engine.chooseOrder(this.round);
      ticket = itemId ? this.engine.placeTicket(this.id, itemId, opts) : null;
    }
    if (!ticket) { this.emptyShelves = true; this.stormOut(); return; }
    if (r && this.round === 0 && itemId !== r.usual) this.snubbed = true;
    this.compPending = false;
    if (ticket.comped) this.comped = true;
    this.ticket = ticket;
    audio.playSfx("orderDing");
    this.bubbleMesh = bubble(itemId);
    this.mesh.add(this.bubbleMesh);
    this.state = "waiting";
  }

  receive(itemId) {
    if (this.bubbleMesh) { this.mesh.remove(this.bubbleMesh); this.bubbleMesh = null; }
    this.consumeMesh = itemMesh(itemId);
    this.consumeMesh.position.set(0.28, 0.95, 0);
    this.mesh.add(this.consumeMesh);
    this.ticket = null;
    this.state = "consuming";
    this.timer = 12 + Math.random() * 14;
    this.round++;
  }

  stormOut() {
    if (this.bubbleMesh) { this.mesh.remove(this.bubbleMesh); this.bubbleMesh = null; }
    this.releaseSeat();
    this.state = "leaving";
    this.engine.walkout(this.id);
    audio.playSfx("stormOut");
  }

  releaseSeat() { if (this.seat) { this.seat.taken = false; this.seat = null; } }

  /** Can the boss still put this one's first round on the house? Only a
   *  regular, only their first round, only once, and only while they are in
   *  the room — a regular on their second beer has already paid for the first. */
  canComp() {
    return !!this.regular && !this.comped && this.round === 0
      && (this.state === "entering" || this.state === "settling" || this.state === "deciding" || this.state === "waiting");
  }

  /** The first round, on the house. If the ticket is already in, it rings at
   *  $0 from here; if not, the one they are about to order opens at $0. The
   *  engine keeps the record the books settle on. Returns false when there is
   *  nothing to comp. */
  compFirstRound() {
    if (!this.canComp()) return false;
    if (this.ticket) {
      if (!this.engine.comp(this.ticket.id)) return false;
    } else this.compPending = true;
    this.comped = true;
    return true;
  }

  /** No route to the stool it claimed: hand the stool back and leave. This
   *  should not fire, because freeSeat() only offers stools the floor joins
   *  to — but a patron whose target went unreachable leaves rather than
   *  stands in the room for the rest of the night. */
  strand() {
    this.releaseSeat();
    this.route.clear();
    this.state = "leaving";
    this.engine.walkout(this.id);
  }

  update(dt) {
    const m = this.mesh;
    this.bob += dt * 3;
    if (this.bubbleMesh) this.bubbleMesh.position.y = 1.75 + Math.sin(this.bob * 1.6) * 0.05;
    if (this.cheer > 0) {
      this.cheer -= dt;
      m.children[0].position.y = 0.75 + Math.abs(Math.sin(this.cheer * 9)) * 0.12;
      if (this.cheer <= 0) m.children[0].position.y = 0.75;
    }
    switch (this.state) {
      case "entering": {
        if (!this.route.aim(m.position, this.seat.approach)) { this.strand(); break; }
        const wp = this.route.head();
        if (wp) m.lookAt(wp.x, m.position.y, wp.z);
        if (this.route.step(m.position, WALK * dt)) {
          this.route.clear();
          m.position.copy(this.seat.pos);
          m.lookAt(this.seat.approach.x, m.position.y, this.seat.approach.z);
          m.rotateY(Math.PI);
          this.state = "settling"; this.timer = 1.5 + Math.random() * 3;
        }
        break;
      }
      case "settling":
        this.timer -= dt;
        if (this.timer <= 0) this.wantsNext();
        break;
      case "deciding":
        this.timer -= dt;
        if (this.timer <= 0) this.placeOrder();
        break;
      case "consuming":
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.consumeMesh) { this.mesh.remove(this.consumeMesh); this.consumeMesh = null; }
          const anotherRound = this.round < 3 && Math.random() < (this.engine.gameNight && !this.engine.game.finished ? 0.72 : 0.45);
          if (anotherRound) this.wantsNext();
          else { this.releaseSeat(); this.engine.depart(); this.state = "leaving"; }
        }
        break;
      case "leaving": {
        // the exit sits outside the room, so it plans with the exit's slack;
        // a patron the floor cannot join to it walks to the nearest point it
        // can and is gone from there, rather than pushing at a wall
        if (this.route.within !== EXIT_SNAP) { this.route.clear(); this.route.within = EXIT_SNAP; }
        this.route.aim(m.position, DOOR_OUT);
        const wp = this.route.head();
        if (wp) m.lookAt(wp.x, m.position.y, wp.z);
        if (this.route.step(m.position, WALK * dt)) {
          this.scene.remove(m);
          this.state = "gone";
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- Server NPC
export class Server {
  constructor(scene, engine, name, home, speed = SERVER_WALK, role = "server") {
    this.engine = engine;
    this.scene = scene;
    this.name = name;
    this.role = role;
    this.speed = speed;
    this.mesh = personMesh(role === "bartender" ? 0x2f4a5a : 0x2f2a24, true);
    this.home = new THREE.Vector3(home.x, home.y ?? floorY(home.x, home.z), home.z); // layout.js crewHome(desc, i)
    this.mesh.position.copy(this.home);
    scene.add(this.mesh);
    this.state = "idle";
    this.ticket = null;
    this.carry = null;
    this.route = new Route();
  }

  update(dt, patronsById) {
    const m = this.mesh;
    switch (this.state) {
      case "idle": {
        // grab the oldest unclaimed ready ticket — bartenders stick to drinks
        const ready = this.engine.readyUnclaimed(this.role === "bartender" ? "drink" : undefined);
        if (ready.length) {
          const tk = ready.sort((a, b) => a.placedAt - b.placedAt)[0];
          if (this.engine.claim(tk.id, "server:" + this.name)) {
            this.ticket = tk;
            this.route.clear();
            this.state = "toPass";
          }
        } else {
          this.route.aim(m.position, this.home);
          this.route.step(m.position, this.speed * dt);
        }
        break;
      }
      case "toPass": {
        const pass = this.ticket.kind === "food" ? PASS_FOOD : PASS_DRINK;
        this.route.aim(m.position, pass);
        const wp = this.route.head();
        if (wp) m.lookAt(wp.x, m.position.y, wp.z);
        if (this.route.step(m.position, this.speed * dt)) {
          this.carry = itemMesh(this.ticket.itemId);
          this.carry.position.set(0, 1.05, 0.24);
          m.add(this.carry);
          this.route.clear();
          this.state = "toPatron";
        }
        break;
      }
      case "toPatron": {
        const p = patronsById.get(this.ticket.patronId);
        if (!p || p.state === "leaving" || p.state === "gone") { this.dropCarry(); this.route.clear(); this.state = "idle"; break; }
        // the target walks: aim() replans once it has moved REPATH_D
        this.route.aim(m.position, p.pos);
        const wp = this.route.head();
        if (wp) m.lookAt(wp.x, m.position.y, wp.z);
        if (this.route.step(m.position, this.speed * dt, 0.75)) {
          const res = this.engine.deliver(this.ticket.id, false);
          if (res) { p.receive(this.ticket.itemId); audio.playSfx("cashRegister", 0.7); }
          this.dropCarry(); this.ticket = null; this.route.clear(); this.state = "idle";
        }
        break;
      }
    }
  }

  dropCarry() { if (this.carry) { this.mesh.remove(this.carry); this.carry = null; } }
}

// ----------------------------------------------------------------- routing
// A queue of waypoints from layout.js's nav grid, replanned when the target
// moves. stepToward() still walks each leg; what changed is that the legs go
// round the furniture instead of through it. A route that cannot reach its
// target is not an error and not a freeze — it ends at the nearest point the
// floor does join to, and aim() returns false so the caller can decide.

const REPATH_D = 0.6;          // a target that moved this far gets a new plan
const WAYPOINT_R = 0.08;       // how close counts as "on" an intermediate corner
export const EXIT_SNAP = 2.5;  // DOOR_OUT sits outside the room on purpose

export class Route {
  constructor(within = SNAP_R) {
    this.pts = null; this.i = 0; this.to = null; this.complete = false; this.within = within;
  }

  /** Plan, or replan if the target has moved. False means the floor does not
   *  join `pos` to `to`; the route still leads somewhere, just not there. */
  aim(pos, to) {
    if (this.pts && this.to && Math.hypot(to.x - this.to.x, to.z - this.to.z) < REPATH_D) return this.complete;
    const res = pathToward(currentLayout(), pos, to, WALKER_R, this.within);
    this.to = { x: to.x, z: to.z };
    this.pts = res.pts.slice(1);
    if (!this.pts.length) this.pts = [{ x: res.pts[0].x, z: res.pts[0].z }];
    this.i = 0;
    this.complete = res.complete;
    return this.complete;
  }

  clear() { this.pts = null; this.to = null; this.i = 0; this.complete = false; }

  /** The waypoint being walked to right now — what a body should face. */
  head() { return this.pts && this.i < this.pts.length ? this.pts[this.i] : this.to; }

  /** Walk `dist` along the route, spilling what is left of a step into the
   *  next leg so a corner does not cost a frame. True once the last waypoint
   *  is within `arrive`. */
  step(pos, dist, arrive = 0.12) {
    if (!this.pts || !this.pts.length) return true;
    let left = dist;
    while (this.i < this.pts.length) {
      const last = this.i === this.pts.length - 1;
      const wp = this.pts[this.i];
      const stop = last ? arrive : WAYPOINT_R;
      const d = Math.hypot(wp.x - pos.x, wp.z - pos.z);
      if (d <= stop) { if (last) return true; this.i++; continue; }
      if (!stepToward(pos, wp, left, stop)) return false;
      if (last) return true;
      left -= Math.max(0, d - stop);
      this.i++;
      if (left <= 0) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------- movement
// A body's y is never integrated: after every step it is read off the floor
// under the body (world.floorY), so a patron climbing the flagship's stair
// rises with the treads and one sitting down on the deck sits at the deck's
// height. The planner already refuses any leg that is not a step.
const velLook = new THREE.Vector3(0, 0, 1);
const _dir = new THREE.Vector3();
export function stepToward(pos, target, step, arrive = 0.12) {
  _dir.set(target.x - pos.x, 0, target.z - pos.z);
  const d = _dir.length();
  if (d <= arrive) return true;
  _dir.multiplyScalar(step / d);
  if (step >= d) { pos.x = target.x; pos.z = target.z; pos.y = floorY(pos.x, pos.z); return true; }
  pos.x += _dir.x; pos.z += _dir.z;
  pos.y = floorY(pos.x, pos.z);
  velLook.copy(_dir);
  return false;
}
