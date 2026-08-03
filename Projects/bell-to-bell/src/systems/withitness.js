import { CFG } from '../config.js';

// Withitness (Kounin, 1970). The whole thesis of the game in one toggle:
// you can see everything in that room, and looking costs you the lesson.
export function createWithitness({ scene, registry, tellSystem, audio, dom }) {
  function set(state, on) {
    if (on === state.withitness) return;
    state.withitness = on;
    if (on) state.withitnessUses++;

    registry.setThermal(on);
    scene.background.set(on ? 0x060C15 : 0xB9BDB2);
    scene.fog.color.set(on ? 0x060C15 : 0xB9BDB2);

    dom.thermal.classList.toggle('on', on);
    dom.tint.classList.toggle('on', on);
    dom.chip.classList.toggle('hot', on);

    tellSystem.setThermalVisible(on);
    audio.setDrone(on);
    if (!on) tellSystem.clearLabels();
  }

  function tick(state, dt) {
    if (state.withitness) {
      state.bandwidth -= CFG.bandwidthDrainPerSec * dt;
      state.hyper += CFG.hyperGainPerSec * dt;
      state.withitnessSeconds += dt;
      state.mastery -= CFG.scanMasteryDrainPerSec * dt;   // you are not teaching
      state.restless += CFG.scanRestlessPerSec * dt;
    } else {
      state.hyper -= CFG.hyperDecayPerSec * dt;
    }
    state.hyper = Math.max(0, Math.min(100, state.hyper));
    dom.tint.classList.toggle('hyper', state.hyper > CFG.hyperThreshold);
  }

  return { set, tick };
}
