// patrons.js — the crowd and the crew.
// Patrons: spawn at the door → claim a seat → sit → want something →
// ticket goes to kitchen/bar → a carrier (server NPC or the boss) delivers →
// eat/drink → maybe another round → head home. Impatient patrons walk.
// Servers: claim ready tickets, fetch from the pass, deliver, repeat.

import * as THREE from "three";
import { flat, glow } from "./materials.js";
import { seats, DOOR, DOOR_OUT, PASS_FOOD, PASS_DRINK } from "./world.js";
import { MENU } from "./engine.js";

const ITEM_COLORS = { wings: 0xd97a2b, burger: 0x9c6b3f, nachos: 0xe3c14f, fries: 0xf0d264, beer: 0xe8a33d, soda: 0x5aa7d6 };
const SHIRTS = [0x5a6b8c, 0x6b8c5a, 0x8c5a6b, 0x7a7a7a, 0x8c7a5a, 0x4f7d7d];
const MULES_AMBER = 0xe8a33d;

const WALK = 1.55, SERVER_WALK = 2.0;
let _pid = 0;

export function freeSeat() {
  const open = seats.filter(s => !s.taken);
  return open.length ? open[Math.floor(Math.random() * open.length)] : null;
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

function personMesh(shirtColor, isServer = false) {
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
  constructor(scene, engine, mulesFan) {
    this.id = ++_pid;
    this.engine = engine;
    this.scene = scene;
    this.mulesFan = mulesFan;
    this.mesh = personMesh(mulesFan ? MULES_AMBER : SHIRTS[Math.floor(Math.random() * SHIRTS.length)]);
    this.mesh.position.copy(DOOR);
    this.mesh.position.x += (Math.random() - 0.5) * 0.6;
    scene.add(this.mesh);
    this.state = "entering";
    this.seat = freeSeat();
    this.round = 0;
    this.timer = 0;
    this.ticket = null;
    this.bubbleMesh = null;
    this.consumeMesh = null;
    this.cheer = 0;
    this.bob = Math.random() * Math.PI * 2;
    if (!this.seat) { this.state = "leaving"; engine.walkout(this.id); }
    else this.seat.taken = true;
  }

  get pos() { return this.mesh.position; }

  wantsNext() {
    this.state = "deciding";
    this.timer = 2 + Math.random() * 6;
  }

  placeOrder() {
    let itemId = this.engine.chooseOrder(this.round);
    let ticket = itemId ? this.engine.placeTicket(this.id, itemId) : null;
    if (!ticket && itemId) { // lost the last serving in a race — pick again
      itemId = this.engine.chooseOrder(this.round);
      ticket = itemId ? this.engine.placeTicket(this.id, itemId) : null;
    }
    if (!ticket) { this.emptyShelves = true; this.stormOut(); return; }
    this.ticket = ticket;
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
  }

  releaseSeat() { if (this.seat) { this.seat.taken = false; this.seat = null; } }

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
        const target = this.seat.approach;
        m.lookAt(target.x, m.position.y, target.z);
        if (stepToward(m.position, target, WALK * dt)) {
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
        m.lookAt(DOOR_OUT.x, m.position.y, DOOR_OUT.z);
        if (stepToward(m.position, DOOR_OUT, WALK * dt)) {
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
  constructor(scene, engine, name, homeX, speed = SERVER_WALK) {
    this.engine = engine;
    this.scene = scene;
    this.name = name;
    this.speed = speed;
    this.mesh = personMesh(0x2f2a24, true);
    this.home = new THREE.Vector3(homeX, 0, -2.2);
    this.mesh.position.copy(this.home);
    scene.add(this.mesh);
    this.state = "idle";
    this.ticket = null;
    this.carry = null;
  }

  update(dt, patronsById) {
    const m = this.mesh;
    switch (this.state) {
      case "idle": {
        // grab the oldest unclaimed ready ticket
        const ready = this.engine.readyUnclaimed();
        if (ready.length) {
          const tk = ready.sort((a, b) => a.placedAt - b.placedAt)[0];
          if (this.engine.claim(tk.id, "server:" + this.name)) {
            this.ticket = tk;
            this.state = "toPass";
          }
        } else stepToward(m.position, this.home, this.speed * dt);
        break;
      }
      case "toPass": {
        const pass = this.ticket.kind === "food" ? PASS_FOOD : PASS_DRINK;
        m.lookAt(pass.x, m.position.y, pass.z);
        if (stepToward(m.position, pass, this.speed * dt)) {
          this.carry = itemMesh(this.ticket.itemId);
          this.carry.position.set(0, 1.05, 0.24);
          m.add(this.carry);
          this.state = "toPatron";
        }
        break;
      }
      case "toPatron": {
        const p = patronsById.get(this.ticket.patronId);
        if (!p || p.state === "leaving" || p.state === "gone") { this.dropCarry(); this.state = "idle"; break; }
        m.lookAt(p.pos.x, m.position.y, p.pos.z);
        if (stepToward(m.position, p.pos, this.speed * dt, 0.75)) {
          const res = this.engine.deliver(this.ticket.id, false);
          if (res) p.receive(this.ticket.itemId);
          this.dropCarry(); this.ticket = null; this.state = "idle";
        }
        break;
      }
    }
  }

  dropCarry() { if (this.carry) { this.mesh.remove(this.carry); this.carry = null; } }
}

// ---------------------------------------------------------------- movement
const velLook = new THREE.Vector3(0, 0, 1);
const _dir = new THREE.Vector3();
export function stepToward(pos, target, step, arrive = 0.12) {
  _dir.set(target.x - pos.x, 0, target.z - pos.z);
  const d = _dir.length();
  if (d <= arrive) return true;
  _dir.multiplyScalar(step / d);
  if (step >= d) { pos.x = target.x; pos.z = target.z; return true; }
  pos.x += _dir.x; pos.z += _dir.z;
  velLook.copy(_dir);
  return false;
}
