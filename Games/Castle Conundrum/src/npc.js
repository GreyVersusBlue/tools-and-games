// npc.js — NPC class driven by data/npcs.json.
// Bodies are labeled placeholder capsules until real character models are supplied;
// swapping in a real model is just setting "modelPath" in npcs.json.

import * as THREE from 'three';
import { loadModel } from './assets.js';

export class NPC {
  constructor(def, scene, polyhavenBase) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.scene = scene;
    this.polyhavenBase = polyhavenBase;

    this.group = new THREE.Group();
    this.group.position.set(...def.position);
    this.group.rotation.y = THREE.MathUtils.degToRad(def.facing || 0);
    this.group.userData.npc = this;
    scene.add(this.group);

    this.patrol = def.patrol ? def.patrol.map((p) => new THREE.Vector3(...p)) : null;
    this.patrolIndex = 0;
    this.patrolSpeed = 1.1;

    this.dialogueState = 'default'; // 'default' | 'hasKeystone' | 'afterVictory'
  }

  async build() {
    if (this.def.modelPath) {
      const model = await loadModel(this.def.modelPath);
      this.group.add(model);
    } else {
      // Placeholder: capsule body + head sphere, distinct color per NPC
      const color = new THREE.Color(this.def.placeholder?.color || '#888888');
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });

      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.85, 6, 12), mat);
      body.position.y = 0.75;
      body.castShadow = true;
      this.group.add(body);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0xd9b38c, roughness: 0.9 })
      );
      head.position.y = 1.55;
      head.castShadow = true;
      this.group.add(head);

      const held = this.def.placeholder?.heldProp;
      if (held) {
        const prop = await loadModel(this.polyhavenBase + held);
        // rough hand position; tune per prop later
        prop.position.set(0.42, 0.9, 0.1);
        prop.rotation.z = THREE.MathUtils.degToRad(-20);
        this.group.add(prop);
      }
    }
  }

  /** Lines for the current dialogue state, with riddle token untouched (ui/quest handles it). */
  getDialogueLines() {
    const d = this.def.dialogue;
    return d[this.dialogueState] || d.default;
  }

  update(dt, playerPos) {
    if (!this.patrol || this.talking) return;
    const target = this.patrol[this.patrolIndex];
    const toTarget = new THREE.Vector3().subVectors(target, this.group.position);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist < 0.15) {
      this.patrolIndex = (this.patrolIndex + 1) % this.patrol.length;
      return;
    }
    toTarget.normalize();
    this.group.position.addScaledVector(toTarget, this.patrolSpeed * dt);
    this.group.rotation.y = Math.atan2(toTarget.x, toTarget.z);
  }

  facePlayer(playerPos) {
    const dx = playerPos.x - this.group.position.x;
    const dz = playerPos.z - this.group.position.z;
    this.group.rotation.y = Math.atan2(dx, dz);
  }
}
