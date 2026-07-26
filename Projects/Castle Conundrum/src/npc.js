// npc.js — placeholder-bodied NPCs: patrol/idle movement, facing, dialogue state.
// Every npc in data/npcs.json currently has modelPath: null, so build() falls back
// to a coloured capsule-and-head placeholder tinted by placeholder.color. If a real
// rigged model is ever assigned via modelPath, it's used instead — swapping in a
// real model later is a data change, not a code change.

import * as THREE from 'three';
import { loadModel } from './assets.js';

const PATROL_SPEED = 1.1; // m/s
const WAYPOINT_EPS = 0.05;

export class NPC {
  constructor(def, scene, polyhavenBase) {
    this.def = def;
    this.scene = scene;
    this.polyhavenBase = polyhavenBase;

    this.id = def.id;
    this.name = def.name;
    this.talking = false;
    this.dialogueState = 'default';

    this.group = new THREE.Group();
    this.group.position.set(...def.position);
    this.group.rotation.y = THREE.MathUtils.degToRad(def.facing || 0);

    this._waypoints = (def.patrol || []).map((p) => new THREE.Vector3(...p));
    this._waypointIndex = 0;
  }

  async build() {
    if (this.def.modelPath) {
      this.group.add(await loadModel(this.def.modelPath));
    } else {
      this.group.add(this._buildPlaceholderBody());
      if (this.def.placeholder?.heldProp) {
        const prop = await loadModel(this.polyhavenBase + this.def.placeholder.heldProp);
        this._attachHeldProp(prop);
      }
    }
    this.scene.add(this.group);
    return this;
  }

  _buildPlaceholderBody() {
    const color = this.def.placeholder?.color || '#888888';
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const body = new THREE.Group();

    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.1, 12), mat);
    robe.position.y = 0.55;
    robe.castShadow = true;
    body.add(robe);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), mat);
    head.position.y = 1.28;
    head.castShadow = true;
    body.add(head);

    body.userData.isPlaceholder = true;
    return body;
  }

  /** Scale the loaded prop to a hand-sized prop and hang it off the body's right side. */
  _attachHeldProp(prop) {
    const box = new THREE.Box3().setFromObject(prop);
    const size = new THREE.Vector3();
    box.getSize(size);
    const longest = Math.max(size.x, size.y, size.z);
    if (longest > 0.0001) prop.scale.setScalar(0.6 / longest);

    box.setFromObject(prop);
    const center = box.getCenter(new THREE.Vector3());
    prop.position.sub(center);
    prop.position.add(new THREE.Vector3(0.3, 0.85, 0.05));
    prop.rotation.y = Math.PI / 2;
    prop.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    this.group.add(prop);
  }

  /** Called every frame from main.js's render loop. */
  update(dt, camPos) {
    if (this.talking || this._waypoints.length === 0) return;

    const target = this._waypoints[this._waypointIndex];
    const to = new THREE.Vector3().subVectors(target, this.group.position);
    to.y = 0;
    const dist = to.length();

    if (dist < WAYPOINT_EPS) {
      this._waypointIndex = (this._waypointIndex + 1) % this._waypoints.length;
      return;
    }

    to.normalize();
    this.group.position.addScaledVector(to, Math.min(PATROL_SPEED * dt, dist));
    this.group.rotation.y = Math.atan2(to.x, to.z);
  }

  /** Turn to face the player. Called once by main.js when interaction starts. */
  facePlayer(camPos) {
    const dir = new THREE.Vector3().subVectors(camPos, this.group.position);
    dir.y = 0;
    if (dir.lengthSq() < 0.0001) return;
    this.group.rotation.y = Math.atan2(dir.x, dir.z);
  }

  getDialogueLines() {
    return this.def.dialogue[this.dialogueState];
  }
}
