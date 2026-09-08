// moments.js — a moment on the floor, not a modal.
//
// events.js says what a card is and the engine says when one is waiting;
// this is what the room shows for it: a person who walks in from the door
// and stands where the card says (`who`), or a lit prop at that spot
// (`who` null) — a floor ring, the same shape as a day station's, and a
// marker over it. The boss walks up and presses E; the choices are the
// management panel. Nothing here decides anything: the card's view, the
// choice and the effects are the engine's, and the sim runs on underneath.

import * as THREE from "three";
import { personMesh, nameplate, Route, EXIT_SNAP } from "./patrons.js";
import { stationRing, DOOR, DOOR_OUT, currentLayout } from "./world.js";
import { standPointsFor } from "./layout.js";
import { glow } from "./materials.js";
import { text } from "./events.js";

/** Where each of events.js's anchors is in the room: a stand-point from the
 *  layout, the same ones the day rings and the crew use, so a moment is
 *  always somewhere the floor joins to. The TV's is the crew's idle spot,
 *  under the north wall's screen. */
export const ANCHOR_STATION = { door: "spawn", bar: "passDrink", tap: "tap", tv: "crew", kitchen: "passFood" };
export const MOMENT_R = 1.6;          // layout.js's INTERACT_R: a station's reach
const NPC_WALK = 1.4;
const COAT = 0xc9c0ae;                // a stranger in a light coat: not a patron's shirt, not a regular's jacket
const EYE = 1.62;

export class FloorMoment {
  /** `card` is the engine's pending event; `view` its view, for the name. */
  constructor(scene, card, view) {
    this.scene = scene;
    this.card = card;
    this.who = card.who == null ? null : text(card.who, view);
    const pts = standPointsFor(currentLayout());
    const p = pts[ANCHOR_STATION[card.where]] || pts.spawn;
    this.anchor = new THREE.Vector3(p.x, p.y, p.z);
    this.t = 0;
    this.ring = stationRing(0xff4e42);
    this.ring.position.set(this.anchor.x, this.anchor.y + 0.03, this.anchor.z);
    this.ring.name = "momentRing";
    scene.add(this.ring);
    if (this.who) {
      this.mesh = personMesh(COAT);
      this.mesh.add(nameplate(this.who));
      this.mesh.position.copy(DOOR);
      this.route = new Route();
      this.arrived = false;
    } else {
      this.mesh = new THREE.Group();
      this.mesh.position.copy(this.anchor);
      this.arrived = true;
    }
    // the same cone the boss's delivery marker uses, in the ticker's event red
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 4), glow(0xff4e42, 1.6));
    this.marker.rotation.x = Math.PI;
    this.marker.position.y = this.who ? 2.15 : 1.4;
    this.mesh.add(this.marker);
    this.mesh.name = "moment";
    scene.add(this.mesh);
    this.leaving = false;
    this.gone = false;
  }

  get pos() { return this.mesh.position; }

  /** Is the boss close enough to answer it — the same reach as a station,
   *  against the person (or the prop) rather than the ring. */
  near(pos) {
    const m = this.mesh.position;
    return Math.hypot(pos.x - m.x, pos.y - (m.y + EYE), pos.z - m.z) < MOMENT_R;
  }

  update(dt) {
    this.t += dt;
    this.marker.rotation.y += dt * 2.5;
    this.marker.position.y = (this.who ? 2.15 : 1.4) + Math.sin(this.t * 3) * 0.06;
    this.ring.scale.setScalar(1 + Math.sin(this.t * 2.4) * 0.06);
    if (!this.who) return;
    const m = this.mesh;
    if (this.leaving) {
      if (this.route.within !== EXIT_SNAP) { this.route.clear(); this.route.within = EXIT_SNAP; }
      this.route.aim(m.position, DOOR_OUT);
      const wp = this.route.head();
      if (wp) m.lookAt(wp.x, m.position.y, wp.z);
      if (this.route.step(m.position, NPC_WALK * dt)) { this.scene.remove(m); this.gone = true; }
      return;
    }
    if (this.arrived) return;
    // a stand-point the floor cannot join to is not an error: they stop
    // where the route ends and the moment is there instead
    this.route.aim(m.position, this.anchor);
    const wp = this.route.head();
    if (wp) m.lookAt(wp.x, m.position.y, wp.z);
    if (this.route.step(m.position, NPC_WALK * dt)) {
      this.arrived = true;
      this.route.clear();
    }
  }

  /** Answered, or last call: the ring and the marker go now; a person walks
   *  back out the door and is gone from there. */
  close() {
    this.scene.remove(this.ring);
    this.mesh.remove(this.marker);
    if (!this.who) { this.scene.remove(this.mesh); this.gone = true; return; }
    this.leaving = true;
    this.route.clear();
  }

  /** Tear-down for a night that ends under it (a dev reset). */
  remove() {
    this.scene.remove(this.ring);
    this.scene.remove(this.mesh);
    this.gone = true;
  }
}
