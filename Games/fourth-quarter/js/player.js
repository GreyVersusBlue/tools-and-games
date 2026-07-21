// player.js — you, the owner, on the floor.
// WASD + mouse (click to grab the cursor), Shift to hustle.
// E at a pick-up counter: take the oldest ready order of that station.
// E at the highlighted patron: hand it over — boss deliveries tip better.

import * as THREE from "three";
import { colliders, inBounds, PASS_FOOD, PASS_DRINK, STOVE_STATION, TAP_STATION } from "./world.js";
import { glow } from "./materials.js";
import { itemMesh } from "./patrons.js";
import { MENU } from "./engine.js";
import * as audio from "./audio.js";

const EYE = 1.62, RADIUS = 0.3, SPEED = 3.1, SPRINT = 4.6;

export class Player {
  constructor(camera, dom, engine) {
    this.cam = camera;
    this.engine = engine;
    this.cam.position.set(0, EYE, 3.4);
    this.yaw = Math.PI; this.pitch = 0;
    this.keys = {};
    this.locked = false;
    this.ticket = null;       // ticket being carried
    this.carryMesh = null;
    this.marker = null;       // floating marker over the target patron
    this.onPrompt = () => {};
    this.onInteract = () => {};
    this.qte = null;          // active stove/tap timing-bar minigame, if any
    this.qteEl = document.querySelector("#qte");
    this.qteLabelEl = document.querySelector("#qteLabel");
    this.qteZoneEl = document.querySelector("#qteZone");
    this.qteMarkerEl = document.querySelector("#qteMarker");

    dom.addEventListener("click", () => { if (!this.locked) dom.requestPointerLock(); });
    document.addEventListener("pointerlockchange", () => { this.locked = document.pointerLockElement === dom; });
    document.addEventListener("mousemove", e => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0023;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - e.movementY * 0.0023));
    });
    document.addEventListener("keydown", e => {
      this.keys[e.code] = true;
      if (e.code === "KeyE") this.onInteract();
    });
    document.addEventListener("keyup", e => { this.keys[e.code] = false; });
  }

  get pos() { return this.cam.position; }

  nearPass() {
    const p = this.pos;
    if (p.distanceTo(new THREE.Vector3(PASS_FOOD.x, EYE, PASS_FOOD.z)) < 1.7) return "food";
    if (p.distanceTo(new THREE.Vector3(PASS_DRINK.x, EYE, PASS_DRINK.z)) < 1.7) return "drink";
    return null;
  }

  nearStove() { return this.pos.distanceTo(new THREE.Vector3(STOVE_STATION.x, EYE, STOVE_STATION.z)) < 1.6; }
  nearTap()   { return this.pos.distanceTo(new THREE.Vector3(TAP_STATION.x, EYE, TAP_STATION.z)) < 1.6; }

  // ---------------------------------------------------------------- stove/tap minigame
  startQte(station, tk) {
    const center = 0.3 + Math.random() * 0.4;
    this.qte = { station, ticketId: tk.id, pos: 0, dir: 1, speed: 1.8,
      zoneStart: center - 0.08, zoneEnd: center + 0.08 };
    this.qteLabelEl.textContent = station === "stove" ? "SEAR IT" : "POUR IT";
    this.qteZoneEl.style.left = (this.qte.zoneStart * 100) + "%";
    this.qteZoneEl.style.width = ((this.qte.zoneEnd - this.qte.zoneStart) * 100) + "%";
    this.qteEl.style.display = "flex";
    audio.startLoop(station === "stove" ? "sizzle" : "pour", 0.55);
  }
  cancelQte() {
    if (this.qte) audio.stopLoop(this.qte.station === "stove" ? "sizzle" : "pour", 0.3);
    this.qte = null; this.qteEl.style.display = "none";
  }
  scoreQte() {
    const q = this.qte;
    const hit = q.pos >= q.zoneStart && q.pos <= q.zoneEnd;
    const tk = this.engine.workTicket(q.ticketId, hit);
    this.cancelQte(); // stops the sizzle/pour loop before the hit/miss stinger
    audio.playSfx(hit ? "qteHit" : "qteMiss");
    if (!tk) return { msg: "Someone else already got to it." };
    return hit
      ? { msg: `${q.station === "stove" ? "Perfect sear!" : "Clean pour!"} Order's flying.`, good: true }
      : { msg: "Rough one — still shaved some time off it." };
  }

  tryInteract(scene, patronsById) {
    if (this.qte) return this.scoreQte();

    if (!this.ticket) {
      if (this.nearStove()) {
        const tk = this.engine.oldestPrep("food");
        if (!tk) return { msg: "Nothing on the line to cook." };
        this.startQte("stove", tk);
        return { msg: "Work it — hit E in the zone!" };
      }
      if (this.nearTap()) {
        const tk = this.engine.oldestPrep("drink");
        if (!tk) return { msg: "Nothing to pour." };
        this.startQte("tap", tk);
        return { msg: "Work it — hit E in the zone!" };
      }
      const station = this.nearPass();
      if (!station) return null;
      const ready = this.engine.readyUnclaimed(station);
      if (!ready.length) return { msg: station === "food" ? "Kitchen's still working." : "Nothing on the bar yet." };
      const tk = ready.sort((a, b) => a.placedAt - b.placedAt)[0];
      if (!this.engine.claim(tk.id, "boss")) return null;
      this.ticket = tk;
      this.carryMesh = itemMesh(tk.itemId);
      this.carryMesh.position.set(0.3, -0.42, -0.7);
      this.cam.add(this.carryMesh);
      const p = patronsById.get(tk.patronId);
      if (p) {
        this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 4), glow(0xff4e42, 1.6));
        this.marker.rotation.x = Math.PI;
        this.marker.position.y = 2.15;
        p.mesh.add(this.marker);
        this.markerOn = p;
      }
      return { msg: `Picked up ${MENU[tk.itemId].name} — find the marker.` };
    }
    // carrying: deliver if close to the right patron
    const p = patronsById.get(this.ticket.patronId);
    if (!p || p.state === "gone" || p.state === "leaving") { this.clearCarry(); return { msg: "They didn't stick around. Order's dead." }; }
    const d = this.pos.distanceTo(new THREE.Vector3(p.pos.x, EYE, p.pos.z));
    if (d > 1.5) return { msg: "Get it to the marked customer." };
    const res = this.engine.deliver(this.ticket.id, true);
    if (res) {
      p.receive(this.ticket.itemId);
      audio.playSfx("cashRegister");
      this.clearCarry();
      return { msg: `Boss service! ${res.item.name} lands — $${res.item.price} + $${res.tip.toFixed(2)} tip.`, good: true };
    }
    return null;
  }

  clearCarry() {
    if (this.carryMesh) { this.cam.remove(this.carryMesh); this.carryMesh = null; }
    if (this.marker && this.markerOn) { this.markerOn.mesh.remove(this.marker); }
    this.marker = null; this.markerOn = null;
    this.ticket = null;
    if (this.qte) this.cancelQte();
  }

  promptText(patronsById) {
    if (this.qte) return "E — HIT IT!";
    if (this.ticket) {
      const p = patronsById.get(this.ticket.patronId);
      if (p && this.pos.distanceTo(new THREE.Vector3(p.pos.x, EYE, p.pos.z)) < 1.5)
        return "E — hand it over";
      return `Carrying ${MENU[this.ticket.itemId].name} → marked customer`;
    }
    if (this.nearStove()) {
      const tk = this.engine.oldestPrep("food");
      return tk ? "E — work the line (cook)" : "Stove's quiet — nothing to cook";
    }
    if (this.nearTap()) {
      const tk = this.engine.oldestPrep("drink");
      return tk ? "E — pour a round" : "Taps are quiet — nothing to pour";
    }
    const st = this.nearPass();
    if (st) {
      const n = this.engine.readyUnclaimed(st).length;
      return n ? `E — pick up (${n} ready)` : (st === "food" ? "Kitchen pass — nothing up yet" : "Bar pick-up — nothing poured yet");
    }
    return "";
  }

  update(dt) {
    if (this.qte) {
      const q = this.qte;
      const stillNear = q.station === "stove" ? this.nearStove() : this.nearTap();
      if (!stillNear) { this.cancelQte(); }
      else {
        q.pos += q.dir * q.speed * dt;
        if (q.pos >= 1) { q.pos = 1; q.dir = -1; }
        if (q.pos <= 0) { q.pos = 0; q.dir = 1; }
        this.qteMarkerEl.style.left = (q.pos * 100) + "%";
      }
    }
    this.cam.rotation.order = "YXZ";
    this.cam.rotation.y = this.yaw;
    this.cam.rotation.x = this.pitch;

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (this.keys.KeyW) move.add(fwd);
    if (this.keys.KeyS) move.sub(fwd);
    if (this.keys.KeyD) move.add(right);
    if (this.keys.KeyA) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar((this.keys.ShiftLeft ? SPRINT : SPEED) * dt);
      this.slide(move);
    }
    if (this.carryMesh) this.carryMesh.position.y = -0.42 + Math.sin(performance.now() * 0.004) * 0.01;
  }

  slide(move) {
    // axis-separated so you slide along counters instead of sticking
    const p = this.cam.position;
    const tryAxis = (dx, dz) => {
      const nx = p.x + dx, nz = p.z + dz;
      if (!inBounds(nx, nz, RADIUS)) return;
      for (const b of colliders) {
        if (nx > b.min.x - RADIUS && nx < b.max.x + RADIUS &&
            nz > b.min.z - RADIUS && nz < b.max.z + RADIUS) return;
      }
      p.x = nx; p.z = nz;
    };
    tryAxis(move.x, 0);
    tryAxis(0, move.z);
  }
}
