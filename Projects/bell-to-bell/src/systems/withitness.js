import { CFG } from '../config.js';

// Withitness (Kounin, 1970). The whole thesis of the game in one toggle:
// you can see everything in that room, and looking costs you the lesson.

// What a tick of the toggle does to the meters, and nothing else. The game's
// tick() below and the headless period in simulate.js both call this, so the
// balance table cannot be weighing a toggle the game does not have (#906;
// simulate.js used to carry its own copy of these lines).
// The Mastery this costs (locked constraint 1) is not taken here.
// lesson.tick() takes CFG.scanMasteryDrainPerSec off all twelve students
// while the flag is up; a line here subtracted it from state.mastery too,
// which constraint 7 forbids and the lesson overwrote the same frame (#887).
export function scanCosts(state, dt) {
  if (state.withitness) {
    state.bandwidth -= CFG.bandwidthDrainPerSec * dt;
    state.hyper += CFG.hyperGainPerSec * dt;
    state.restless += CFG.scanRestlessPerSec * dt;
    state.withitnessSeconds += dt;
  } else {
    state.hyper -= CFG.hyperDecayPerSec * dt;
  }
  state.hyper = Math.max(0, Math.min(100, state.hyper));
}
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
    scanCosts(state, dt);
    dom.tint.classList.toggle('hyper', state.hyper > CFG.hyperThreshold);
  }

  return { set, tick };
}
