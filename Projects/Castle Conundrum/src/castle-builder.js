// castle-builder.js — turns data/scene-config.json into placed geometry.
// All placement data lives in JSON; this file only interprets it.
// Also builds the static collision list (world-space AABBs) and the animated gate door.

import * as THREE from 'three';
import { loadModel } from './assets.js';

const _box = new THREE.Box3();

export class CastleBuilder {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;
    this.tile = config.tileSize;
    this.colliders = []; // { box: THREE.Box3, id?: string }
    this.gateDoor = null; // { pivot, openAngle, state }
  }

  tileToWorld(tx, tz) {
    return new THREE.Vector3(tx * this.tile, 0, tz * this.tile);
  }

  /** Scale a loaded model so its X footprint equals tileSize (for modular wall pieces). */
  normalizeToTile(obj) {
    _box.setFromObject(obj);
    const size = new THREE.Vector3();
    _box.getSize(size);
    if (size.x > 0.0001) {
      const s = this.tile / size.x;
      obj.scale.setScalar(s);
    }
    // sit on the ground
    _box.setFromObject(obj);
    obj.position.y -= _box.min.y;
  }

  groundAndCenter(obj) {
    _box.setFromObject(obj);
    obj.position.y -= _box.min.y;
  }

  addCollider(obj, id = undefined) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    // don't let paper-thin or ground-hugging decor block movement
    if (box.max.y - box.min.y < 0.3) return null;
    const entry = { box, id };
    this.colliders.push(entry);
    return entry;
  }

  async build() {
    const c = this.config.courtyard;
    const kBase = this.config.kenneyBase;
    const pBase = this.config.polyhavenBase;

    // --- Wall runs (Kenney modular pieces, tiled) ---
    for (const run of c.wallRuns) {
      for (let i = 0; i < run.count; i++) {
        const tx = run.start[0] + run.step[0] * i;
        const tz = run.start[1] + run.step[1] * i;
        const piece = await loadModel(kBase + run.model);
        this.normalizeToTile(piece);
        piece.rotation.y = THREE.MathUtils.degToRad(run.rotationY || 0);
        const pos = this.tileToWorld(tx, tz);
        piece.position.x = pos.x;
        piece.position.z = pos.z;
        this.scene.add(piece);
        this.addCollider(piece);
      }
    }

    // --- Individual placements (towers, gate arch, props, trees) ---
    for (const p of c.placements) {
      const obj = await loadModel(kBase + p.model);
      if (p.model.startsWith('tower') || p.model.startsWith('wall')) {
        this.normalizeToTile(obj);
      } else {
        this.groundAndCenter(obj);
      }
      obj.rotation.y = THREE.MathUtils.degToRad(p.rotationY || 0);
      const pos = this.tileToWorld(p.tile[0], p.tile[1]);
      obj.position.x = pos.x;
      obj.position.z = pos.z;
      this.scene.add(obj);
      if (!p.noCollide) this.addCollider(obj, p.id);
    }

    // --- Gate door (Poly Haven mesh inside the archway, hinged to swing open) ---
    const g = this.config.gateDoor;
    const doorModel = await loadModel(pBase + g.model);
    this.groundAndCenter(doorModel);

    // Hinge pivot at the door's left edge so it swings like a real gate
    _box.setFromObject(doorModel);
    const size = new THREE.Vector3();
    _box.getSize(size);
    // If the gate model is tiny or huge relative to the archway, scale to ~tile width
    if (size.x > 0.0001 && (size.x < this.tile * 0.5 || size.x > this.tile * 1.3)) {
      doorModel.scale.multiplyScalar((this.tile * 0.9) / size.x);
      this.groundAndCenter(doorModel);
      _box.setFromObject(doorModel);
      _box.getSize(size);
    }

    const pivot = new THREE.Group();
    const gatePos = this.tileToWorld(g.tile[0], g.tile[1]);
    pivot.position.set(gatePos.x - size.x / 2, 0, gatePos.z);
    pivot.rotation.y = THREE.MathUtils.degToRad(g.rotationY || 0);
    doorModel.position.x = size.x / 2; // door hangs off the hinge
    pivot.add(doorModel);
    this.scene.add(pivot);

    const doorCollider = this.addCollider(pivot, 'gate-door');
    this.gateDoor = {
      pivot,
      collider: doorCollider,
      closedAngle: pivot.rotation.y,
      openAngle: pivot.rotation.y + THREE.MathUtils.degToRad(105),
      progress: 0,
      opening: false,
    };

    // --- Interior Poly Haven props ---
    for (const p of this.config.interiorProps) {
      const obj = await loadModel(pBase + p.model);
      this.groundAndCenter(obj);
      obj.rotation.y = THREE.MathUtils.degToRad(p.rotationY || 0);
      const pos = this.tileToWorld(p.tile[0], p.tile[1]);
      obj.position.x = pos.x;
      obj.position.z = pos.z;
      if (p.yOffset) obj.position.y += p.yOffset;
      this.scene.add(obj);
      // furniture collides; small tabletop items don't
      if (!p.yOffset) this.addCollider(obj);
    }

    return this;
  }

  /** Call from the render loop. Animates the gate when opening. */
  update(dt) {
    const gd = this.gateDoor;
    if (gd && gd.opening && gd.progress < 1) {
      gd.progress = Math.min(1, gd.progress + dt * 0.4);
      const eased = 1 - Math.pow(1 - gd.progress, 3);
      gd.pivot.rotation.y = THREE.MathUtils.lerp(gd.closedAngle, gd.openAngle, eased);
      if (gd.progress >= 0.25 && gd.collider) {
        // stop blocking the player once it's meaningfully open
        const i = this.colliders.indexOf(gd.collider);
        if (i !== -1) this.colliders.splice(i, 1);
        gd.collider = null;
      }
    }
  }

  openGate() {
    if (this.gateDoor) this.gateDoor.opening = true;
  }
}
