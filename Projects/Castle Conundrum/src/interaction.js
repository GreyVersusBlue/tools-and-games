// interaction.js — finds the NPC the player can talk to (proximity + facing),
// shows the "Press E" prompt, and routes E/click into the dialogue system.

import * as THREE from 'three';

const INTERACT_RANGE = 3.2;
const FACING_DOT = 0.35; // must be at least vaguely looking at them

export class InteractionSystem {
  constructor(camera, npcs, ui) {
    this.camera = camera;
    this.npcs = npcs;
    this.ui = ui;
    this.currentTarget = null;
    this.onInteract = null; // set by quest-manager: (npc) => void

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE') this.tryInteract();
    });
    document.addEventListener('click', () => {
      // click advances dialogue only when a dialogue is open (pointer lock swallows other clicks)
      if (this.ui.isDialogueOpen()) this.tryInteract();
    });
  }

  tryInteract() {
    if (this.ui.isRiddleOpen()) return; // riddle overlay owns input
    if (this.ui.isDialogueOpen()) {
      this.ui.advanceDialogue();
      return;
    }
    if (this.currentTarget && this.onInteract) {
      this.onInteract(this.currentTarget);
    }
  }

  update() {
    if (this.ui.isDialogueOpen() || this.ui.isRiddleOpen()) {
      this.ui.setInteractPrompt(false);
      return;
    }

    const camPos = this.camera.position;
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();

    let best = null;
    let bestDist = INTERACT_RANGE;
    for (const npc of this.npcs) {
      const to = new THREE.Vector3().subVectors(npc.group.position, camPos);
      to.y = 0;
      const dist = to.length();
      if (dist > bestDist) continue;
      to.normalize();
      if (to.dot(camDir) < FACING_DOT) continue;
      best = npc;
      bestDist = dist;
    }

    this.currentTarget = best;
    this.ui.setInteractPrompt(!!best, best ? `Press E to talk to the ${best.name}` : '');
  }
}
